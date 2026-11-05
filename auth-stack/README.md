# auth-stack: Keycloak + oauth2-proxy 로 Kibana 앞단 로그인 (A안)

[구조 검토 문서](../docs/architecture-review.md)의 **A안** 구현입니다. 로그인 코드를 직접 짜지 않고,
Keycloak(로그인/계정) + oauth2-proxy(로그인 확인 → 원래 화면으로 리다이렉트) 설정으로 처리합니다.

```
브라우저 ─▶ HAProxy (사내 기존 HAProxy, 설정만 추가)
             ├─ /auth/**  ─▶ Keycloak :8080 ─▶ PostgreSQL
             └─ 그 외     ─▶ oauth2-proxy :4180 ─(세션: Redis)─▶ Kibana
```

## 개발자가 관리하는 파일

| 파일 | 내용 |
|---|---|
| `keycloak/realm-kibana.json` | Keycloak realm 설정 (클라이언트, 그룹, 비밀번호 정책, 잠금, 테스트 계정). 최초 기동 시 자동 import |
| `oauth2-proxy/oauth2-proxy.cfg` | oauth2-proxy 설정 (Keycloak 연동, 세션/Redis, Kibana 로 넘길 헤더) |
| `docker-compose.yml` | Keycloak, PostgreSQL, oauth2-proxy, Redis 실행 정의 |
| `.env.example` | 주소, 비밀번호, Kibana 주소 등 환경별 값 (모두 TODO 표시) |
| `haproxy/existing-haproxy-snippet.cfg` | **기존 HAProxy 에 추가할 설정 조각** (인프라 담당자 전달용) |
| `haproxy/haproxy.cfg`, `mock-kibana/` | 로컬 테스트용. 운영에서는 쓰지 않음 |

## 로컬에서 실행해 보기

Docker 와 Docker Compose 가 필요합니다.

```bash
cd auth-stack
cp .env.example .env
docker compose --profile local up -d      # 로컬용 HAProxy + Mock Kibana 포함
```

Keycloak 첫 기동은 30초 정도 걸립니다. 그 다음

1. http://localhost:8000/kibana/app/discover 열기 → Keycloak 로그인 화면(한국어)으로 이동
2. `admin / admin123` (또는 `user / user1234`) 로그인
3. 원래 열려던 `/kibana/app/discover` (임시 Kibana)로 돌아오고, 상단에 로그인 사용자 이름 표시
4. 상단 `로그아웃` → 세션 삭제 후 다시 로그인 화면

Keycloak 관리 콘솔: http://localhost:8000/auth/admin (`.env` 의 `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`)
종료: `docker compose --profile local down` (DB까지 지우려면 `-v`)

## 내부망 이전 시 할 일 (TODO)

`grep -rn TODO auth-stack` 으로 전부 볼 수 있습니다.

1. **`.env`**
   - `PUBLIC_URL` : 사용자가 접속할 실제 주소 (예: `https://kibana.example.co.kr`)
   - `KEYCLOAK_ADMIN_PASSWORD`, `KC_DB_PASSWORD`, `OAUTH2_PROXY_CLIENT_SECRET`, `OAUTH2_PROXY_COOKIE_SECRET` 변경
   - `OAUTH2_PROXY_COOKIE_SECURE=true` (HTTPS)
   - `KIBANA_UPSTREAM` : 실제 Kibana 주소 (예: `http://10.0.0.5:5601/`)
   - 기존 PostgreSQL 을 쓰면 `KC_DB_URL` 변경 + `docker-compose.yml` 의 `postgres` 서비스 제거
2. **Kibana** `kibana.yml` : `server.basePath: "/kibana"`, `server.rewriteBasePath: true`
3. **oauth2-proxy.cfg** : `whitelist_domains` 를 실제 도메인으로, 필요하면 `allowed_groups = ["/kibana-users"]`
4. **realm-kibana.json** : 테스트 계정(`admin`, `user`) 삭제. 실제 사용자는 관리 콘솔에서 등록하거나 LDAP/AD 연동
   - realm 파일은 **최초 import 때만** 적용됩니다. 이후 변경은 관리 콘솔에서 하고, 저장소에 남기려면 관리 콘솔 → Realm settings → Partial export
5. **기동** : `docker compose up -d` (profile 없이 → HAProxy, Mock Kibana 는 안 뜸)
6. **기존 HAProxy** : `haproxy/existing-haproxy-snippet.cfg` 를 인프라 담당자에게 전달. 요점은
   - `/auth/**` → Keycloak `:8080`, 나머지 → oauth2-proxy `:4180`
   - **Kibana 5601 로 직접 가는 경로는 막기** (안 막으면 로그인 우회 가능)

### 내부망에 Docker 레지스트리가 없다면
인터넷 되는 PC에서 이미지를 파일로 저장해 옮깁니다.
```bash
docker pull quay.io/keycloak/keycloak:26.0.7 quay.io/oauth2-proxy/oauth2-proxy:v7.7.1 postgres:16-alpine redis:7-alpine
docker save -o auth-stack-images.tar quay.io/keycloak/keycloak:26.0.7 quay.io/oauth2-proxy/oauth2-proxy:v7.7.1 postgres:16-alpine redis:7-alpine
# 내부망에서
docker load -i auth-stack-images.tar
```

## Kibana 이중 로그인

Elasticsearch 보안(`xpack.security.enabled`)이 켜져 있으면 Keycloak 로그인 뒤 Kibana 로그인이 한 번 더 뜹니다.
지금 Kibana 가 "로그인 없이 접근 가능"한 상태라면 해당 없습니다. 켜져 있다면 [검토 문서 5-1](../docs/architecture-review.md#5-1-kibana-이중-로그인-문제) 중에서 고르고,
가장 간단한 무료 방법은 Kibana 의 anonymous 인증을 켜고 5601 포트를 HAProxy 에서만 접근 가능하게 막는 것입니다.

## 동작 원리 (짧게)

- 로그인 안 된 요청이 오면 oauth2-proxy 가 원래 URL 을 기억한 채 Keycloak 로그인 화면으로 보냅니다.
- 로그인 성공 → Keycloak 이 `/oauth2/callback` 으로 돌려보내고 → oauth2-proxy 가 세션을 Redis 에 저장, 쿠키 발급 → **원래 URL 로 리다이렉트**.
- 이후 요청은 oauth2-proxy 가 쿠키 확인 후 Kibana 로 전달하며 `X-Forwarded-User`, `X-Forwarded-Email`, `X-Forwarded-Preferred-Username` 헤더를 붙입니다.
- 브라우저는 공개 주소로 Keycloak 에 접속하고, oauth2-proxy 는 토큰 교환을 내부 주소(`keycloak:8080`)로 합니다. 그래서 `oauth2-proxy.cfg` 에 `skip_oidc_discovery` 와 엔드포인트가 직접 적혀 있습니다.
- 브라우저는 URL 의 `#` 뒷부분을 서버로 보내지 않으므로 로그인 전 주소의 `#...` 는 유지되지 않습니다.

## 기존 Node 게이트웨이와의 관계

저장소 루트의 Node 게이트웨이(`src/`)는 같은 역할을 직접 구현한 이전 방식입니다. A안으로 운영하면 필요 없고,
비교/참고용으로 남겨 두었습니다. 정리 여부는 A안이 내부망에서 동작 확인된 뒤 결정하면 됩니다.
