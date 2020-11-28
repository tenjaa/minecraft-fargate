FROM alpine as builder
RUN apk add --no-cache curl dos2unix
RUN curl -o forge-installer.jar https://files.minecraftforge.net/maven/net/minecraftforge/forge/1.16.4-35.1.3/forge-1.16.4-35.1.3-installer.jar
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
RUN unzip awscliv2.zip
COPY scripts scripts
RUN dos2unix scripts/*

FROM openjdk:14
WORKDIR /minecraft
COPY --from=builder forge-installer.jar forge-installer.jar
RUN java -jar forge-installer.jar --installServer && \
    rm forge-installer.jar && \
    echo "eula=true" > eula.txt
WORKDIR /
COPY --from=builder aws aws
RUN ./aws/install && rm -rf aws
RUN curl -o jq https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64 -L && \
    chmod +x jq && \
    mv jq /bin
COPY --from=builder scripts scripts
CMD ["scripts/wrapper.sh"]
