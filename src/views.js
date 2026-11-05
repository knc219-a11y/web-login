'use strict';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loginPage({ next = '', error = '', username = '', notice = '' } = {}) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>로그인</title>
<link rel="stylesheet" href="/static/login.css">
</head>
<body>
  <main class="card">
    <!-- TODO: 회사/서비스명, 로고로 변경 -->
    <h1>모니터링 로그인</h1>
    <p class="sub">로그인 후 요청하신 Kibana 화면으로 이동합니다.</p>
    ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
    ${error ? `<div class="error" role="alert">${esc(error)}</div>` : ''}
    <form method="post" action="/login" autocomplete="on">
      <input type="hidden" name="next" value="${esc(next)}">
      <label for="username">아이디</label>
      <input id="username" name="username" value="${esc(username)}" required autofocus autocomplete="username">
      <label for="password">비밀번호</label>
      <input id="password" name="password" type="password" required autocomplete="current-password">
      <button type="submit">로그인</button>
    </form>
  </main>
  <script src="/static/login.js"></script>
</body>
</html>`;
}

module.exports = { loginPage, esc };
