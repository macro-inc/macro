FROM golang:1.27.2-bookworm AS build
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends patch && rm -rf /var/lib/apt/lists/*
COPY go.mod go.sum go.sh ./
COPY patches ./patches
RUN ./go.sh mod download
COPY internal ./internal
COPY cmd ./cmd
RUN CGO_ENABLED=1 ./go.sh build -trimpath -o /out/whatsapp-session ./cmd/whatsapp-session
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --uid 12001 --create-home macro
COPY --from=build /out/whatsapp-session /usr/local/bin/whatsapp-session
COPY licenses /usr/share/doc/whatsapp-session/licenses
COPY THIRD_PARTY_NOTICES.md /usr/share/doc/whatsapp-session/THIRD_PARTY_NOTICES.md
USER 12001:12001
ENTRYPOINT ["/usr/local/bin/whatsapp-session"]
