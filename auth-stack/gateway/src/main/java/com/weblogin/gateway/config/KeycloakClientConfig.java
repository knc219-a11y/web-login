package com.weblogin.gateway.config;

import java.util.Map;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.registration.InMemoryClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;

/**
 * Keycloak(OIDC) 클라이언트 등록.
 *
 * <p>yml 의 issuer-uri 한 줄로도 설정할 수 있지만, 그러면 기동 시 게이트웨이가 브라우저용 주소로
 * Keycloak 에 접속할 수 있어야 합니다. 내부망에서는 "브라우저가 보는 주소"와 "서버끼리 통신하는 주소"가
 * 다른 경우가 많아서 엔드포인트를 직접 지정합니다.
 * <ul>
 *   <li>브라우저가 가는 곳 (로그인 화면, 로그아웃): realmUrl</li>
 *   <li>게이트웨이가 직접 호출하는 곳 (토큰, 서명키, 사용자정보): internalRealmUrl</li>
 * </ul>
 */
@Configuration
public class KeycloakClientConfig {

    public static final String REGISTRATION_ID = "keycloak";

    @Bean
    public ClientRegistrationRepository clientRegistrationRepository(AppProperties props) {
        AppProperties.Keycloak kc = props.keycloak();
        String publicOidc = kc.realmUrl() + "/protocol/openid-connect";
        String internalOidc = kc.internalRealmUrl() + "/protocol/openid-connect";

        ClientRegistration keycloak = ClientRegistration.withRegistrationId(REGISTRATION_ID)
                .clientName("Keycloak")
                .clientId(kc.clientId())
                .clientSecret(kc.clientSecret())
                .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                .redirectUri("{baseUrl}/login/oauth2/code/{registrationId}")
                .scope("openid", "profile", "email")
                // 브라우저용
                .authorizationUri(publicOidc + "/auth")
                .issuerUri(kc.realmUrl()) // ID 토큰의 iss 검증에 사용
                .providerConfigurationMetadata(Map.of("end_session_endpoint", publicOidc + "/logout"))
                // 서버 간 통신용
                .tokenUri(internalOidc + "/token")
                .jwkSetUri(internalOidc + "/certs")
                .userInfoUri(internalOidc + "/userinfo")
                .userNameAttributeName("preferred_username")
                .build();

        return new InMemoryClientRegistrationRepository(keycloak);
    }
}
