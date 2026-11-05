'use strict';
// 사용법: npm run hash -- <비밀번호>
const bcrypt = require('bcryptjs');
const pw = process.argv[2];
if (!pw) {
  console.error('사용법: npm run hash -- <비밀번호>');
  process.exit(1);
}
console.log(bcrypt.hashSync(pw, 10));
