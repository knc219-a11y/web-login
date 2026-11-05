# 기술스택 가이드 (기능 · 설정 파일 · 사용법 · 주의점)

이 문서는 `auth-stack/` 에서 쓰는 기술을 **처음 써 보는 Spring/Java 개발자** 기준으로 정리한 것입니다.
이 구성은 로그인 기능을 **코드 없이 설정으로만** 처리합니다. 개발자가 관리하는 것은 설정 파일(Keycloak realm JSON, oauth2-proxy `.cfg`, `docker-compose.yml`, `.env`)입니다.
각 기술마다 "이 시스템에서 하는 일 → 저장소의 설정 파일 → 실행/수정 방법 → 내부망에서 자주 막히는 점" 순서로 적었습니다.

> 구조를 왜 이렇게 정했는지는 [architecture-review.md](architecture-review.md), 실행 절차는 [auth-stack/README.md](../auth-stack/README.md) 를 보세요.

## 0. 한 장 요약

```
브라우저 ─▶ HAProxy (사내 기존 장비, 설정만 추가)
             ├─ /auth/**  ─▶ Keycloak :8080 ──▶ PostgreSQL     (로그인 화면, 계정, OTP)
             └─ 그 외     ─▶ oauth2-proxy :4180 ──▶ Kibana :5601
                               └─ 세션 저장: Redis
```

| 기술 | 한 줄 역할 | 누가 관리 | 코드 작성? |
|---|---|---|---|
| Keycloak | 로그인 화면, 계정·그룹, 비밀번호 정책, 잠금, OTP | 개발자 | ✕ (설정만) |
| PostgreSQL | Keycloak 의 데이터 저장소 | 개발자/DBA | ✕ |
| Redis | oauth2-proxy 로그인 세션 저장 | 개발자 | ✕ |
| oauth2-proxy | 로그인 확인 → 원래 화면으로 리다이렉트 → Kibana 로 프록시 | 개발자 | ✕ (설정만) |
| HAProxy | 외부 진입점, 경로별 분기 | 인프라 | ✕ (설정 조각 전달) |
| Docker Compose | 위 컨테이너들을 한 번에 실행 | 개발자 | ✕ |
| Kibana | 보호 대상. `basePath=/kibana` 설정만 필요 | ELK 담당 | ✕ |

로그인 한 번의 흐름:

1. 사용자가 `https://<도메인>/kibana/app/discover` 접속 → HAProxy → oauth2-proxy
2. oauth2-proxy 가 쿠키가 없음을 확인 → **원래 URL 을 기억**한 채 Keycloak 로그인 화면으로 302
3. 사용자가 Keycloak 에서 아이디/비밀번호(+OTP) 입력 → Keycloak 이 `code` 를 들고 `/oauth2/callback` 으로 302
4. oauth2-proxy 가 Keycloak 에 `code` → 토큰 교환 (서버 간 통신), 세션을 Redis 에 저장, 쿠키(`_kibana_auth`) 발급
5. 2번에서 기억해 둔 **원래 URL 로 302** → 이후 요청은 oauth2-proxy 가 Kibana 로 프록시

---

## 1. Keycloak

### 이 시스템에서 하는 일
- 로그인 화면(한국어), 아이디/비밀번호 확인, 로그인 실패 잠금, 비밀번호 정책
- 사용자·그룹(`kibana-users`, `kibana-admins`) 관리, 관리 콘솔 제공
- OIDC(OpenID Connect) 표준으로 oauth2-proxy 에 "이 사람 로그인 됐음" 을 토큰으로 알려 줌
- 필요하면 2단계 인증(OTP), LDAP/AD 연동, 비밀번호 찾기 메일 등을 **코드 없이** 켤 수 있음

Spring 개발자 관점에서 보면 "Spring Security 의 로그인 폼 + UserDetailsService + 사용자 관리 화면" 을 통째로 별도 서버로 뺀 것입니다.

### 핵심 용어
| 용어 | 뜻 | 이 저장소 값 |
|---|---|---|
| Realm | 사용자/설정 묶음 (테넌트) | `kibana` |
| Client | Keycloak 에 로그인을 맡기는 애플리케이션 | `oauth2-proxy` |
| Client secret | oauth2-proxy 가 Keycloak 에 토큰 받을 때 쓰는 비밀번호 | `.env` 의 `OAUTH2_PROXY_CLIENT_SECRET` |
| Redirect URI | 로그인 후 돌려보내도 되는 주소 목록 | `${PUBLIC_URL}/oauth2/callback` |
| Issuer | 토큰 발급자 주소. oauth2-proxy 가 이 값으로 토큰을 검증 | `${PUBLIC_URL}/auth/realms/kibana` |

### 저장소의 설정 파일
| 파일 | 내용 |
|---|---|
| `auth-stack/keycloak/realm-kibana.json` | realm 전체 설정: 클라이언트, 그룹, 비밀번호 정책(`length(8) and notUsername`), 잠금(5회 실패), 세션 시간, 한국어, 테스트 계정 |
| `auth-stack/docker-compose.yml` 의 `keycloak` 서비스 | 이미지 버전, DB 연결(`KC_DB_*`), 공개 주소(`KC_HOSTNAME`), 경로 접두어(`KC_HTTP_RELATIVE_PATH=/auth`) |
| `auth-stack/.env` | 관리자 계정, DB 비밀번호, client secret |

### 사용법
- 관리 콘솔: `${PUBLIC_URL}/auth/admin` → 왼쪽 위에서 realm 을 **kibana** 로 바꾼 뒤 작업 (master realm 은 관리자 전용)
- 사용자 추가: Users → Add user → 저장 후 Credentials 탭에서 비밀번호 설정 (Temporary 끄기) → Groups 탭에서 `kibana-users` 가입
- 잠긴 계정 풀기: Users → 해당 사용자 → 상단 경고 배너의 잠금 해제, 또는 Realm settings → Security defenses → Brute force detection
- 세션 강제 종료: Sessions 메뉴에서 사용자 세션 Sign out (oauth2-proxy 쪽은 다음 토큰 갱신 때, 최대 5분 뒤 반영)

**중요: `realm-kibana.json` 은 최초 import 때만 적용됩니다.** `--import-realm` 은 realm 이 이미 DB 에 있으면 건너뜁니다.
- 운영 중 변경 → 관리 콘솔에서 수정
- 저장소에도 남기려면 → Realm settings → 오른쪽 위 Action → Partial export → JSON 을 `realm-kibana.json` 에 반영 (export 결과에는 secret 이 `**********` 로 가려지니 `${...}` 자리로 되돌려 놓기)
- 로컬에서 JSON 을 고치고 다시 적용하려면 `docker compose down -v` (DB 삭제) 후 재기동

### 2단계 인증(Google OTP) 켜는 법 — 나중에 필요할 때
Keycloak 에 TOTP 가 내장되어 있고 Google Authenticator / Microsoft Authenticator 앱과 그대로 호환됩니다. oauth2-proxy 설정은 바꿀 필요가 없습니다.

**전원 필수로 켜기 (가장 간단)**
1. 관리 콘솔 → realm `kibana` → Authentication → Policies → **OTP Policy**: 기본값(TOTP, 6자리, 30초, SHA1) 그대로 두기 (Google Authenticator 는 SHA1/6자리/30초만 확실히 지원)
2. Authentication → Required actions 탭 → **Configure OTP** 의 "Set as default action" 켜기 → 이후 **새로 만드는** 사용자는 첫 로그인 때 QR 등록 화면이 뜸
3. 기존 사용자: Users → 사용자 → Required user actions 에 `Configure OTP` 추가
4. Authentication → Flows → `browser` 흐름의 **Browser - Conditional OTP** 가 Conditional 이면, OTP 를 등록한 사용자에게는 자동으로 OTP 를 묻습니다. 등록 안 한 사람도 막으려면 해당 단계를 **Required** 로 변경 (기본 flow 는 직접 수정이 안 되니 Duplicate 해서 고친 뒤 Bind flow → Browser flow)

**특정 그룹만 필수 (예: 관리자만)**
- 위 4번에서 복제한 flow 의 Conditional OTP 하위에 `Condition - User role` 추가 → 역할 지정 (그룹 대신 realm role 을 만들고 `kibana-admins` 그룹에 매핑)

**realm 파일로 남길 때** (새로 구축하는 환경에 처음부터 적용)
```json
"otpPolicyType": "totp",
"otpPolicyAlgorithm": "HmacSHA1",
"otpPolicyDigits": 6,
"otpPolicyPeriod": 30,
"requiredActions": [
  { "alias": "CONFIGURE_TOTP", "name": "Configure OTP", "providerId": "CONFIGURE_TOTP",
    "enabled": true, "defaultAction": true, "priority": 10, "config": {} }
]
```

주의: OTP 는 **서버 시간**이 맞아야 합니다. 내부망 서버에 NTP 가 안 맞으면 코드가 계속 틀렸다고 나옵니다 (±30초 이상 차이). OTP 를 잃어버린 사용자는 관리 콘솔 → Users → Credentials 에서 OTP 를 삭제하면 다음 로그인 때 다시 등록합니다.

### 내부망 주의점
- **`KC_HOSTNAME` = 브라우저가 실제로 보는 주소**여야 합니다 (`https://도메인/auth`). 틀리면 로그인 화면 CSS 깨짐, 무한 리다이렉트, 토큰 issuer 불일치가 납니다.
- HAProxy 가 `X-Forwarded-Proto` / `X-Forwarded-For` 를 넘겨야 합니다 (`KC_PROXY_HEADERS=xforwarded`). 안 넘기면 https 로 접속해도 Keycloak 이 http 링크를 만듭니다.
- `sslRequired: external` 이라 사설 IP 가 아닌 곳에서 http 로 접근하면 "HTTPS required" 가 뜹니다. 운영은 HAProxy 에서 TLS 를 적용하세요.
- 이미지 `quay.io/keycloak/keycloak` 는 Docker Hub 가 아니라 **quay.io** 입니다. 사내 프록시/미러에서 quay.io 를 허용하거나 `docker save/load` 로 옮기세요.
- 첫 기동은 DB 스키마 생성 때문에 30초~1분 걸립니다. 그 사이 502 는 정상입니다.
- 관리 콘솔(`/auth/admin`)은 HAProxy 에서 관리자 대역만 허용하는 것을 권장합니다.

---

## 2. PostgreSQL

### 이 시스템에서 하는 일
Keycloak 전용 DB 입니다. 사용자, 비밀번호 해시, 그룹, OTP 시크릿, realm 설정이 들어갑니다. **oauth2-proxy 는 DB 를 쓰지 않습니다.**

### 설정 위치
- `auth-stack/docker-compose.yml` 의 `postgres` 서비스 (`postgres:16-alpine`, 볼륨 `pgdata`)
- `auth-stack/.env` 의 `KC_DB_URL`, `KC_DB_USERNAME`, `KC_DB_PASSWORD`
- 테이블은 Keycloak 이 첫 기동 때 자동 생성 (Liquibase). 직접 DDL 을 만들 필요 없음

### 사용법
- 접속 (컨테이너): `docker compose exec postgres psql -U keycloak -d keycloak`
- IntelliJ: Database 창 → `+` → PostgreSQL → `localhost:5432` (로컬에서 보려면 `postgres` 서비스에 `ports: ["5432:5432"]` 추가)
- 백업: `docker compose exec postgres pg_dump -U keycloak keycloak > keycloak.sql`
- **테이블을 직접 수정하지 마세요.** 사용자/설정 변경은 관리 콘솔이나 Admin REST API 로 합니다. (캐시 때문에 DB 를 고쳐도 바로 반영되지 않고 꼬일 수 있음)

### 사내 기존 DB 를 쓰려면
1. DBA 에게 DB `keycloak` + 계정 생성 요청 (해당 DB 에 테이블 생성 권한 필요)
2. `.env` 의 `KC_DB_URL=jdbc:postgresql://<IP>:5432/keycloak` 로 변경
3. `docker-compose.yml` 에서 `postgres` 서비스와 `keycloak.depends_on.postgres` 제거
- MySQL/MariaDB/Oracle/MSSQL 도 지원합니다 (`KC_DB=mysql` 등). 단 Keycloak 버전별 지원 DB 버전을 확인하세요.

### 내부망 주의점
- `docker compose down -v` 는 **DB 볼륨까지 삭제**합니다. 운영에서는 `-v` 금지.
- DB 방화벽: Keycloak 서버 → DB 5432 포트가 열려 있어야 합니다.
- 비밀번호에 `$` 가 있으면 `.env` 에서 `$$` 로 써야 합니다 (Compose 변수 치환).

---

## 3. Redis

### 이 시스템에서 하는 일
oauth2-proxy 의 **로그인 세션 저장소**입니다. 쿠키에는 세션 ID 만 들어가고 토큰은 Redis 에 저장되므로
- 쿠키가 작아지고 (토큰을 쿠키에 넣으면 4KB 제한에 걸리기 쉬움)
- oauth2-proxy 를 재시작해도 사용자가 다시 로그인하지 않아도 되고
- oauth2-proxy 를 2대 이상 띄워도 HAProxy 가 아무 쪽으로 보내도 됩니다 (sticky session 불필요)

### 설정 위치
- `auth-stack/docker-compose.yml` 의 `redis` 서비스 (`redis:7-alpine`, 디스크 저장 끔: `--save "" --appendonly no`)
- `auth-stack/oauth2-proxy/oauth2-proxy.cfg` 의 `session_store_type = "redis"`, `redis_connection_url`

### 사용법
- 세션 확인: `docker compose exec redis redis-cli` → `KEYS *` (`_kibana_auth-...` 형태의 키) / `TTL <키>`
- 전원 강제 로그아웃: `redis-cli FLUSHDB` (Keycloak SSO 세션이 살아 있으면 비밀번호 없이 바로 다시 로그인됨에 유의)
- IntelliJ 에서 보려면 Redis 플러그인 또는 Database 창(Ultimate)에서 `localhost:6379` (로컬은 `ports: ["6379:6379"]` 추가)

### 내부망 주의점
- 디스크 저장을 꺼 두었기 때문에 **Redis 재시작 = 전원 로그아웃** 입니다. 세션이 8시간짜리라 문제없다고 보고 단순하게 둔 것입니다. 유지하려면 `--appendonly yes` + 볼륨 추가.
- 사내 Redis 를 쓰면 `redis_connection_url` 을 바꾸고, 비밀번호가 있으면 `redis://:<비밀번호>@<호스트>:6379` 형식 또는 `redis_password` 옵션을 쓰세요.
- Redis 포트는 외부에 열지 마세요 (현재 compose 에 `ports` 없음 = 컨테이너 네트워크 안에서만 접근).

---

## 4. oauth2-proxy

### 이 시스템에서 하는 일
Kibana 앞에 서는 **로그인 확인 + 프록시** 프로그램입니다 (Go 로 만든 오픈소스, 단일 바이너리 컨테이너). 이 저장소에서는 코드를 짜지 않고 **설정 파일만** 관리합니다.
- 요청마다 로그인 쿠키(`_kibana_auth`) 확인
- 로그인 안 됐으면 **원래 URL 을 기억한 채** Keycloak 로그인 화면으로 보냄 (PKCE 사용)
- 로그인 성공 → Keycloak 이 `/oauth2/callback` 으로 돌려보냄 → 토큰 교환 → 세션을 Redis 에 저장, 쿠키 발급 → **원래 URL 로 리다이렉트**
- 이후 요청은 Kibana 로 프록시하면서 `X-Forwarded-User`, `X-Forwarded-Email`, `X-Forwarded-Preferred-Username` 헤더 추가
- 5분마다(`cookie_refresh`) Keycloak 에 토큰을 갱신해, Keycloak 에서 계정을 막으면 5분 안에 반영

Spring 개발자 관점에서 보면 "Spring Security `oauth2Login()` + `SavedRequest` 리다이렉트 + Spring Session Redis + 리버스 프록시" 를 설정 파일 하나로 해 주는 기성 제품입니다.

### oauth2-proxy 가 쓰는 주소
| 경로 | 역할 |
|---|---|
| `/oauth2/start?rd=<주소>` | 로그인 시작 (보통 자동으로 거침) |
| `/oauth2/callback` | Keycloak 이 로그인 후 돌려보내는 곳 (realm 의 `redirectUris` 에 등록됨) |
| `/oauth2/sign_out?rd=<주소>` | 세션 삭제 후 `rd` 로 이동 (HAProxy 의 `/logout` 이 이걸 Keycloak 로그아웃과 묶어 줌) |
| `/ping` | 헬스체크 (로그인 불필요) |
| 그 외 전부 | 로그인 확인 후 Kibana(`KIBANA_UPSTREAM`) 로 전달 |

### 설정 위치
| 파일 | 내용 |
|---|---|
| `auth-stack/oauth2-proxy/oauth2-proxy.cfg` | Keycloak 연동(`provider = "keycloak-oidc"`, `client_id = "oauth2-proxy"`, PKCE), 내부 통신용 엔드포인트, 허용 도메인/그룹, 쿠키·세션(Redis), Kibana 로 넘길 헤더 |
| `auth-stack/docker-compose.yml` 의 `oauth2-proxy` 서비스 | 주소가 들어가는 값과 비밀값을 환경변수 `OAUTH2_PROXY_*` 로 주입 |
| `auth-stack/.env` | `OAUTH2_PROXY_CLIENT_SECRET`, `OAUTH2_PROXY_COOKIE_SECRET`, `OAUTH2_PROXY_COOKIE_SECURE`, `KIBANA_UPSTREAM` |

설정 파일 키(`cookie_secure`)와 환경변수(`OAUTH2_PROXY_COOKIE_SECURE`)는 1:1 대응합니다. 이름을 대문자로 바꾸고 `OAUTH2_PROXY_` 를 붙이면 됩니다. 둘 다 있으면 환경변수가 이깁니다. Spring 의 `application.yml` ↔ 환경변수 관계와 같습니다.

### 주요 설정값
| 키 | 현재 값 | 설명 |
|---|---|---|
| `skip_oidc_discovery` + `redeem_url`/`oidc_jwks_url`/`validate_url`/`profile_url` | `http://keycloak:8080/...` | 토큰 교환·서명키 조회는 **내부 주소**로. (issuer 는 공개 주소라 자동 discovery 를 끄고 직접 지정) |
| `OAUTH2_PROXY_OIDC_ISSUER_URL`, `OAUTH2_PROXY_LOGIN_URL` | `${PUBLIC_URL}/auth/realms/kibana...` | 브라우저가 가는 **공개 주소**. 토큰 issuer 와 문자 하나까지 같아야 함 |
| `OAUTH2_PROXY_REDIRECT_URL` | `${PUBLIC_URL}/oauth2/callback` | |
| `email_domains` | `["*"]` | TODO: 사내 메일 도메인만 허용하려면 `["example.co.kr"]` |
| `allowed_groups` | (없음) | TODO: `["/kibana-users"]` 로 그룹 제한 (Keycloak `groups` 클레임, 앞에 `/` 붙은 전체 경로) |
| `whitelist_domains` | `["localhost:*"]` | 로그인/로그아웃 후 이동 허용 도메인 (Open Redirect 방지). TODO: 실제 도메인 |
| `cookie_expire` / `cookie_refresh` | 8h / 5m | 세션 최대 시간 / 토큰 갱신 주기 |
| `session_store_type` / `redis_connection_url` | redis / `redis://redis:6379` | |
| `pass_user_headers` | true | Kibana 로 사용자 헤더 전달 |
| `skip_provider_button` | true | "Sign in with Keycloak" 버튼 화면 없이 바로 이동 |

### 사용법
- 설정 변경 후 반영: `docker compose restart oauth2-proxy` (빌드 없음)
- 로그 보기: `docker compose logs -f oauth2-proxy` (로그인 성공/실패, 401/403 사유가 한 줄씩 찍힘)
- 쿠키 비밀값 생성: `openssl rand -hex 16` (정확히 16/24/32 바이트여야 기동됨)
- 기능 추가가 필요하면 코드를 쓰기 전에 [공식 설정 문서](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview)에서 옵션을 먼저 찾아보세요. 그룹 제한, 경로별 인증 생략(`skip_auth_routes`), 헤더 추가 등 대부분이 옵션으로 있습니다.
- IntelliJ 에서는 `.cfg` 를 TOML 로 연결해 두면(Settings → Editor → File Types) 문법 강조가 됩니다.

### 내부망 주의점
- **두 개의 Keycloak 주소**: 브라우저용(공개 도메인)과 서버 간 통신용(`keycloak:8080`)이 나뉘어 있습니다. Keycloak 이 다른 서버에 있으면 `.cfg` 의 `http://keycloak:8080` 4줄을 그 서버 주소로 바꾸세요. issuer 가 안 맞으면 로그에 `oidc: id token issued by a different provider` 가 찍힙니다.
- `OAUTH2_PROXY_COOKIE_SECURE=true` 인데 http 로 접속하면 쿠키가 안 붙어 **무한 로그인 루프**. HTTPS 운영이면 true, http 테스트면 false.
- `whitelist_domains` 를 실제 도메인으로 안 바꾸면 로그아웃 후 이동(`rd=`)이 무시되고 `/` 로 갑니다.
- `KIBANA_UPSTREAM` 은 끝에 `/` 를 붙인 형식(`http://10.0.0.5:5601/`)입니다. 경로를 붙이지 말고 요청 경로 `/kibana/...` 를 그대로 넘깁니다.
- 이미지가 **quay.io** (`quay.io/oauth2-proxy/oauth2-proxy:v7.7.1`) 에 있습니다. 반입 목록에 포함하세요.
- Kibana 쪽 Elasticsearch 보안이 켜져 있으면 이중 로그인이 됩니다. 이때 `pass_basic_auth` 등으로 Kibana 계정을 주입할 수 있지만 보안 검토가 필요하니 [auth-stack/README.md](../auth-stack/README.md) "Kibana 이중 로그인" 을 먼저 보세요.

---

## 5. HAProxy (사내 기존 인프라 — 설정 조각만 전달)

### 이 시스템에서 하는 일
외부에서 들어오는 유일한 입구입니다. TLS(https) 를 끝내고 경로별로 나눕니다.
- `/auth/**` → Keycloak `:8080`
- 그 외 전부 → oauth2-proxy `:4180`
- **Kibana 5601 로 직접 가는 경로는 없어야 합니다** (있으면 로그인 우회)

### 설정 위치
| 파일 | 용도 |
|---|---|
| `auth-stack/haproxy/existing-haproxy-snippet.cfg` | **인프라 담당자에게 전달할 조각** (운영) |
| `auth-stack/haproxy/haproxy.cfg` | 로컬 테스트용 전체 설정 (`--profile local` 일 때만 뜸) |

### 전달할 핵심 설정 (요약)
```haproxy
frontend fe_https
    # ... 기존 bind / 인증서 설정 ...
    option forwardfor
    http-request set-header X-Forwarded-Proto https

    acl host_kibana hdr(host) -i kibana.example.co.kr     # TODO 실제 도메인
    acl path_auth   path_beg /auth/

    # (선택) 첫 화면 → Kibana 홈, /logout → oauth2-proxy 세션 삭제 + Keycloak 로그아웃
    http-request redirect location /kibana/app/home code 302 if host_kibana { path / }
    http-request redirect location "/oauth2/sign_out?rd=..." code 302 if host_kibana { path /logout }   # 전체 주소는 snippet 파일 참고

    http-request deny if host_kibana { path_beg /auth/admin } !{ src 10.0.0.0/8 }   # 관리 콘솔 제한(선택)

    use_backend be_keycloak     if host_kibana path_auth
    use_backend be_oauth2_proxy if host_kibana

backend be_keycloak
    server keycloak 10.0.0.20:8080 check                  # TODO

backend be_oauth2_proxy
    server oauth2-proxy 10.0.0.20:4180 check              # TODO, 여러 대면 줄 추가
```
정확한 최신 내용은 저장소의 `existing-haproxy-snippet.cfg` 를 기준으로 하세요.

### 내부망 주의점
- oauth2-proxy 를 여러 대 둬도 세션이 Redis 에 있으므로 sticky session 이 필요 없습니다.
- `X-Forwarded-Proto https` 를 빠뜨리면 Keycloak 이 http 로 리다이렉트 주소를 만들어 로그인 후 http 로 튕기거나 쿠키가 안 붙습니다.
- 도메인이 `.env` 의 `PUBLIC_URL` 과 **정확히 같아야** 합니다 (포트 포함). 다르면 Keycloak 이 `Invalid redirect_uri` 를 띄웁니다.
- `timeout server` 가 짧으면 Kibana 의 긴 조회가 끊깁니다. 기존 Kibana 백엔드에 쓰던 값을 oauth2-proxy 백엔드에도 주세요.
- 기존에 Kibana 로 바로 보내던 backend/라우트를 **제거**하고, Kibana 서버 방화벽에서 5601 을 oauth2-proxy 서버에서만 허용하세요.

---

## 6. Docker Compose

### 이 시스템에서 하는 일
Keycloak, PostgreSQL, Redis, oauth2-proxy (+ 로컬 테스트용 HAProxy, Mock Kibana) 를 `docker-compose.yml` 하나로 정의해 한 명령으로 띄웁니다.

### 자주 쓰는 명령 (`auth-stack/` 에서)
| 명령 | 설명 |
|---|---|
| `cp .env.example .env` | 최초 1회. 환경별 값은 `.env` 에만 쓰고 커밋하지 않음 |
| `docker compose --profile local up -d` | 로컬 테스트 (HAProxy + Mock Kibana 포함) |
| `docker compose up -d` | 운영 (사내 HAProxy, 실제 Kibana 사용) |
| `docker compose ps` | 상태 확인 |
| `docker compose logs -f keycloak` | 특정 서비스 로그 |
| `docker compose restart oauth2-proxy` | `oauth2-proxy.cfg` 수정 후 반영 |
| `docker compose up -d` | `.env` / `docker-compose.yml` 수정 후 반영 (바뀐 컨테이너만 재생성) |
| `docker compose down` | 종료 (데이터 유지) |
| `docker compose down -v` | 종료 + **DB 볼륨 삭제** (로컬 초기화용, 운영 금지) |

### 개념
- **profile**: `profiles: ["local"]` 이 붙은 서비스는 `--profile local` 을 줄 때만 뜹니다.
- **`.env`**: `docker-compose.yml` 안의 `${변수}` 가 이 파일 값으로 치환됩니다. 운영 비밀값은 이 파일에만.
- **서비스 이름 = 호스트 이름**: 컨테이너끼리는 `keycloak:8080`, `redis:6379` 처럼 서비스 이름으로 접근합니다. 브라우저는 이 이름을 모르므로 브라우저용 주소는 `PUBLIC_URL` 을 씁니다.

### IntelliJ 에서
- `docker-compose.yml` 을 열면 서비스 옆 ▶ 로 개별 기동 가능 (Docker 플러그인, 기본 포함)
- Services 창(Alt+8)에서 컨테이너 로그/재시작/터미널 접속

### 내부망 주의점
- 내부망에 레지스트리가 없으면 인터넷 되는 PC 에서 `docker pull` → `docker save -o images.tar ...` → 반입 → `docker load -i images.tar` (이미지 목록은 `auth-stack/README.md`)
- 직접 빌드하는 이미지가 없어서 Maven/npm 저장소는 필요 없습니다. 반입할 이미지는 Keycloak, oauth2-proxy, PostgreSQL, Redis 4개입니다.
- `restart` 는 `.env` 변경을 다시 읽지 않습니다. 환경변수를 바꿨으면 `docker compose up -d` 로 컨테이너를 다시 만드세요.
- 구버전 `docker-compose`(하이픈, v1) 는 `profiles`, `depends_on.condition` 을 지원하지 않을 수 있습니다. `docker compose`(v2) 를 쓰세요.
- 서버 시간대/NTP 확인 (OTP, 토큰 만료 계산에 영향).

---

## 7. Kibana basePath

### 왜 필요한가
oauth2-proxy 뒤에서 Kibana 를 `/kibana/...` 경로로 서비스합니다. Kibana 가 이 사실을 모르면 화면 안의 JS/CSS/API 주소를 `/` 기준으로 만들어서 화면이 깨집니다.

### 설정 (Kibana 서버의 `kibana.yml`, ELK 담당자 작업)
```yaml
server.basePath: "/kibana"
server.rewriteBasePath: true     # Kibana 가 /kibana 접두어가 붙은 요청을 그대로 받음
server.publicBaseUrl: "https://kibana.example.co.kr/kibana"   # (권장) 공유 링크·알림 메일 주소
```
설정 후 Kibana 재시작. 확인: `curl http://<kibana>:5601/kibana/api/status` 가 200 이면 정상.

oauth2-proxy 의 `KIBANA_UPSTREAM` 은 경로 없이 `http://<kibana>:5601/` 로 두고, 요청 경로 `/kibana/...` 를 그대로 넘깁니다.

### 주의점
- `rewriteBasePath: false` 로 두면 프록시가 `/kibana` 를 떼서 넘겨야 합니다. 이 저장소는 `true` 전제입니다.
- Kibana 를 basePath 없이 직접 쓰던 북마크(`http://<kibana>:5601/app/...`)는 더 이상 동작하지 않으니 공지가 필요합니다.
- Elasticsearch 보안(`xpack.security`)이 켜져 있으면 Keycloak 로그인 후 Kibana 로그인이 한 번 더 뜹니다 → [auth-stack/README.md](../auth-stack/README.md) "Kibana 이중 로그인", [architecture-review.md](architecture-review.md) 5-1 참고.

---

## 8. 증상별 빠른 진단표

| 증상 | 먼저 볼 곳 |
|---|---|
| Keycloak 화면에 `Invalid parameter: redirect_uri` | `PUBLIC_URL` 과 실제 접속 주소(스킴·포트) 일치 여부, realm 의 `redirectUris` |
| 로그인 후 무한 리다이렉트 | HAProxy `X-Forwarded-Proto`, `OAUTH2_PROXY_COOKIE_SECURE` 와 http/https 불일치 |
| 로그인 화면 CSS 깨짐 | `KC_HOSTNAME`, HAProxy 의 `/auth/` 라우팅 |
| oauth2-proxy 로그에 `issued by a different provider` | `OAUTH2_PROXY_OIDC_ISSUER_URL` 과 Keycloak `KC_HOSTNAME` 일치 여부 |
| oauth2-proxy 가 기동 직후 종료 | `OAUTH2_PROXY_COOKIE_SECRET` 길이(16/24/32 바이트), 로그 확인 |
| 로그아웃 후 엉뚱한 곳으로 이동 | `whitelist_domains` |
| 로그인 후 403 | `email_domains` / `allowed_groups` 에 사용자가 해당하는지 |
| 로그인은 되는데 Kibana 화면이 깨짐 | Kibana `server.basePath`, `rewriteBasePath` |
| OTP 코드가 계속 틀림 | 서버/휴대폰 시간 동기화 (NTP) |
| 재시작 후 전원 로그아웃 | 정상 (Redis 디스크 저장 끔). 3장 참고 |
| `docker compose` 이미지 pull 실패 | quay.io/Docker Hub 접근, 사내 미러, `docker save/load` |
