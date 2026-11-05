'use strict';

/**
 * 임시(메모리) 사용자 저장소.
 *
 * TODO: 내부망 DB 연결 후에는 이 파일 대신 실제 DB 구현체(예: mysqlUserStore.js)를 사용하세요.
 *       src/db/index.js 에서 DB_TYPE 에 따라 선택됩니다.
 *
 * 테스트 계정 (개발용)
 *   - admin / admin123
 *   - user  / user123
 *
 * 비밀번호는 bcrypt 해시로만 저장합니다. 새 해시 생성:
 *   npm run hash -- <비밀번호>
 */

const USERS = [
  {
    id: 1,
    username: 'admin',
    // admin123
    passwordHash: '$2b$10$WF6eUi2WYvtYNvxpHgjh1OhfTXSGkvovPFDnpFZfzcTLjlPmm9tO2',
    displayName: '관리자',
    enabled: true,
  },
  {
    id: 2,
    username: 'user',
    // user123
    passwordHash: '$2b$10$my04gZrubv.J/pJ0WfgtnOvkUniTNeKs4CGwlW7N2X.j9Ytn0A3KW',
    displayName: '일반사용자',
    enabled: true,
  },
];

module.exports = {
  async findByUsername(username) {
    return USERS.find((u) => u.username === username) || null;
  },
};
