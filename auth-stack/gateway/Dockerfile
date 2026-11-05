# kibana-gateway 실행 이미지
# 먼저 jar 를 빌드하세요:  mvn -DskipTests package   (IntelliJ: Maven → package)
# 내부망에서 Maven 저장소를 못 쓰는 경우를 고려해, 이미지 안에서 빌드하지 않고 만들어진 jar 만 복사합니다.
FROM eclipse-temurin:17-jre
WORKDIR /app
COPY target/kibana-gateway.jar app.jar
EXPOSE 8081
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
