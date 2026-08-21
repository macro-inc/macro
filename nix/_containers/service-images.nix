# Production-style images: crane binary + the shared runtime.
#
# Layout matches both contracts:
# - `/app/svc` (`Dockerfile.prebuilt`)
# - `/app/out/<bin>` (local stack)
#
# These are comparison / deploy artifacts. The local stack does not bake
# binaries into the runtime image; it bind-mounts `/app/out`.
{
  pkgs,
  runtime,
  deployPackages,
}:
let
  inherit (pkgs) lib;
  inherit (pkgs.dockerTools) buildLayeredImage;

  layout =
    package: binaries:
    pkgs.runCommand "svc-layout-${package.pname or "service"}" { } ''
      mkdir -p $out/app/out
      first=""
      for binary in ${lib.concatStringsSep " " binaries}; do
        ln -s ${package}/bin/$binary $out/app/out/$binary
        if [ -z "$first" ]; then
          first=$binary
          ln -s ${package}/bin/$binary $out/app/svc
        fi
      done
    '';

  specs = [
    {
      serviceName = "agent-harness-service";
      binaries = [ "agent_harness_service" ];
    }
    {
      serviceName = "agent-schedule-service";
      binaries = [ "service" ];
    }
    {
      serviceName = "authentication-service";
      binaries = [ "authentication_service" ];
    }
    {
      serviceName = "connection-gateway";
      binaries = [ "connection_gateway_service" ];
    }
    {
      serviceName = "contacts-service";
      binaries = [ "contacts_service" ];
    }
    {
      serviceName = "convert-service";
      binaries = [ "convert_service" ];
    }
    {
      serviceName = "document-cognition-service";
      binaries = [ "document_cognition_service" ];
    }
    {
      serviceName = "document-storage-service";
      binaries = [ "document_storage_service" ];
    }
    {
      serviceName = "email-service";
      binaries = [
        "email_service"
        "pubsub_workers"
      ];
    }
    {
      serviceName = "image-proxy-service";
      binaries = [ "image_proxy_service" ];
    }
    {
      serviceName = "mcp-server";
      binaries = [ "mcp_service" ];
    }
    {
      serviceName = "notification-service";
      binaries = [ "notification_service" ];
    }
    {
      serviceName = "search-processing-service";
      binaries = [ "search_processing_service" ];
    }
    {
      serviceName = "static-file-service";
      binaries = [ "static_file_service" ];
    }
    {
      serviceName = "unfurl-service";
      binaries = [ "unfurl_service" ];
    }
  ];
in
lib.listToAttrs (
  map (spec: {
    name = "docker-image-${spec.serviceName}";
    value = buildLayeredImage (
      runtime.mkImage {
        name = spec.serviceName;
        tag = "latest";
        extraContents = [
          (layout deployPackages."deploy-service-binaries-${spec.serviceName}" spec.binaries)
        ];
        extraConfig.Cmd = [ "/app/svc" ];
      }
    );
  }) specs
)
