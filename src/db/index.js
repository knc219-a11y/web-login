'use strict';

/**
 * 사용자 저장소 선택.
 *
 * 모든 저장소는 아래 인터페이스만 구현하면 됩니다.
 *
 *   findByUsername(username) => Promise<{
 *     id, username, passwordHash (bcrypt), displayName, enabled
 *   } | null>
 *
 * TODO: 내부망 DB 연결 방법
 *   1) 드라이버 설치:  npm i mysql2   (PostgreSQL 이면 npm i pg)
 *   2) 아래 예시처럼 src/db/mysqlUserStore.js 를 작성
 *   3) .env 에서 DB_TYPE=mysql 및 DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD 설정
 *   4) 아래 switch 의 'mysql' 케이스 주석 해제
 *
 * --- src/db/mysqlUserStore.js 예시 ---------------------------------------
 * const mysql = require('mysql2/promise');
 * const { db } = require('../config');
 * const pool = mysql.createPool({
 *   host: db.host, port: db.port, database: db.name, user: db.user, password: db.password,
 *   connectionLimit: 10,
 * });
 * module.exports = {
 *   async findByUsername(username) {
 *     // TODO: 실제 테이블/컬럼명에 맞게 수정
 *     const [rows] = await pool.query(
 *       'SELECT id, username, password_hash AS passwordHash, display_name AS displayName, enabled ' +
 *       'FROM users WHERE username = ? LIMIT 1',
 *       [username],
 *     );
 *     return rows[0] ? { ...rows[0], enabled: !!rows[0].enabled } : null;
 *   },
 * };
 * ------------------------------------------------------------------------
 *
 * 테이블 예시는 db/schema.sql 참고.
 */

const config = require('../config');

function createUserStore() {
  switch (config.db.type) {
    case 'memory':
      return require('./memoryUserStore');
    // TODO: 실제 DB 구현 후 주석 해제
    // case 'mysql':
    //   return require('./mysqlUserStore');
    // case 'postgres':
    //   return require('./postgresUserStore');
    default:
      throw new Error(`지원하지 않는 DB_TYPE 입니다: ${config.db.type} (src/db/index.js 확인)`);
  }
}

module.exports = createUserStore();
