'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const express = require('express');
const { createApp } = require('../src/app');
const { safeRedirect } = require('../src/redirect');

let kibana, gateway, base;

function listen(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
}

before(async () => {
  const k = express();
  k.use('/kibana', (req, res) => res.type('html').send(`KIBANA ${req.originalUrl} user=${req.headers['x-forwarded-user']} cookie=${req.headers.cookie || ''}`));
  kibana = await listen(k);
  const app = createApp({ kibana: { url: `http://127.0.0.1:${kibana.address().port}`, basePath: '/kibana' }, defaultRedirect: '/kibana/app/home' });
  gateway = await listen(app);
  base = `http://127.0.0.1:${gateway.address().port}`;
});

after(() => { kibana.close(); gateway.close(); });

const get = (url, headers = {}) => fetch(base + url, { redirect: 'manual', headers: { accept: 'text/html', ...headers } });
const login = (body) => fetch(base + '/login', {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
});

test('비로그인 Kibana 접근 → 로그인 페이지로 (원래 주소 유지)', async () => {
  const r = await get('/kibana/app/discover?q=1');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), '/login?next=' + encodeURIComponent('/kibana/app/discover?q=1'));
});

test('비로그인 API 요청 → 401', async () => {
  const r = await fetch(base + '/kibana/api/status', { headers: { accept: 'application/json' } });
  assert.strictEqual(r.status, 401);
});

test('잘못된 비밀번호 → 401', async () => {
  const r = await login({ username: 'admin', password: 'wrong', next: '/kibana/app/home' });
  assert.strictEqual(r.status, 401);
});

test('로그인 성공 → 원래 페이지로 리다이렉트 → Kibana 프록시', async () => {
  const r = await login({ username: 'admin', password: 'admin123', next: '/kibana/app/discover?q=1' });
  assert.strictEqual(r.status, 303);
  assert.strictEqual(r.headers.get('location'), '/kibana/app/discover?q=1');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const k = await get('/kibana/app/discover?q=1', { cookie: cookie + '; other=1' });
  assert.strictEqual(k.status, 200);
  const text = await k.text();
  assert.match(text, /KIBANA \/kibana\/app\/discover\?q=1 user=admin/);
  assert.doesNotMatch(text, /weblogin\.sid/, '세션 쿠키는 Kibana 로 전달되지 않아야 함');

  const v = await get('/auth/verify', { cookie });
  assert.strictEqual(v.status, 204);

  const out = await get('/logout', { cookie });
  assert.strictEqual(out.status, 302);
  const after = await get('/kibana/app/home', { cookie });
  assert.strictEqual(after.status, 302);
});

test('외부 주소로의 리다이렉트는 차단 (Open Redirect 방지)', async () => {
  const r = await login({ username: 'user', password: 'user123', next: '//evil.example.com' });
  assert.strictEqual(r.headers.get('location'), '/kibana/app/home');
});

test('safeRedirect 규칙', () => {
  const o = { allowedHosts: ['kibana.internal:5601'], fallback: '/home' };
  assert.strictEqual(safeRedirect('/kibana/app/x', o), '/kibana/app/x');
  assert.strictEqual(safeRedirect('https://evil.com', o), '/home');
  assert.strictEqual(safeRedirect('/\\evil.com', o), '/home');
  assert.strictEqual(safeRedirect('javascript:alert(1)', o), '/home');
  assert.strictEqual(safeRedirect('http://kibana.internal:5601/app/home', o), 'http://kibana.internal:5601/app/home');
  assert.strictEqual(safeRedirect('/login?next=/x', o), '/home');
});
