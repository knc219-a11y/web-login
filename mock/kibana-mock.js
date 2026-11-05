'use strict';

/**
 * TODO: 임시 Mock Kibana. 내부망에서 실제 Kibana 와 연결하면 이 파일은 필요 없습니다.
 *       (.env 의 KIBANA_URL 을 실제 Kibana 주소로 바꾸세요)
 *
 * 실제 Kibana 의 server.basePath="/kibana", server.rewriteBasePath=true 설정을 흉내내어
 * /kibana/** 경로로 응답합니다.
 */
const express = require('express');

const PORT = Number(process.env.MOCK_KIBANA_PORT || 5601);
const BASE = '/kibana';
const app = express();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

app.get(`${BASE}/api/status`, (req, res) => res.json({ name: 'mock-kibana', status: { overall: { level: 'available' } } }));

app.use(BASE, (req, res) => {
  const user = req.headers['x-forwarded-user'] || '(unknown)';
  res.type('html').send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Mock Kibana</title>
<style>body{font-family:sans-serif;margin:0}header{background:#343741;color:#fff;padding:12px 20px;display:flex;justify-content:space-between;align-items:center}
main{padding:24px}a{color:#0077cc}code{background:#eef;padding:2px 6px;border-radius:4px}header a{color:#fff}</style></head>
<body><header><strong>Mock Kibana (임시 페이지)</strong><span>로그인 사용자: <b id="user">${esc(user)}</b> · <a href="/logout">로그아웃</a></span></header>
<main><h1 id="title">Kibana 화면 자리</h1>
<p>요청 경로: <code id="path">${esc(req.originalUrl)}</code></p>
<p>이 페이지는 로그인 → 리다이렉트 흐름 테스트용 가짜 Kibana 입니다. 실제 환경에서는 <code>KIBANA_URL</code> 을 내부망 Kibana 로 바꾸세요.</p>
<ul><li><a href="${BASE}/app/home">${BASE}/app/home</a></li>
<li><a href="${BASE}/app/discover#/?_a=(query:(query:'error'))">${BASE}/app/discover</a></li>
<li><a href="${BASE}/app/dashboards">${BASE}/app/dashboards</a></li></ul></main></body></html>`);
});

app.listen(PORT, () => console.log(`[mock-kibana] http://localhost:${PORT}${BASE}`));
