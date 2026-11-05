package com.weblogin.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Kibana 앞단 로그인 게이트웨이.
 *
 * <pre>
 * 브라우저 → (기존 HAProxy) → 이 앱 → Kibana
 *                              │ 로그인 안 됨
 *                              └→ Keycloak 로그인 → 다시 원래 Kibana 화면
 * </pre>
 *
 * 설정은 application.yml 과 환경변수(.env)로 합니다.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class GatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}
