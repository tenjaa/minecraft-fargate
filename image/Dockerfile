FROM alpine AS builder
RUN apk add --no-cache curl dos2unix
RUN curl -o forge-installer.jar https://maven.neoforged.net/releases/net/neoforged/neoforge/26.3.0.88/neoforge-26.3.0.88-installer.jar
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"
RUN unzip awscliv2.zip
COPY scripts scripts
RUN dos2unix scripts/*

FROM amazoncorretto:25
RUN dnf install -y tar && \
    dnf clean all && \
    tar --version
WORKDIR /minecraft
COPY --from=builder forge-installer.jar forge-installer.jar
RUN java -jar forge-installer.jar --installServer && \
    rm forge-installer.jar && \
    echo "eula=true" > eula.txt
WORKDIR /
COPY --from=builder aws aws
RUN ./aws/install && rm -rf aws
RUN curl -o jq https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-linux-arm64 -L && \
    chmod +x jq && \
    mv jq /bin
COPY --from=builder scripts scripts
CMD ["scripts/wrapper.sh"]
