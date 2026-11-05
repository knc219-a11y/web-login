# auth-stack: Keycloak + Spring 게이트웨이로 Kibana 앞단 로그인

로그인 화면과 계정 관리는 **Keycloak**, "로그인 확인 → Kibana 로 전달 → 로그인 후 원래 화면으로 복귀"는
**Spring Boot 게이트웨이(`gateway/`)** 가 맡습니다. 게이트웨이는 일반 Spring 프로젝트라 IntelliJ 로 열어 수정·디버깅할 수 있습니다.
(구조 검토: [docs/architecture-review.md](../docs/architecture-review.md) 의 B안)

```
브라우저 ─▶ HAProxy (사내 기존 HAProxy, 설정만 추가)
             ├─ /auth/**  ─▶ Keycloak :8080 ─▶ PostgreSQL
             └─ 그 외     ─▶ Spring 게이트웨이 :8081 ─(세션: Redis)─▶ Kibana
```

## 폴더 구성

| 경로 | 내용 |
|---|---|
| `gateway/` | **Spring Boot 게이트웨이 (직접 관리하는 소스)** |
| `keycloak/realm-kibana.json` | Keycloak realm 설정 (클라이언트, 그룹, 비밀번호 정책, 잠금, 테스트 계정). 최초 기동 시 자동 import |
| `docker-compose.yml` | Keycloak, PostgreSQL, Redis, 게이트웨이 실행 정의 |
| `.env.example` | 주소, 비밀번호, Kibana 주소 등 환경별 값 (모두 TODO 표시) |
| `haproxy/existing-haproxy-snippet.cfg` | **기존 HAProxy 에 추가할 설정 조각** (인프라 담당자 전달용) |
| `haproxy/haproxy.cfg`, `mock-kibana/` | 로컬 테스트용. 운영에서는 쓰지 않음 |

## gateway 소스 안내

Spring Boot 3.4 / Java 17 / Maven. IntelliJ 에서 `auth-stack/gateway/pom.xml` 을 열면 됩니다.

| 파일 | 하는 일 |
|---|---|
| `config/SecurityConfig.java` | 로그인 필요 규칙, Keycloak 로그인(PKCE), 로그인 후 원래 주소로 이동, `/logout` 처리 |
| `config/KeycloakClientConfig.java` | Keycloak 연결 정보 (브라우저용 주소 / 서버 간 통신용 주소 분리) |
| `config/KibanaRouteConfig.java` | `/kibana/**` → Kibana 프록시, 사용자 정보 헤더(`X-Forwarded-User/Email/Groups`) 추가 |
| `config/AppProperties.java` | `application.yml` 의 `app.*` 설정 |
| `resources/application.yml` | 포트, 세션(Redis), Kibana 주소, Keycloak 주소. `${환경변수:기본값}` 형식 |

사용한 라이브러리: Spring Cloud Gateway (MVC 방식), Spring Security OAuth2 Client, Spring Session Data Redis.
고칠 일이 생기면 보통 손대는 곳:
- 그룹별 접근 제한 → `SecurityConfig` 의 `authorizeHttpRequests` (TODO 표시)
- 접속 로그 저장, Kibana 계정 주입 → `KibanaRouteConfig.addUserHeaders` (TODO 표시)

테스트: `mvn test` (Redis/Keycloak 없이 실행됨)

## 로컬에서 실행해 보기

Docker, JDK 17+, Maven 이 필요합니다.

```bash
cd auth-stack
(cd gateway && mvn -DskipTests package)      # 게이트웨이 jar 빌드 (IntelliJ: Maven → package)
cp .env.example .env
docker compose --profile local up -d --build  # 로컬용 HAProxy + Mock Kibana 포함
```

Keycloak 첫 기동은 30초 정도 걸립니다. 그 다음

1. http://localhost:8000/kibana/app/discover 열기 → Keycloak 로그인 화면(한국어)으로 이동
2. `admin / admin123` (또는 `user / user1234`) 로그인
3. 원래 열려던 `/kibana/app/discover` (임시 Kibana)로 복귀, 상단에 로그인 사용자 표시
4. 상단 `로그아웃` → Keycloak 까지 로그아웃 → 다시 로그인 화면

Keycloak 관리 콘솔: http://localhost:8000/auth/admin (`.env` 의 `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`)
종료: `docker compose --profile local down` (DB까지 지우려면 `-v`)

## 내부망 이전 시 할 일 (TODO)

`grep -rn TODO auth-stack --exclude-dir=target` 으로 전부 볼 수 있습니다.

1. **`.env`**
   - `PUBLIC_URL` : 사용자가 접속할 실제 주소 (예: `https://kibana.example.co.kr`)
   - `KEYCLOAK_ADMIN_PASSWORD`, `KC_DB_PASSWORD`, `GATEWAY_CLIENT_SECRET` 변경
   - `COOKIE_SECURE=true` (HTTPS)
   - `KIBANA_URL` : 실제 Kibana 주소 (예: `http://10.0.0.5:5601`)
   - 기존 PostgreSQL 을 쓰면 `KC_DB_URL` 변경 + `docker-compose.yml` 의 `postgres` 서비스 제거
2. **Kibana** `kibana.yml` : `server.basePath: "/kibana"`, `server.rewriteBasePath: true`
3. **realm-kibana.json** : 테스트 계정(`admin`, `user`) 삭제. 실제 사용자는 관리 콘솔에서 등록하거나 LDAP/AD 연동
   - realm 파일은 **최초 import 때만** 적용됩니다. 이후 변경은 관리 콘솔에서 하고, 저장소에 남기려면 관리 콘솔 → Realm settings → Partial export
4. **빌드/기동** : `(cd gateway && mvn -DskipTests package)` 후 `docker compose up -d --build` (profile 없이 → HAProxy, Mock Kibana 는 안 뜸)
   - Docker 없이 `java -jar gateway/target/kibana-gateway.jar` 로 실행해도 됩니다 (환경변수로 설정 전달)
5. **기존 HAProxy** : `haproxy/existing-haproxy-snippet.cfg` 를 인프라 담당자에게 전달. 요점은
   - `/auth/**` → Keycloak `:8080`, 나머지 → 게이트웨이 `:8081`
   - `X-Forwarded-Proto`, `X-Forwarded-Host` 헤더 전달
   - **Kibana 5601 로 직접 가는 경로는 막기** (안 막으면 로그인 우회 가능)

### 내부망에 Maven / Docker 저장소가 없다면
- Maven: 인터넷 되는 PC에서 `mvn -DskipTests package` 로 만든 `gateway/target/kibana-gateway.jar` 를 그대로 옮기면 됩니다 (실행에 필요한 라이브러리가 jar 에 모두 포함).
  내부망에서 소스를 고쳐 다시 빌드하려면 사내 Nexus 등 Maven 저장소가 있거나, 인터넷 PC에서 `mvn dependency:go-offline` 후 `~/.m2` 폴더를 옮겨야 합니다.
- Docker 이미지: 인터넷 되는 PC에서 저장해 옮깁니다.
  ```bash
  docker pull quay.io/keycloak/keycloak:26.0.7 postgres:16-alpine redis:7-alpine eclipse-temurin:17-jre
  docker save -o auth-stack-images.tar quay.io/keycloak/keycloak:26.0.7 postgres:16-alpine redis:7-alpine eclipse-temurin:17-jre
  # 내부망에서
  docker load -i auth-stack-images.tar
  ```

## 2단계 인증 (Google OTP)

Keycloak 에 TOTP 가 기본 내장되어 있어 Google Authenticator 를 코드 없이 쓸 수 있습니다 (현재는 꺼져 있음).
관리 콘솔 → Authentication → Required actions 에서 `Configure OTP` 를 기본 동작으로 켜면 다음 로그인 때 QR 등록 화면이 나옵니다.
특정 그룹만 필수로 하려면 Authentication 흐름에 Conditional OTP 를 설정합니다. 게이트웨이 코드는 바꿀 필요가 없습니다.

## Kibana 이중 로그인

Elasticsearch 보안(`xpack.security.enabled`)이 켜져 있으면 Keycloak 로그인 뒤 Kibana 로그인이 한 번 더 뜹니다.
지금 Kibana 가 "로그인 없이 접근 가능"한 상태라면 해당 없습니다. 켜져 있다면 [검토 문서 5-1](../docs/architecture-review.md) 중에서 고르고,
- 가장 간단한 무료 방법: Kibana anonymous 인증 + 5601 포트를 게이트웨이에서만 접근 가능하게 차단
- 그룹별로 다른 Kibana 계정을 쓰려면: `KibanaRouteConfig.addUserHeaders` 에서 `Authorization` 헤더를 붙이면 됩니다

## 동작 원리 (짧게)

- 로그인 안 된 요청 → Spring Security 가 원래 주소를 세션에 저장하고 Keycloak 로그인 화면으로 보냄
- 로그인 성공 → Keycloak 이 `/login/oauth2/code/keycloak` 으로 돌려보냄 → 게이트웨이가 토큰 확인, 세션(Redis)에 로그인 저장 → **저장해 둔 원래 주소로 리다이렉트**
- 이후 `/kibana/**` 요청은 Kibana 로 그대로 전달하며 사용자 정보 헤더를 붙임 (브라우저가 보낸 같은 이름 헤더는 덮어써서 사칭 방지)
- 브라우저는 공개 주소로 Keycloak 에 접속하고, 게이트웨이는 토큰 교환을 내부 주소(`keycloak:8080`)로 합니다 (`KeycloakClientConfig`)
- 브라우저는 URL 의 `#` 뒷부분을 서버로 보내지 않으므로 로그인 전 주소의 `#...` 는 유지되지 않습니다

## 기존 Node 게이트웨이와의 관계

저장소 루트의 Node 게이트웨이(`src/`)는 같은 역할을 직접 구현한 첫 번째 시도입니다. 이 구성으로 운영하면 필요 없고,
내부망에서 동작 확인 후 정리하면 됩니다.
