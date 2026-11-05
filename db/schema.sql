-- TODO: 내부망 DB 에 맞게 수정해서 사용하세요. (MySQL 기준 예시)
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,   -- bcrypt 해시 (npm run hash -- <비밀번호> 로 생성)
  display_name  VARCHAR(100),
  enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 예시 계정: admin / admin123
INSERT INTO users (username, password_hash, display_name)
VALUES ('admin', '$2b$10$WF6eUi2WYvtYNvxpHgjh1OhfTXSGkvovPFDnpFZfzcTLjlPmm9tO2', '관리자');
