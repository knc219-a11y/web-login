// Kibana 는 화면 상태를 URL 해시(#/...)에 담습니다. 해시는 서버로 전송되지 않으므로
// 로그인 폼 제출 시 원래 주소(next)에 붙여서 로그인 후에도 같은 화면으로 돌아가게 합니다.
(function () {
  var form = document.querySelector('form');
  var next = form && form.querySelector('input[name="next"]');
  if (!form || !next) return;
  form.addEventListener('submit', function () {
    if (location.hash && next.value && next.value.indexOf('#') === -1) next.value += location.hash;
  });
})();
