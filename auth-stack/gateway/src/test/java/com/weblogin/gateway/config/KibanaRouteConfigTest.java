package com.weblogin.gateway.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.web.servlet.function.ServerRequest;

class KibanaRouteConfigTest {

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void 사용자_헤더는_로그인_정보로_덮어씀() {
        OidcIdToken token = OidcIdToken.withTokenValue("t")
                .subject("sub-1")
                .claim("preferred_username", "admin")
                .claim("email", "admin@example.local")
                .claim("groups", List.of("/kibana-users", "/kibana-admins"))
                .build();
        DefaultOidcUser user = new DefaultOidcUser(AuthorityUtils.createAuthorityList("OIDC_USER"), token, "preferred_username");
        SecurityContextHolder.getContext().setAuthentication(
                new OAuth2AuthenticationToken(user, user.getAuthorities(), "keycloak"));

        MockHttpServletRequest raw = new MockHttpServletRequest("GET", "/kibana/app/home");
        raw.addHeader(KibanaRouteConfig.HEADER_USER, "hacker"); // 사칭 시도
        ServerRequest result = KibanaRouteConfig.addUserHeaders(ServerRequest.create(raw, List.of()));

        assertThat(result.headers().header(KibanaRouteConfig.HEADER_USER)).containsExactly("admin");
        assertThat(result.headers().header(KibanaRouteConfig.HEADER_EMAIL)).containsExactly("admin@example.local");
        assertThat(result.headers().header(KibanaRouteConfig.HEADER_GROUPS)).containsExactly("/kibana-users,/kibana-admins");
    }
}
