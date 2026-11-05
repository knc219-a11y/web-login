'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { createProxyMiddleware } = require('http-proxy-middleware');

const config = require('./config');
const userStore = require('./db');
const { safeRedirect } = require('./redirect');
const { loginPage } = require('./views');

// 존재하지 않는 계정도 동일한 시간이 걸리도록 비교에 쓰는 더미 해시 (계정 존재 여부 추측 방지)
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

// 간단한 로그인 실패 제한 (IP 기준, 메모리). 서버 여러 대로 운영하면 Redis 등으로 교체 필요.
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;
const failures = new Map(); // ip -> { count, until }

function isLocked(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (f.until && f.until > Date.now()) return true;
  if (f.until && f.until <= Date.now()) failures.delete(ip);
  return false;
}
function recordFail(ip) {
  const f = failures.get(ip) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) f.until = Date.now() + LOCK_MS;
  failures.set(ip, f);
}

function createApp(options = {}) {
  const cfg = { ...config, ...options, kibana: { ...config.kibana, ...(options.kibana || {}) } };
  const store = options.userStore || userStore;
  const redirectOpts = { allowedHosts: cfg.allowedRedirectHosts, fallback: cfg.defaultRedirect };

  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);

  app.use(
    session({
      name: 'weblogin.sid',
      secret: cfg.session.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      // TODO: 서버를 여러 대로 운영하거나 재시작 후에도 세션 유지가 필요하면
      //       connect-redis 등 외부 세션 저장소로 교체하세요. (기본 MemoryStore 는 단일 서버/개발용)
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: cfg.session.cookieSecure,
        maxAge: cfg.session.maxAgeMs,
      },
    }),
  );

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { index: false }));

  const isLoggedIn = (req) => Boolean(req.session && req.session.user);

  // ---------------------------------------------------------------------------
  // 로그인 / 로그아웃
  // ---------------------------------------------------------------------------
  app.get('/login', (req, res) => {
    const next = typeof req.query.next === 'string' ? req.query.next : '';
    if (isLoggedIn(req)) return res.redirect(safeRedirect(next, redirectOpts));
    const notice = req.query.logout ? '로그아웃되었습니다.' : req.query.expired ? '로그인이 필요합니다.' : '';
    res.set('Cache-Control', 'no-store').type('html').send(loginPage({ next, notice }));
  });

  app.post('/login', express.urlencoded({ extended: false, limit: '10kb' }), async (req, res, nextFn) => {
    const { username = '', password = '', next = '' } = req.body || {};
    const ip = req.ip;
    const fail = (status, error) =>
      res.status(status).set('Cache-Control', 'no-store').type('html').send(loginPage({ next, error, username }));

    try {
      if (isLocked(ip)) return fail(429, '로그인 실패가 많아 잠시 후 다시 시도해주세요. (5분)');

      const user = username ? await store.findByUsername(String(username).trim()) : null;
      const ok = await bcrypt.compare(String(password), user ? user.passwordHash : DUMMY_HASH);

      if (!user || !ok || user.enabled === false) {
        recordFail(ip);
        return fail(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
      }

      failures.delete(ip);
      // 세션 고정 공격 방지: 로그인 시 세션 ID 재발급
      req.session.regenerate((err) => {
        if (err) return nextFn(err);
        req.session.user = { id: user.id, username: user.username, displayName: user.displayName };
        req.session.loginAt = Date.now();
        req.session.save((err2) => {
          if (err2) return nextFn(err2);
          // TODO: 필요하면 로그인 이력(감사 로그)을 DB 에 남기세요.
          console.log(`[login] ${user.username} from ${ip}`);
          res.redirect(303, safeRedirect(next, redirectOpts));
        });
      });
    } catch (e) {
      nextFn(e);
    }
  });

  const logout = (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('weblogin.sid');
      res.redirect('/login?logout=1');
    });
  };
  app.post('/logout', logout);
  app.get('/logout', logout);

  // nginx auth_request 등 외부 프록시에서 로그인 여부만 확인할 때 사용 (204: 로그인됨 / 401: 아님)
  app.get('/auth/verify', (req, res) => {
    if (isLoggedIn(req)) {
      res.set('X-Auth-User', req.session.user.username);
      return res.sendStatus(204);
    }
    res.sendStatus(401);
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // ---------------------------------------------------------------------------
  // 보호 구역: 로그인하지 않았으면 로그인 페이지로 (원래 주소를 next 로 전달)
  // ---------------------------------------------------------------------------
  function requireLogin(req, res, nextFn) {
    if (isLoggedIn(req)) return nextFn();
    const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
    if (wantsHtml) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return res.status(401).json({ statusCode: 401, error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  app.get('/', requireLogin, (req, res) => res.redirect(cfg.defaultRedirect));

  // Kibana 리버스 프록시: /kibana/** → KIBANA_URL/kibana/**
  // TODO: 실제 Kibana 의 kibana.yml 에 아래 설정 필요
  //         server.basePath: "/kibana"
  //         server.rewriteBasePath: true
  //       그리고 Kibana 포트(5601)는 방화벽으로 막고 이 서버를 통해서만 접근하게 하세요.
  const kibanaProxy = createProxyMiddleware({
    target: cfg.kibana.url,
    changeOrigin: true,
    ws: false, // Kibana 는 일반 HTTP 로 동작. 웹소켓을 켜려면 업그레이드 요청에도 로그인 검사를 추가해야 함
    on: {
      proxyReq: (proxyReq, req) => {
        // 쿠키는 그대로 전달하되 이 서버의 세션 쿠키는 Kibana 로 넘기지 않음
        const cookie = proxyReq.getHeader('cookie');
        if (cookie) {
          const filtered = String(cookie)
            .split(';')
            .map((c) => c.trim())
            .filter((c) => c && !c.startsWith('weblogin.sid='))
            .join('; ');
          if (filtered) proxyReq.setHeader('cookie', filtered);
          else proxyReq.removeHeader('cookie');
        }
        // TODO: Kibana 쪽에서 사용자를 식별해야 하면 헤더로 전달 (Elastic 보안/프록시 인증 설정 필요)
        if (req.session && req.session.user) proxyReq.setHeader('X-Forwarded-User', req.session.user.username);
      },
      error: (err, req, res) => {
        console.error('[kibana-proxy]', err.message);
        if (res && typeof res.status === 'function' && !res.headersSent) {
          res.status(502).type('html').send(
            `<h1>Kibana 에 연결할 수 없습니다</h1><p>KIBANA_URL(${cfg.kibana.url}) 설정과 Kibana 실행 상태를 확인하세요.</p>`,
          );
        }
      },
    },
  });

  const base = cfg.kibana.basePath;
  app.use((req, res, nextFn) => {
    if (req.path === base || req.path.startsWith(base + '/')) {
      return requireLogin(req, res, () => kibanaProxy(req, res, nextFn));
    }
    nextFn();
  });

  app.use((req, res) => res.status(404).type('text').send('Not Found'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).type('text').send('Internal Server Error');
  });

  app.kibanaProxy = kibanaProxy;
  return app;
}

module.exports = { createApp };
