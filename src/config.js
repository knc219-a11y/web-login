'use strict';

require('dotenv').config();

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function list(v) {
  return (v || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const config = {
  port: Number(process.env.PORT || 3000),

  session: {
    // TODO: 운영 환경에서는 반드시 .env 의 SESSION_SECRET 을 랜덤 값으로 설정하세요.
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
    maxAgeMs: Number(process.env.SESSION_MAX_AGE_MINUTES || 480) * 60 * 1000,
    cookieSecure: bool(process.env.COOKIE_SECURE, false),
  },
  trustProxy: bool(process.env.TRUST_PROXY, false),

  kibana: {
    // TODO: 내부망 Kibana 주소로 변경 (.env 의 KIBANA_URL)
    url: process.env.KIBANA_URL || 'http://localhost:5601',
    basePath: (process.env.KIBANA_BASE_PATH || '/kibana').replace(/\/+$/, ''),
  },

  // TODO: 로그인 후 기본 이동 페이지 (.env 의 DEFAULT_REDIRECT)
  defaultRedirect: process.env.DEFAULT_REDIRECT || '/kibana/app/home',
  allowedRedirectHosts: list(process.env.ALLOWED_REDIRECT_HOSTS),

  db: {
    // TODO: 내부망 DB 연결 시 DB_TYPE 및 접속 정보 변경 (.env)
    type: (process.env.DB_TYPE || 'memory').toLowerCase(),
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
};

if (!process.env.SESSION_SECRET) {
  console.warn('[config] SESSION_SECRET 이 설정되지 않아 개발용 기본값을 사용합니다. 운영 환경에서는 반드시 설정하세요.');
}

module.exports = config;
