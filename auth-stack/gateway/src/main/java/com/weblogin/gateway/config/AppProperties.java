package com.weblogin.gateway.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * application.yml 의 app.* 설정.
 *
 * @param kibanaUrl       프록시할 Kibana 주소 (TODO: 내부망 실제 주소)
 * @param kibanaPath      게이트웨이에서 Kibana 로 넘길 경로 (Kibana server.basePath 와 동일)
 * @param defaultRedirect 원래 요청 주소가 없을 때 로그인 후 이동할 화면
 * @param keycloak        Keycloak 연결 정보
 */
@ConfigurationProperties(prefix = "app")
public record AppProperties(
        String kibanaUrl,
        String kibanaPath,
        String defaultRedirect,
        Keycloak keycloak) {

    /**
     * @param realmUrl         브라우저가 접속하는 Keycloak realm 주소. 토큰의 issuer 와 같아야 함.
     *                         예) https://kibana.example.co.kr/auth/realms/kibana
     * @param internalRealmUrl 게이트웨이 서버가 토큰을 받으러 갈 Keycloak 주소.
     *                         게이트웨이에서 realmUrl 로 바로 접속이 되면 realmUrl 과 같게 두면 됨.
     * @param clientId         Keycloak 클라이언트 ID
     * @param clientSecret     Keycloak 클라이언트 비밀값 (TODO: 운영 값)
     */
    public record Keycloak(
            String realmUrl,
            String internalRealmUrl,
            String clientId,
            String clientSecret) {
    }
}
