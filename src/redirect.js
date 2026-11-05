'use strict';

/**
 * 로그인 후 이동할 주소 검증 (Open Redirect 방지).
 *  - "/..." 형태의 이 서버 내부 경로는 허용 ("//evil.com" 같은 프로토콜 상대 URL 은 거부)
 *  - http(s) 절대 URL 은 ALLOWED_REDIRECT_HOSTS 에 등록된 호스트만 허용
 *  - 그 외에는 fallback(DEFAULT_REDIRECT) 사용
 */
function safeRedirect(target, { allowedHosts = [], fallback = '/' } = {}) {
  if (typeof target !== 'string' || target.length === 0 || target.length > 2048) return fallback;
  if (/[\u0000-\u001f\\]/.test(target)) return fallback;

  if (target.startsWith('/') && !target.startsWith('//')) {
    if (target === '/login' || target.startsWith('/login?') || target.startsWith('/logout')) return fallback;
    return target;
  }

  try {
    const u = new URL(target);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && allowedHosts.includes(u.host.toLowerCase())) {
      return u.toString();
    }
  } catch (_) {
    /* invalid URL */
  }
  return fallback;
}

module.exports = { safeRedirect };
