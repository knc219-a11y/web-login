package com.weblogin.gateway.config;

import static org.springframework.cloud.gateway.server.mvc.handler.GatewayRouterFunctions.route;
import static org.springframework.cloud.gateway.server.mvc.handler.HandlerFunctions.http;
import static org.springframework.web.servlet.function.RequestPredicates.path;

import java.util.List;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.web.servlet.function.RouterFunction;
import org.springframework.web.servlet.function.ServerRequest;
import org.springframework.web.servlet.function.ServerResponse;

/**
 * Kibana 프록시 라우트.
 *
 * <p>/kibana/** 요청을 Kibana 로 그대로 넘기고, 로그인 사용자 정보를 헤더로 붙입니다.
 * (로그인 검사는 SecurityConfig 에서 이미 끝난 상태)
 */
@Configuration
public class KibanaRouteConfig {

    private static final Logger log = LoggerFactory.getLogger(KibanaRouteConfig.class);

    static final String HEADER_USER = "X-Forwarded-User";
    static final String HEADER_EMAIL = "X-Forwarded-Email";
    static final String HEADER_GROUPS = "X-Forwarded-Groups";

    @Bean
    public RouterFunction<ServerResponse> kibanaRoute(AppProperties props) {
        return route("kibana")
                .route(path(props.kibanaPath() + "/**"), http(props.kibanaUrl()))
                .before(KibanaRouteConfig::addUserHeaders)
                .build();
    }

    /**
     * 로그인 사용자 정보를 Kibana 로 전달.
     * 브라우저가 같은 이름의 헤더를 보내 사용자를 사칭하지 못하도록 항상 덮어씁니다.
     *
     * <p>TODO: Kibana 이중 로그인 대응이 필요하면 여기서 Authorization 헤더를 붙일 수 있음
     *  (예: 그룹별로 다른 Kibana 계정). auth-stack/README.md "Kibana 이중 로그인" 참고.
     */
    static ServerRequest addUserHeaders(ServerRequest request) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof OidcUser user)) {
            return request;
        }
        String username = user.getPreferredUsername() != null ? user.getPreferredUsername() : user.getSubject();
        String email = user.getEmail() != null ? user.getEmail() : "";
        List<String> groups = user.getClaimAsStringList("groups");
        String groupsValue = groups == null ? "" : groups.stream().collect(Collectors.joining(","));

        log.debug("kibana access user={} {} {}", username, request.method(), request.path());

        return ServerRequest.from(request)
                .headers(h -> {
                    h.set(HEADER_USER, username);
                    h.set(HEADER_EMAIL, email);
                    h.set(HEADER_GROUPS, groupsValue);
                })
                .build();
    }
}
