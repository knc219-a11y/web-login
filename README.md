# web-login

Kibana(ELK) 앞단에 두는 **로그인 게이트웨이**입니다.
로그인하지 않은 사용자가 Kibana 화면에 접근하면 로그인 페이지로 보내고, 로그인에 성공하면 **원래 요청했던 Kibana 화면으로 리다이렉트**합니다.

현재는 내부망 이전 전 **뼈대** 단계입니다. DB 와 Kibana 는 임시(Mock)로 연결되어 있고,
내부망에서 수정할 곳은 모두 `TODO` 로 표시해 두었습니다. (`grep -rn TODO --exclude-dir=node_modules .`)

> ✅ **Keycloak + Spring 게이트웨이 구성은 [`auth-stack/`](auth-stack/README.md) 에 있습니다.** 아래 Node 게이트웨이는 이전 방식(참고용)입니다.
>
> 📄 구조 검토 문서: [docs/architecture-review.md](docs/architecture-review.md)

## 동작 흐름

```
브라우저 ──▶ http://<게이트웨이>/kibana/app/discover#/...
             │ 로그인 안 됨
             ▼
           /login?next=/kibana/app/discover   (해시 #/... 도 유지)
             │ 아이디/비밀번호 확인 (DB)
             ▼
           303 → /kibana/app/discover#/...
             │ 로그인 됨
             ▼
           게이트웨이가 Kibana 로 프록시 (KIBANA_URL)
```

- Kibana 포트(5601)는 방화벽으로 막고 이 게이트웨이를 통해서만 접근하게 하는 구성을 권장합니다.
- 로그인 후 이동 주소는 검증합니다. 내부 경로(`/...`)와 `ALLOWED_REDIRECT_HOSTS` 에 등록된 호스트만 허용합니다 (Open Redirect 방지).

## 빠른 실행 (로컬 테스트)

Node.js 18 이상이 필요합니다.

```bash
git clone https://github.com/knc219-a11y/web-login.git
cd web-login
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run dev                 # Mock Kibana(5601) + 로그인 서버(3000) 동시 실행
```

브라우저에서 http://localhost:3000/kibana/app/discover 를 열면 로그인 페이지로 이동합니다.

| 테스트 계정 | 비밀번호 |
|---|---|
| admin | admin123 |
| user | user123 |

로그인하면 원래 열려던 `/kibana/app/discover` (임시 Kibana 페이지)로 이동합니다.

자동 테스트: `npm test`

## 주요 URL

| 경로 | 설명 |
|---|---|
| `/login` | 로그인 페이지 (`?next=<원래 주소>`) |
| `/logout` | 로그아웃 |
| `/kibana/**` | 로그인 필요. Kibana 로 프록시 |
| `/` | 로그인 후 `DEFAULT_REDIRECT` 로 이동 |
| `/auth/verify` | 로그인 여부 확인용 (204/401). nginx `auth_request` 연동 시 사용 |
| `/healthz` | 헬스체크 |

## 내부망 이전 시 수정할 곳 (TODO)

### 1. Kibana 연결
- `.env` → `KIBANA_URL` 을 실제 Kibana 주소로 변경 (예: `http://10.0.0.5:5601`)
- Kibana `kibana.yml` 에 아래 설정 추가 후 재시작
  ```yaml
  server.basePath: "/kibana"
  server.rewriteBasePath: true
  ```
- `.env` → `DEFAULT_REDIRECT` : 로그인 후 기본으로 열 Kibana 화면 (예: 특정 대시보드 `/kibana/app/dashboards#/view/<id>`)
- Mock Kibana(`mock/kibana-mock.js`) 는 더 이상 필요 없습니다. `npm start` 로 게이트웨이만 실행하세요.

> Kibana 를 프록시하지 않고 Kibana 주소로 **직접 리다이렉트**만 하고 싶다면
> `DEFAULT_REDIRECT=http://kibana.internal:5601/app/home`, `ALLOWED_REDIRECT_HOSTS=kibana.internal:5601` 처럼 설정하면 됩니다.
> 단, 이 경우 Kibana 자체는 보호되지 않으므로 nginx `auth_request` 로 `/auth/verify` 를 확인하는 등의 추가 구성이 필요합니다.

### 2. DB 연결
- `src/db/memoryUserStore.js` : 지금 쓰는 임시 사용자 목록
- `src/db/index.js` : DB 선택 + **MySQL 구현 예시 코드**(주석) 포함
- `db/schema.sql` : 사용자 테이블 예시
- 순서
  1. `npm i mysql2` (PostgreSQL 이면 `npm i pg`)
  2. `src/db/index.js` 주석의 예시대로 `src/db/mysqlUserStore.js` 작성 (테이블/컬럼명 맞게 수정)
  3. `src/db/index.js` 의 `case 'mysql'` 주석 해제
  4. `.env` 에 `DB_TYPE=mysql`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` 설정
- 비밀번호는 bcrypt 해시로 저장합니다. 해시 생성: `npm run hash -- <비밀번호>`

### 3. 운영 설정
- `.env` → `SESSION_SECRET` 을 랜덤 값으로 변경 (설정 안 하면 경고 출력)
- HTTPS 사용 시 `COOKIE_SECURE=true`, 앞단에 nginx 등 프록시가 있으면 `TRUST_PROXY=true`
- 세션은 기본 메모리 저장이라 서버 재시작 시 로그아웃됩니다. 여러 대로 운영하면 Redis 등으로 교체 (`src/app.js` TODO)
- 로그인 화면 문구/로고: `src/views.js`, `public/login.css`

### 내부망에 npm 저장소가 없다면
인터넷이 되는 PC에서 `npm install` 후 `node_modules` 폴더째 복사하거나, `npm pack` 등으로 묶어서 옮기세요.

## 폴더 구조

```
src/
  server.js          서버 시작
  app.js             로그인/로그아웃, 인증 검사, Kibana 프록시
  config.js          .env 설정 읽기
  redirect.js        리다이렉트 주소 검증
  views.js           로그인 페이지 HTML
  db/index.js        사용자 저장소 선택 (TODO: 실제 DB)
  db/memoryUserStore.js  임시 사용자 (TODO)
public/              로그인 페이지 CSS/JS
mock/kibana-mock.js  임시 Kibana (TODO: 실제 Kibana 연결 후 불필요)
db/schema.sql        사용자 테이블 예시
scripts/             dev 실행, 비밀번호 해시 생성
test/                자동 테스트
```

## 보안 메모
- 로그인 시 세션 ID 재발급 (세션 고정 방지), 쿠키 `HttpOnly` + `SameSite=Lax`
- 같은 IP 로그인 5회 실패 시 5분 잠금 (메모리 기준)
- 존재하지 않는 계정도 같은 시간이 걸리도록 처리 (계정 존재 여부 추측 방지)
- 게이트웨이 세션 쿠키는 Kibana 로 전달하지 않음, 로그인 사용자명은 `X-Forwarded-User` 헤더로 전달
