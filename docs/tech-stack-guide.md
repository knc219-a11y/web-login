# 기술스택 가이드 (기능 · 설정 파일 · 사용법 · 주의점)

이 문서는 `auth-stack/` 에서 쓰는 기술을 **처음 써 보는 Spring/Java 개발자** 기준으로 정리한 것입니다.
각 기술마다 "이 시스템에서 하는 일 → 저장소의 설정 파일 → 실행/수정 방법 → 내부망에서 자주 막히는 점" 순서로 적었습니다.

> 구조를 왜 이렇게 정했는지는 [architecture-review.md](architecture-review.md), 실행 절차는 [auth-stack/README.md](../auth-stack/README.md) 를 보세요.

## 0. 한 장 요약

```
브라우저 ─▶ HAProxy (사내 기존 장비, 설정만 추가)
             ├─ /auth/**  ─▶ Keycloak :8080 ──▶ PostgreSQL     (로그인 화면, 계정, OTP)
             └─ 그 외     ─▶ Spring 게이트웨이 :8081 ──▶ Kibana :5601
                               └─ 세션 저장: Redis
```

| 기술 | 한 줄 역할 | 누가 관리 | 코드 작성? |
|---|---|---|---|
| Keycloak | 로그인 화면, 계정·그룹, 비밀번호 정책, 잠금, OTP | 개발자 | ✕ (설정만) |
| PostgreSQL | Keycloak 의 데이터 저장소 | 개발자/DBA | ✕ |
| Redis | 게이트웨이 로그인 세션 저장 | 개발자 | ✕ |
| Spring Boot 게이트웨이 | 로그인 확인 → 원래 화면으로 리다이렉트 → Kibana 로 프록시 | **개발자** | **○ (유일한 Java 코드)** |
| HAProxy | 외부 진입점, 경로별 분기 | 인프라 | ✕ (설정 조각 전달) |
| Docker Compose | 위 컨테이너들을 한 번에 실행 | 개발자 | ✕ |
| Kibana | 보호 대상. `basePath=/kibana` 설정만 필요 | ELK 담당 | ✕ |

로그인 한 번의 흐름:

1. 사용자가 `https://<도메인>/kibana/app/discover` 접속 → HAProxy → 게이트웨이
2. 게이트웨이(Spring Security)가 세션이 없음을 확인 → **원래 URL 을 세션에 저장**하고 Keycloak 로그인 화면으로 302
3. 사용자가 Keycloak 에서 아이디/비밀번호(+OTP) 입력 → Keycloak 이 `code` 를 들고 게이트웨이 콜백 URL 로 302
4. 게이트웨이가 Keycloak 에 `code` → 토큰 교환 (서버 간 통신), 로그인 세션을 Redis 에 저장, 쿠키 발급
5. 2번에서 저장해 둔 **원래 URL 로 302** → 이후 요청은 게이트웨이가 Kibana 로 프록시

---

## 1. Keycloak

### 이 시스템에서 하는 일
- 로그인 화면(한국어), 아이디/비밀번호 확인, 로그인 실패 잠금, 비밀번호 정책
- 사용자·그룹(`kibana-users`, `kibana-admins`) 관리, 관리 콘솔 제공
- OIDC(OpenID Connect) 표준으로 게이트웨이에 "이 사람 로그인 됐음" 을 토큰으로 알려 줌
- 필요하면 2단계 인증(OTP), LDAP/AD 연동, 비밀번호 찾기 메일 등을 **코드 없이** 켤 수 있음

Spring 개발자 관점에서 보면 "Spring Security 의 로그인 폼 + UserDetailsService + 사용자 관리 화면" 을 통째로 별도 서버로 뺀 것입니다.

### 핵심 용어
| 용어 | 뜻 | 이 저장소 값 |
|---|---|---|
| Realm | 사용자/설정 묶음 (테넌트) | `kibana` |
| Client | Keycloak 에 로그인을 맡기는 애플리케이션 | `kibana-gateway` |
| Client secret | 게이트웨이가 Keycloak 에 토큰 받을 때 쓰는 비밀번호 | `.env` 의 값 |
| Redirect URI | 로그인 후 돌려보내도 되는 주소 목록 | `${PUBLIC_URL}/login/oauth2/code/keycloak` |
| Issuer | 토큰 발급자 주소. 게이트웨이가 이 값으로 토큰을 검증 | `${PUBLIC_URL}/auth/realms/kibana` |

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
- 세션 강제 종료: Sessions 메뉴에서 사용자 세션 Sign out (게이트웨이 쪽은 다음 토큰 갱신 때 반영)

**중요: `realm-kibana.json` 은 최초 import 때만 적용됩니다.** `--import-realm` 은 realm 이 이미 DB 에 있으면 건너뜁니다.
- 운영 중 변경 → 관리 콘솔에서 수정
- 저장소에도 남기려면 → Realm settings → 오른쪽 위 Action → Partial export → JSON 을 `realm-kibana.json` 에 반영 (export 결과에는 secret 이 `**********` 로 가려지니 `${...}` 자리로 되돌려 놓기)
- 로컬에서 JSON 을 고치고 다시 적용하려면 `docker compose down -v` (DB 삭제) 후 재기동

### 2단계 인증(Google OTP) 켜는 법 — 나중에 필요할 때
Keycloak 에 TOTP 가 내장되어 있고 Google Authenticator / Microsoft Authenticator 앱과 그대로 호환됩니다. 게이트웨이 코드는 바꿀 필요가 없습니다.

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
Keycloak 전용 DB 입니다. 사용자, 비밀번호 해시, 그룹, OTP 시크릿, realm 설정이 들어갑니다. **게이트웨이는 DB 를 직접 쓰지 않습니다.**

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
게이트웨이의 **로그인 세션 저장소**입니다 (Spring Session Data Redis). `HttpSession` 이 서버 메모리 대신 Redis 에 저장되므로
- 게이트웨이를 재시작해도 사용자가 다시 로그인하지 않아도 되고
- 게이트웨이를 2대 이상 띄워도 HAProxy 가 아무 쪽으로 보내도 됩니다 (sticky session 불필요)

### 설정 위치
- `auth-stack/docker-compose.yml` 의 `redis` 서비스 (`redis:7-alpine`, 디스크 저장 끔: `--save "" --appendonly no`)
- 게이트웨이 `application.yml` 의 `spring.data.redis.*`, `spring.session.*`

### 사용법
- 세션 확인: `docker compose exec redis redis-cli` → `KEYS kibana-gateway:session:*` / `TTL <키>` (`spring.session.redis.namespace` 값)
- 전원 강제 로그아웃: `redis-cli FLUSHDB` (Keycloak SSO 세션이 살아 있으면 비밀번호 없이 바로 다시 로그인됨에 유의)
- IntelliJ 에서 보려면 Redis 플러그인 또는 Database 창(Ultimate)에서 `localhost:6379` (로컬은 `ports: ["6379:6379"]` 추가)

### 내부망 주의점
- 디스크 저장을 꺼 두었기 때문에 **Redis 재시작 = 전원 로그아웃** 입니다. 세션이 8시간짜리라 문제없다고 보고 단순하게 둔 것입니다. 유지하려면 `--appendonly yes` + 볼륨 추가.
- 사내 Redis 를 쓰면 `REDIS_HOST`/`REDIS_PORT` 를 바꾸고, 비밀번호가 있으면 `application.yml` 에 `spring.data.redis.password: ${REDIS_PASSWORD:}` 를 추가하세요. 키는 `kibana-gateway:session` 접두어라 다른 서비스와 겹치지 않습니다.
- Redis 포트는 외부에 열지 마세요 (현재 compose 에 `ports` 없음 = 컨테이너 네트워크 안에서만 접근).

---

## 4. Spring Boot 게이트웨이

### 이 시스템에서 하는 일
저장소에서 **유일하게 직접 작성한 Java 코드**입니다 (`auth-stack/gateway/`, Spring Boot 3.4 / Java 17 / Maven).
- 모든 요청에 대해 로그인 여부 확인 (Spring Security)
- 로그인 안 됐으면 원래 URL 을 세션에 저장하고 Keycloak 로그인으로 보냄 (Spring Security OAuth2 Client, PKCE)
- 로그인 성공 → 저장해 둔 **원래 Kibana 화면으로 리다이렉트**
- `/kibana/**` 를 Kibana 로 프록시하면서 `X-Forwarded-User / -Email / -Groups` 헤더 추가 (Spring Cloud Gateway **Server MVC**)
- 세션을 Redis 에 저장 (Spring Session Data Redis)
- `GET /logout` → 게이트웨이 세션 삭제 + Keycloak 로그아웃

| 의존성 (`pom.xml`) | 역할 | Spring 개발자 관점 |
|---|---|---|
| `spring-cloud-starter-gateway-mvc` | Kibana 로 요청 전달 | WebFlux 가 아니라 **서블릿(MVC) 방식**. 평소 쓰던 Spring MVC 와 같은 스레드 모델이라 디버깅이 익숙함 |
| `spring-boot-starter-oauth2-client` | Keycloak 로그인 | `formLogin()` 대신 `oauth2Login()` |
| `spring-session-data-redis` + `spring-boot-starter-data-redis` | 세션 Redis 저장 | 코드 변경 없이 `HttpSession` 이 Redis 로 감 |
| `spring-boot-starter-actuator` | `/actuator/health` | HAProxy 헬스체크용 (로그인 없이 허용) |

### 파일 구성
| 파일 | 내용 |
|---|---|
| `src/main/resources/application.yml` | 포트(8081), 세션 쿠키(`KIBANA_GW_SESSION`, 8시간), Redis, Kibana 주소, Keycloak 주소/클라이언트. 모두 `${환경변수:기본값}` |
| `config/AppProperties.java` | `app.*` 설정을 담는 record (`@ConfigurationProperties`) |
| `config/SecurityConfig.java` | 로그인 필요 규칙, PKCE, 원래 주소로 리다이렉트(`SavedRequestAwareAuthenticationSuccessHandler`), `/logout`, CSRF 끔 |
| `config/KeycloakClientConfig.java` | Keycloak 클라이언트 등록. 브라우저용 주소와 서버 간 통신 주소를 나눠서 지정 |
| `config/KibanaRouteConfig.java` | `/kibana/**` → Kibana 라우트, 사용자 헤더 추가 |
| `src/test/...` | Redis/Keycloak 없이 도는 단위 테스트 |
| `Dockerfile` | 미리 빌드한 `target/kibana-gateway.jar` 를 복사만 함 (이미지 안에서 Maven 빌드 안 함) |

### 주요 설정값 (`application.yml` ↔ 환경변수)
| 설정 | 환경변수 | 기본값(IntelliJ 실행용) | 설명 |
|---|---|---|---|
| `server.port` | `GATEWAY_PORT` | 8081 | |
| `server.servlet.session.cookie.secure` | `COOKIE_SECURE` | false | HTTPS 운영은 true |
| `spring.data.redis.host` / `port` | `REDIS_HOST` / `REDIS_PORT` | localhost / 6379 | |
| `app.kibana-url` | `KIBANA_URL` | http://localhost:5601 | 경로 없이 호스트:포트만 |
| `app.default-redirect` | `DEFAULT_REDIRECT` | /kibana/app/home | 원래 주소가 없을 때 로그인 후 화면 |
| `app.keycloak.realm-url` | `KEYCLOAK_REALM_URL` | http://localhost:8000/auth/realms/kibana | **브라우저가 보는** realm 주소 = 토큰 issuer |
| `app.keycloak.internal-realm-url` | `KEYCLOAK_INTERNAL_REALM_URL` | realm-url 과 동일 | 게이트웨이 서버가 토큰 받으러 가는 주소 |
| `app.keycloak.client-id` | `GATEWAY_CLIENT_ID` | kibana-gateway | |
| `app.keycloak.client-secret` | `GATEWAY_CLIENT_SECRET` | change-me-client-secret | Keycloak 클라이언트 비밀값과 같아야 함 |

Keycloak 쪽 콜백 주소는 Spring 기본값인 `${PUBLIC_URL}/login/oauth2/code/keycloak` 입니다 (`realm-kibana.json` 의 `redirectUris` 에 등록됨).

### IntelliJ 에서 실행·디버깅
1. File → Open → `auth-stack/gateway/pom.xml` → Open as Project (JDK 17 지정)
2. Keycloak/Redis 는 Docker 로 띄워 둠: `auth-stack/` 에서 `docker compose --profile local up -d` 후 `docker compose stop gateway` (HAProxy 는 계속 게이트웨이를 `gateway:8081` 로 찾으므로, 로컬 IDE 실행 시에는 브라우저로 `http://localhost:8081/kibana/app/home` 에 직접 접속)
3. Redis 를 IDE 에서 쓰려면 compose 의 `redis` 에 `ports: ["6379:6379"]` 를 추가
4. Run Configuration 의 Environment variables 예:
   `KEYCLOAK_REALM_URL=http://localhost:8000/auth/realms/kibana;KIBANA_URL=http://localhost:5601;GATEWAY_CLIENT_SECRET=<.env 값>`
   - IDE 로 직접 접속하면 콜백이 `http://localhost:8081/login/oauth2/code/keycloak` 가 되므로 Keycloak 관리 콘솔 → Clients → `kibana-gateway` → Valid redirect URIs 에 이 주소를 **로컬에서만** 추가
5. `GatewayApplication` 실행(디버그). 중단점은 `KibanaRouteConfig.addUserHeaders`, `SecurityConfig` 의 핸들러에 걸면 흐름을 따라가기 좋습니다.
6. 로그 자세히: `logging.level.org.springframework.security=DEBUG` (리다이렉트가 이상할 때 가장 먼저 켤 것)

빌드/테스트: Maven 창 → Lifecycle → `test`, `package` (터미널: `mvn test`, `mvn -DskipTests package`).
컨테이너에 반영: `mvn -DskipTests package` → `docker compose up -d --build gateway`.

### 자주 하게 될 수정
- **그룹별 접근 제한**: `SecurityConfig` 의 `.anyRequest().authenticated()` 부분 (TODO 표시). Keycloak 의 `groups` 클레임(예: `/kibana-users`)은 `OidcUser.getClaimAsStringList("groups")` 로 읽을 수 있습니다. 권한으로 쓰려면 `GrantedAuthoritiesMapper` 빈을 만들어 그룹을 `ROLE_...` 으로 매핑한 뒤 `hasRole(...)` 사용.
- **Kibana 로 넘기는 헤더 추가/변경**: `KibanaRouteConfig.addUserHeaders`. 이중 로그인 대응으로 `Authorization` 을 붙이는 것도 여기 (TODO 표시).
- **로그인 후 기본 화면**: `DEFAULT_REDIRECT` 환경변수.
- **세션 시간**: `server.servlet.session.timeout` (Keycloak 의 `ssoSessionIdleTimeout` 8시간과 맞춰 둠).

### 내부망 주의점
- **두 개의 Keycloak 주소**: `realm-url` 은 브라우저 주소(토큰 issuer 와 문자 하나까지 같아야 함), `internal-realm-url` 은 게이트웨이 서버에서 접속 가능한 주소. 게이트웨이 서버가 공개 도메인으로 나가지 못하는 내부망이 흔해서 나눠 두었습니다. issuer 가 다르면 로그인 직후 `invalid_id_token` 오류.
- `server.forward-headers-strategy: framework` 라서 HAProxy 의 `X-Forwarded-Proto/Host` 로 콜백 주소를 만듭니다. 이 헤더가 없으면 `redirect_uri` 가 `http://내부IP:8081/...` 로 만들어져 Keycloak 이 거부합니다.
- HTTPS 운영인데 `COOKIE_SECURE=false` 면 동작은 하지만 보안상 true 로, 반대로 http 테스트인데 true 면 쿠키가 안 붙어 **무한 로그인 루프**가 납니다.
- CSRF 는 의도적으로 껐습니다 (Kibana 가 `kbn-xsrf` 헤더로 자체 보호, 켜면 Kibana POST API 가 403).
- 내부망 Maven: Dockerfile 이 jar 만 복사하므로, 인터넷 PC 에서 `mvn -DskipTests package` 한 jar 를 옮기면 됩니다. 내부망에서 소스를 다시 빌드하려면 사내 Nexus 또는 `mvn dependency:go-offline` 후 `~/.m2` 반입.
- URL 의 `#` 뒷부분은 브라우저가 서버로 보내지 않으므로 로그인 전 주소의 `#/...` 는 복원되지 않습니다 (Kibana 는 대부분 `?_g=...` 쿼리를 쓰므로 실사용 영향은 작음).

---

## 5. HAProxy (사내 기존 인프라 — 설정 조각만 전달)

### 이 시스템에서 하는 일
외부에서 들어오는 유일한 입구입니다. TLS(https) 를 끝내고 경로별로 나눕니다.
- `/auth/**` → Keycloak `:8080`
- 그 외 전부 → Spring 게이트웨이
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
    http-request set-header X-Forwarded-Host %[req.hdr(host)]

    acl host_kibana hdr(host) -i kibana.example.co.kr     # TODO 실제 도메인
    acl path_auth   path_beg /auth/
    http-request deny if host_kibana { path_beg /auth/admin } !{ src 10.0.0.0/8 }   # 관리 콘솔 제한(선택)

    use_backend be_keycloak if host_kibana path_auth
    use_backend be_kibana_gw if host_kibana

backend be_keycloak
    server keycloak 10.0.0.20:8080 check                  # TODO

backend be_kibana_gw
    option httpchk GET /actuator/health
    server gateway 10.0.0.20:8081 check                   # TODO, 여러 대면 줄 추가
```
정확한 최신 내용은 저장소의 `existing-haproxy-snippet.cfg` 를 기준으로 하세요.

### 내부망 주의점
- 게이트웨이를 여러 대 둬도 세션이 Redis 에 있으므로 sticky session 이 필요 없습니다.
- `X-Forwarded-Proto https` / `X-Forwarded-Host` 를 빠뜨리면 Keycloak·게이트웨이가 http 로 리다이렉트 주소를 만들어 로그인 후 http 로 튕기거나 쿠키가 안 붙습니다.
- 도메인이 `.env` 의 `PUBLIC_URL` 과 **정확히 같아야** 합니다 (포트 포함). 다르면 Keycloak 이 `Invalid redirect_uri` 를 띄웁니다.
- `timeout server` 가 짧으면 Kibana 의 긴 조회가 끊깁니다. 기존 Kibana 백엔드에 쓰던 값을 게이트웨이 백엔드에도 주세요.
- 기존에 Kibana 로 바로 보내던 backend/라우트를 **제거**하고, Kibana 서버 방화벽에서 5601 을 게이트웨이 서버에서만 허용하세요.

---

## 6. Docker Compose

### 이 시스템에서 하는 일
Keycloak, PostgreSQL, Redis, 게이트웨이 (+ 로컬 테스트용 HAProxy, Mock Kibana) 를 `docker-compose.yml` 하나로 정의해 한 명령으로 띄웁니다.

### 자주 쓰는 명령 (`auth-stack/` 에서)
| 명령 | 설명 |
|---|---|
| `cp .env.example .env` | 최초 1회. 환경별 값은 `.env` 에만 쓰고 커밋하지 않음 |
| `docker compose --profile local up -d --build` | 로컬 테스트 (HAProxy + Mock Kibana 포함). 먼저 게이트웨이 jar 빌드 |
| `docker compose up -d --build` | 운영 (사내 HAProxy, 실제 Kibana 사용) |
| `docker compose ps` | 상태 확인 |
| `docker compose logs -f keycloak` | 특정 서비스 로그 |
| `(cd gateway && mvn -DskipTests package)` → `docker compose up -d --build gateway` | 게이트웨이 코드 수정 후 반영 (Dockerfile 은 jar 복사만 함) |
| `docker compose restart keycloak` | 설정 변경 후 재시작 |
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
- 게이트웨이 이미지는 미리 만든 jar 만 복사하므로 이미지 빌드 때 인터넷이 필요 없습니다. 단 베이스 이미지 `eclipse-temurin:17-jre` 도 반입 목록에 넣으세요.
- 구버전 `docker-compose`(하이픈, v1) 는 `profiles`, `depends_on.condition` 을 지원하지 않을 수 있습니다. `docker compose`(v2) 를 쓰세요.
- 서버 시간대/NTP 확인 (OTP, 토큰 만료 계산에 영향).

---

## 7. Kibana basePath

### 왜 필요한가
게이트웨이 뒤에서 Kibana 를 `/kibana/...` 경로로 서비스합니다. Kibana 가 이 사실을 모르면 화면 안의 JS/CSS/API 주소를 `/` 기준으로 만들어서 화면이 깨집니다.

### 설정 (Kibana 서버의 `kibana.yml`, ELK 담당자 작업)
```yaml
server.basePath: "/kibana"
server.rewriteBasePath: true     # Kibana 가 /kibana 접두어가 붙은 요청을 그대로 받음
server.publicBaseUrl: "https://kibana.example.co.kr/kibana"   # (권장) 공유 링크·알림 메일 주소
```
설정 후 Kibana 재시작. 확인: `curl http://<kibana>:5601/kibana/api/status` 가 200 이면 정상.

게이트웨이 쪽 업스트림 주소는 경로 없이 `http://<kibana>:5601` (또는 `.env` 에 적힌 형식 그대로) 로 두고, 요청 경로 `/kibana/...` 를 그대로 넘깁니다.

### 주의점
- `rewriteBasePath: false` 로 두면 프록시가 `/kibana` 를 떼서 넘겨야 합니다. 이 저장소는 `true` 전제입니다.
- Kibana 를 basePath 없이 직접 쓰던 북마크(`http://<kibana>:5601/app/...`)는 더 이상 동작하지 않으니 공지가 필요합니다.
- Elasticsearch 보안(`xpack.security`)이 켜져 있으면 Keycloak 로그인 후 Kibana 로그인이 한 번 더 뜹니다 → [auth-stack/README.md](../auth-stack/README.md) "Kibana 이중 로그인", [architecture-review.md](architecture-review.md) 5-1 참고.

---

## 8. 증상별 빠른 진단표

| 증상 | 먼저 볼 곳 |
|---|---|
| Keycloak 화면에 `Invalid parameter: redirect_uri` | `PUBLIC_URL` 과 실제 접속 주소(스킴·포트) 일치 여부, realm 의 `redirectUris` |
| 로그인 후 무한 리다이렉트 | HAProxy `X-Forwarded-Proto`, 쿠키 `Secure` 설정과 http/https 불일치, 게이트웨이 issuer 설정 |
| 로그인 화면 CSS 깨짐 | `KC_HOSTNAME`, HAProxy 의 `/auth/` 라우팅 |
| 게이트웨이 로그에 `issuer` 불일치 | 토큰 issuer(공개 주소)와 게이트웨이 `issuer-uri` 설정 |
| 로그인은 되는데 Kibana 화면이 깨짐 | Kibana `server.basePath`, `rewriteBasePath` |
| OTP 코드가 계속 틀림 | 서버/휴대폰 시간 동기화 (NTP) |
| 재시작 후 전원 로그아웃 | 정상 (Redis 디스크 저장 끔). 3장 참고 |
| `docker compose` 이미지 pull 실패 | quay.io/Docker Hub 접근, 사내 미러, `docker save/load` |
