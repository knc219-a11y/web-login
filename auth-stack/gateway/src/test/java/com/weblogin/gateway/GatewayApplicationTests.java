package com.weblogin.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oidcLogin;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;


import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * Redis 없이 로그인 흐름만 검사합니다. (세션은 메모리)
 */
@SpringBootTest(properties = {
        "spring.autoconfigure.exclude="
                + "org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration,"
                + "org.springframework.boot.autoconfigure.session.SessionAutoConfiguration",
        "app.kibana-url=http://127.0.0.1:1",
        "app.keycloak.realm-url=http://kc.test/auth/realms/kibana",
        "app.keycloak.internal-realm-url=http://keycloak:8080/auth/realms/kibana"
})
@AutoConfigureMockMvc
class GatewayApplicationTests {

    @Autowired
    MockMvc mvc;

    @Autowired
    ClientRegistrationRepository clients;

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void 로그인_안_하면_Keycloak_로그인으로_보냄() throws Exception {
        mvc.perform(get("/kibana/app/discover"))
                .andExpect(status().isFound())
                .andExpect(redirectedUrl("http://localhost/oauth2/authorization/keycloak"));
    }

    @Test
    void Keycloak_로그인_주소는_공개주소이고_PKCE를_사용() throws Exception {
        MvcResult r = mvc.perform(get("/oauth2/authorization/keycloak"))
                .andExpect(status().isFound())
                .andReturn();
        String location = r.getResponse().getHeader("Location");
        assertThat(location)
                .startsWith("http://kc.test/auth/realms/kibana/protocol/openid-connect/auth?")
                .contains("client_id=kibana-gateway")
                .contains("code_challenge_method=S256")
                .contains("redirect_uri=http://localhost/login/oauth2/code/keycloak");
    }

    @Test
    void 로그인_전_요청주소를_세션에_기억() throws Exception {
        MockHttpSession session = new MockHttpSession();
        mvc.perform(get("/kibana/app/discover").queryParam("_a", "(query:x)").session(session))
                .andExpect(status().isFound());
        Object saved = session.getAttribute("SPRING_SECURITY_SAVED_REQUEST");
        assertThat(saved).isNotNull();
        assertThat(saved.toString()).contains("/kibana/app/discover?_a=(query:x)");
    }

    @Test
    void 헬스체크는_로그인_없이() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }

    @Test
    void 로그아웃하면_Keycloak_로그아웃으로() throws Exception {
        mvc.perform(get("/logout").with(oidcLogin().clientRegistration(clients.findByRegistrationId("keycloak"))))
                .andExpect(status().isFound())
                .andExpect(header().string("Location",
                        org.hamcrest.Matchers.startsWith("http://kc.test/auth/realms/kibana/protocol/openid-connect/logout?")));
    }
}
