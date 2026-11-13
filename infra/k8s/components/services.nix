{
  pkgs,
  lib,
  platformLib,
  packages,
  instance,
  ...
}:
let
  inherit (platformLib) image;
  binaries = {
    authentication-service = "authentication_service";
    connection-gateway = "connection_gateway_service";
    contacts-service = "contacts_service";
    document-storage-service = "document_storage_service";
    document-upload-finalizer = "document_upload_finalizer_local_worker";
    email-service = "email_service";
    email-pubsub-workers = "pubsub_workers";
    calendar-service = "calendar_service";
    notification-service = "notification_service";
    search-processing-service = "search_processing_service";
    agent-harness-service = "agent_harness_service";
    whatsapp-session-service = "whatsapp_session_service";
    static-file-service = "static_file_service";
    unfurl-service = "unfurl_service";
    image-proxy-service = "image_proxy_service";
  }
  // lib.optionalAttrs instance.enableGmail { gmail-forwarder = "seed_cli"; };
  workers = [
    "document-upload-finalizer"
    "email-pubsub-workers"
    "gmail-forwarder"
  ];
  base = image {
    name = "rust-dev";
    contents = [
      pkgs.openssl
      pkgs.stdenv.cc.cc.lib
      pkgs.curl
      packages.code-mode-assets
    ];
    entrypoint = [ "/bin/false" ];
  };

in
lib.mapAttrs (name: bin: {
  image =
    if instance.devBinaries != null then
      base
    else
      image {
        inherit name;
        contents = [
          (packages.${
            if name == "authentication-service" then
              "local-stack-binaries-local-authentication"
            else if name == "search-processing-service" then
              "local-stack-binaries-local-search-processing"
            else if name == "document-upload-finalizer" then
              "local-stack-binaries-local-upload-finalizer"
            else if name == "gmail-forwarder" then
              "local-stack-binaries-local-seed-cli"
            else if name == "email-pubsub-workers" then
              "deploy-service-binaries-email-service"
            else
              "deploy-service-binaries-${name}"
          }
          )
        ];
        entrypoint = [ "/bin/${bin}" ];
      };
  command = lib.optionals (instance.devBinaries != null) [
    "${pkgs.dumb-init}/bin/dumb-init"
    "--"
    "/app/out/${bin}"
  ];
  args = lib.optionals (name == "gmail-forwarder") [
    "gmail"
    "forward"
    "--target"
    "http://email-service:8080/gmail/webhook"
    "--subscription"
    "projects/macro-email-testing/subscriptions/gmail-local-watch-${instance.name}"
  ];
  terminationGracePeriod = if name == "whatsapp-session-service" then 120 else 30;
  sharedEnv = true;
  env = {
    # Keep the service identity consistent between native and full-image builds.
    DD_SERVICE = name;
    PORT = "8080";
  }
  // lib.optionalAttrs (name == "document-storage-service" && instance.devBinaries != null) {
    RUST_MIN_STACK = "16777216";
  };
  ports =
    if builtins.elem name workers then
      [ ]
    else if name == "agent-harness-service" then
      [
        8080
        8102
        8111
        2222
      ]
    else
      [ 8080 ];
  readiness =
    if builtins.elem name workers then
      { exec = [ "/bin/true" ]; }
    else
      {
        http = if name == "static-file-service" then "/api/health" else "/health";
        port = 8080;
      };
  mounts =
    lib.optionals (instance.devBinaries != null) [
      {
        name = "binaries";
        mountPath = "/app/out";
        readOnly = true;
      }
      {
        name = "nix-store";
        mountPath = "/nix/store";
        readOnly = true;
      }
    ]
    ++ lib.optionals (name == "agent-harness-service" && instance.devBinaries != null) [
      {
        name = "docker";
        mountPath = "/var/run/docker.sock";
      }
    ];
  podVolumes =
    lib.optionals (instance.devBinaries != null) [
      {
        name = "binaries";
        hostPath = {
          path = instance.devBinaries;
          type = "Directory";
        };
      }
      {
        name = "nix-store";
        hostPath = {
          path = "/nix/store";
          type = "Directory";
        };
      }
    ]
    ++ lib.optionals (name == "agent-harness-service" && instance.devBinaries != null) [
      {
        name = "docker";
        hostPath = {
          path = "/var/run/docker.sock";
          type = "Socket";
        };
      }
    ];
}) binaries
