'use strict';

/**
 * TODO: 임시 Mock Kibana. 내부망에서 실제 Kibana 를 연결하면 필요 없습니다.
 *       (auth-stack/.env 의 KIBANA_UPSTREAM 을 실제 Kibana 주소로 변경)
 *
 * 외부 패키지 없이 Node 기본 모듈만 사용합니다.
 * Kibana 의 server.basePath="/kibana", server.rewriteBasePath=true 를 흉내내 /kibana/** 로 응답합니다.
 */
const http = require('http');

const PORT = Number(process.env.PORT || 5601);
const BASE = '/kibana';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

http
  .createServer((req, res) => {
    if (!req.url.startsWith(BASE)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('not found (mock kibana)');
    }
    if (req.url.startsWith(`${BASE}/api/status`)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ name: 'mock-kibana', status: { overall: { level: 'available' } } }));
    }
    // oauth2-proxy 가 넘겨주는 사용자 정보 헤더
    const user = req.headers['x-forwarded-preferred-username'] || req.headers['x-forwarded-user'] || '(unknown)';
    const email = req.headers['x-forwarded-email'] || '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Mock Kibana</title>
<style>body{font-family:sans-serif;margin:0}header{background:#343741;color:#fff;padding:12px 20px;display:flex;justify-content:space-between;align-items:center}
main{padding:24px}a{color:#0077cc}code{background:#eef;padding:2px 6px;border-radius:4px}header a{color:#fff}</style></head>
<body><header><strong>Mock Kibana (임시 페이지)</strong><span>로그인 사용자: <b id="user">${esc(user)}</b> ${esc(email)} · <a href="/logout">로그아웃</a></span></header>
<main><h1 id="title">Kibana 화면 자리</h1>
<p>요청 경로: <code id="path">${esc(req.url)}</code></p>
<p>Keycloak 로그인 → oauth2-proxy → Kibana 흐름 테스트용 가짜 Kibana 입니다.</p>
<ul><li><a href="${BASE}/app/home">${BASE}/app/home</a></li>
<li><a href="${BASE}/app/discover?_a=(query:(query:'error'))">${BASE}/app/discover</a></li>
<li><a href="${BASE}/app/dashboards">${BASE}/app/dashboards</a></li></ul></main></body></html>`);
  })
  .listen(PORT, () => console.log(`[mock-kibana] :${PORT}${BASE}`));
