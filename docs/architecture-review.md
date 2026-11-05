# 로그인 구조 검토: Keycloak + oauth2-proxy + Redis + HAProxy vs 현재 방식 vs Spring

> 작성일: 2026-11-05 · 상태: **검토용 (아직 구현하지 않음)**
> 이 문서를 보고 방향을 정한 뒤 다음 작업을 진행합니다.

## 1. 결론 먼저

- 제안받은 **Keycloak + PostgreSQL + oauth2-proxy + Redis + HAProxy** 는 "Kibana 같은 웹 앱 앞에 로그인 붙이기"의 **표준적인 조합이고, 방향은 맞습니다.**
- 이 구성에서는 **로그인 코드를 직접 짤 필요가 거의 없습니다.** 로그인 화면·계정 관리·비밀번호 정책은 Keycloak 이, "로그인 안 됐으면 로그인으로 보내고 끝나면 원래 화면으로 돌려보내기"는 oauth2-proxy 가 해 줍니다. 즉 지금의 Node 게이트웨이(PR #1)는 이 구조로 가면 **대체**됩니다.
- Spring/Java 개발자 입장에서는 두 가지 길이 있습니다.
  - **권장 (A안)**: 제안 그대로 oauth2-proxy 사용. 코드 없이 설정만 관리. Java 가 필요한 곳은 Keycloak 확장(SPI)뿐인데, 기존 사용자 DB 연동 같은 경우에만 필요.
  - **B안**: oauth2-proxy 자리에 **Spring Cloud Gateway + Spring Security OAuth2 Client** 를 직접 둠. 사용자별 로직(감사 로그, 권한별 Kibana 계정 매핑, 헤더 주입 등)을 코드로 넣고 싶을 때.
- DB 는 **PostgreSQL** 권장 (Keycloak 이 가장 많이 쓰이고 검증된 DB. MySQL 도 공식 지원은 됨).
- **꼭 먼저 확인할 것**: Elasticsearch 보안(xpack security)이 켜져 있으면 **Keycloak 로그인 후 Kibana 로그인이 한 번 더 뜹니다.** 해결 방법은 5장 참고.

## 2. 구성 요소별 역할

```
사용자 브라우저
   │ https
   ▼
HAProxy  ── TLS 종료, 라우팅, (여러 대면) 부하분산
   │
   ▼
oauth2-proxy ──(로그인 안 됨)──▶ Keycloak 로그인 화면 ──▶ PostgreSQL (사용자/권한)
   │  세션 저장: Redis
   │ (로그인 됨)
   ▼
Kibana ──▶ Elasticsearch
```

| 구성 요소 | 하는 일 | 필수 여부 |
|---|---|---|
| **Keycloak** | 로그인 화면, 사용자/그룹/역할 관리, 비밀번호 정책, 계정 잠금, OTP(2FA), LDAP/AD 연동. OIDC 표준 제공 | 필수 (이 구조의 핵심) |
| **PostgreSQL / MySQL** | Keycloak 의 데이터 저장소 (사용자, 설정). **우리가 테이블을 만들 필요 없음** | 필수 (Keycloak 운영 모드는 외부 DB 필요) |
| **oauth2-proxy** | Kibana 앞에서 로그인 여부 확인 → 안 됐으면 Keycloak 으로 보내고, 돌아오면 **원래 요청 URL 로 리다이렉트** | 필수 (B안이면 Spring 으로 대체) |
| **Redis** | oauth2-proxy 세션 저장. Keycloak 토큰이 커서 쿠키(4KB)를 넘기기 쉬움 + oauth2-proxy 를 2대 이상 띄울 때 세션 공유 | 사실상 권장. 1대·소규모면 쿠키 저장으로 시작 가능 |
| **HAProxy** | HTTPS 종료, 도메인/경로 라우팅, 다중화 | 이미 사내 L4/L7 이나 nginx 가 있으면 그걸로 대체 가능 |

## 3. 세 가지 안 비교

| | 현재 (PR #1 Node 게이트웨이) | **A. Keycloak + oauth2-proxy** (제안안) | B. Keycloak + Spring Cloud Gateway |
|---|---|---|---|
| 로그인 화면/계정 관리 | 직접 구현 (DB 테이블, bcrypt, 잠금 등) | Keycloak 이 제공 (관리 콘솔 있음) | Keycloak 이 제공 |
| 원래 화면으로 리다이렉트 | 직접 구현 | oauth2-proxy 기본 기능 | Spring Security 기본 기능 (SavedRequest) |
| 우리가 관리할 코드 | Node 코드 전체 | **거의 없음** (설정 파일) | Spring Boot 앱 1개 (작음) |
| 언어 | JavaScript | 설정 위주 (Keycloak 확장은 Java) | **Java/Spring** |
| 2FA, LDAP/AD, SSO 확장 | 직접 구현해야 함 | 설정으로 가능 | 설정으로 가능 |
| 다른 내부 시스템에도 로그인 재사용 | 어려움 | 쉬움 (Keycloak 하나로 SSO) | 쉬움 |
| 띄울 서버 수 | 1개 | 4~5개 (Keycloak, DB, oauth2-proxy, Redis, HAProxy) | 4~5개 (oauth2-proxy → Spring 앱) |
| 운영 부담 | 낮음, 대신 보안 책임이 우리 코드에 있음 | 중간 (구성품 많음, 대신 검증된 제품) | 중간 + 코드 유지보수 |
| 내부망 반입 | npm 패키지 | Docker 이미지 또는 바이너리 (oauth2-proxy 는 단일 바이너리) | Docker 이미지 또는 JAR |

### 언제 무엇을 고르나
- **Kibana 하나만, 사용자 몇 명, 서버 늘리기 부담** → 현재 방식(또는 같은 일을 하는 작은 Spring Boot 앱)도 충분합니다.
- **앞으로 다른 내부 시스템도 같은 계정으로 로그인, 2FA/AD 연동 가능성, 계정 관리를 화면에서 하고 싶음** → A안. 장기적으로 가장 덜 짜고 덜 고칩니다.
- **A안 + 요청마다 우리만의 로직이 필요** (예: 역할별로 다른 Kibana 계정/space 로 연결, 접속 감사 로그를 사내 DB 에 저장) → B안.

## 4. Spring/Java 개발자 관점에서

- **Keycloak 자체가 Java(Quarkus) 기반**입니다. 확장이 필요하면 Java 로 SPI 를 작성합니다.
  - 예: 이미 사내 사용자 DB 가 있다면 **User Storage SPI** 로 Keycloak 이 그 DB 를 그대로 조회하게 만들 수 있습니다 (사용자 이관 불필요).
  - 로그인 화면 디자인은 Keycloak 테마(FreeMarker 템플릿)로 바꿉니다.
- **B안 코드 규모 감**: Spring Cloud Gateway + `spring-boot-starter-oauth2-client` + (다중화 시) Spring Session Redis. 핵심 설정은 `application.yml` 에 Keycloak issuer-uri, client-id/secret, Kibana 라우트 정의 정도이고, Java 코드는 SecurityConfig 하나와 필요한 커스텀 필터 정도입니다.
- A안을 고르더라도 Spring 앱이 필요 없어지는 것일 뿐, 나중에 B안으로 바꾸는 건 oauth2-proxy 한 칸만 교체하면 되어서 **되돌리기 쉽습니다.** 그래서 A안으로 시작하는 걸 권장합니다.

## 5. 꼭 확인할 점 (Kibana 연동)

### 5-1. Kibana 이중 로그인 문제
Elasticsearch 보안이 켜져 있으면 Kibana 가 자체 로그인 화면을 띄웁니다. Keycloak 로그인 후 또 로그인하게 되므로 아래 중 하나를 골라야 합니다.

| 방법 | 내용 | 비고 |
|---|---|---|
| ① Kibana OIDC 연동 | Kibana/Elasticsearch 가 Keycloak 을 직접 신뢰 (사용자별 권한 유지) | **Elastic 유료 라이선스(Platinum 이상) 필요** |
| ② 공용 서비스 계정 헤더 주입 | oauth2-proxy/HAProxy(또는 Spring)가 `Authorization: Basic <kibana용 계정>` 을 붙여서 전달 | 무료. 대신 Kibana 안에서는 모두 같은 계정으로 보임. B안이면 역할별로 다른 계정 주입 가능 |
| ③ Kibana anonymous 인증 | Kibana 에 익명 접근 허용, 앞단에서만 막음 | 무료. Kibana 포트를 방화벽으로 반드시 차단 |
| ④ ES 보안 꺼짐 | 이미 보안이 꺼진 환경이면 그냥 프록시만 | 현재 상황이 이것일 가능성 있음 ("로그인 없이 접근 가능") |

→ **내부망에서 확인 필요**: Elastic 버전, 라이선스, `xpack.security.enabled` 여부.
(현재 "로그인 없이 접근 가능한 Kibana" 라는 전제라면 ④ 또는 ③ 에 해당할 가능성이 높아 문제가 작습니다.)

### 5-2. Kibana 포트 직접 접근 차단
어느 안이든 Kibana 5601 포트로 직접 들어오면 로그인을 우회합니다. 방화벽/보안그룹으로 5601 은 프록시 서버에서만 접근 가능하게 막아야 합니다.

### 5-3. URL 의 `#` 뒷부분
브라우저는 `#...` 부분을 서버로 보내지 않습니다. 그래서 oauth2-proxy / Spring 모두 로그인 후 원래 주소의 `#` 이후는 잃어버릴 수 있습니다. 최근 Kibana 는 대부분 경로/쿼리 기반이라 영향이 작지만, 대시보드 링크를 `#/view/...` 형태로 공유한다면 테스트해 봐야 합니다. (현재 Node 게이트웨이는 이 부분을 JS 로 보존하도록 만들어 둠.)

### 5-4. Kibana basePath
oauth2-proxy 를 `/` 에 두고 Kibana 를 그대로 붙이면 basePath 설정이 필요 없습니다. 경로(`/kibana`) 아래로 붙일 경우에만 현재 README 처럼 `server.basePath` 설정이 필요합니다.

## 6. 제안하는 진행 순서 (결정 후)

1. 내부망 확인: Elastic 버전/라이선스/보안 설정, 사내 기존 사용자 DB·AD 여부, Docker 사용 가능 여부, 기존 HAProxy/nginx 유무
2. A안/B안 결정
3. `docker-compose.yml` 로 로컬 재현 환경 작성: Keycloak + PostgreSQL + oauth2-proxy(또는 Spring Gateway) + Redis + HAProxy + Mock Kibana
4. Keycloak realm/client 설정을 export 파일(`realm-export.json`)로 저장소에 보관 → 내부망에서 그대로 import
5. 내부망 이전 후 실제 Kibana 연결, 5601 포트 차단, HTTPS 인증서 적용
6. 현재 Node 게이트웨이는 비교용으로 남기거나 정리

## 7. 결정이 필요한 것

- [ ] A안(oauth2-proxy, 설정 위주) vs B안(Spring Cloud Gateway, Java 코드)
- [ ] DB: PostgreSQL(권장) vs MySQL
- [ ] HAProxy 를 새로 둘지, 사내 기존 프록시/로드밸런서를 쓸지
- [ ] Kibana 이중 로그인 대응 방법 (5-1 표 중 선택, 내부망 확인 후)
