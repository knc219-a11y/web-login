package com.weblogin.gateway.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.oidc.web.logout.OidcClientInitiatedLogoutSuccessHandler;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestRedirectFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.SavedRequestAwareAuthenticationSuccessHandler;
import org.springframework.security.web.savedrequest.HttpSessionRequestCache;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;

/**
 * 로그인/로그아웃 규칙.
 *
 * <ul>
 *   <li>/actuator/health 외 모든 요청은 로그인 필요</li>
 *   <li>로그인 안 됐으면 Keycloak 로그인 화면으로 이동 (원래 주소는 세션에 저장)</li>
 *   <li>로그인 성공 → 원래 요청했던 주소로 이동. 없으면 app.default-redirect</li>
 *   <li>GET /logout → 게이트웨이 세션 삭제 + Keycloak 로그아웃 → 기본 화면(=다시 로그인 화면)</li>
 * </ul>
 */
@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                   ClientRegistrationRepository clients,
                                                   AppProperties props) throws Exception {
        // 로그인 성공 시 원래 요청 주소로 (Spring Security 기본 동작), 없으면 기본 화면으로
        SavedRequestAwareAuthenticationSuccessHandler successHandler = new SavedRequestAwareAuthenticationSuccessHandler();
        successHandler.setDefaultTargetUrl(props.defaultRedirect());

        // 로그인 전 주소 저장. Spring 기본값은 돌아갈 때 주소 끝에 "?continue" 를 붙이는데,
        // Kibana 주소를 그대로 보존하기 위해 끔
        HttpSessionRequestCache requestCache = new HttpSessionRequestCache();
        requestCache.setMatchingRequestParameterName(null);
        successHandler.setRequestCache(requestCache);

        // Keycloak 로그아웃 후 돌아올 주소
        OidcClientInitiatedLogoutSuccessHandler logoutSuccessHandler = new OidcClientInitiatedLogoutSuccessHandler(clients);
        logoutSuccessHandler.setPostLogoutRedirectUri("{baseUrl}" + props.defaultRedirect());

        // PKCE 사용 (Keycloak 클라이언트에 S256 필수로 설정되어 있음)
        DefaultOAuth2AuthorizationRequestResolver authRequestResolver = new DefaultOAuth2AuthorizationRequestResolver(
                clients, OAuth2AuthorizationRequestRedirectFilter.DEFAULT_AUTHORIZATION_REQUEST_BASE_URI);
        authRequestResolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());

        http
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()
                        // TODO: 그룹별 접근 제한이 필요하면 여기서. 예) .anyRequest().hasAuthority("OIDC_USER") 대신 그룹 검사
                        .anyRequest().authenticated())
                .requestCache(cache -> cache.requestCache(requestCache))
                .oauth2Login(login -> login
                        .authorizationEndpoint(ep -> ep.authorizationRequestResolver(authRequestResolver))
                        .successHandler(successHandler))
                .logout(logout -> logout
                        // Kibana 화면의 링크로도 로그아웃할 수 있게 GET 허용
                        .logoutRequestMatcher(new AntPathRequestMatcher("/logout", "GET"))
                        .logoutSuccessHandler(logoutSuccessHandler))
                // Kibana 는 자체 XSRF 보호(kbn-xsrf 헤더)를 쓰고, 게이트웨이 CSRF 를 켜면 Kibana 의 POST API 가 막힘
                .csrf(csrf -> csrf.disable());

        return http.build();
    }
}
