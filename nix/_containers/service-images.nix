# Production-style images: crane binary + the shared runtime.
#
# Layout matches both contracts:
# - `/app/svc` (ECS entrypoint)
# - `/app/out/<bin>` (local stack / pubsub workers)
{
  pkgs,
  runtime,
  deployPackages,
}:
let
  inherit (pkgs) lib;
  inherit (pkgs.dockerTools) buildLayeredImage;

  convert = pkgs.callPackage ./convert.nix { inherit lib; };
  pdfium = pkgs.callPackage ./pdfium.nix { };

  layout =
    {
      package,
      binaries,
      svcBinary,
    }:
    pkgs.runCommand "svc-layout-${package.pname or "service"}" { } ''
      mkdir -p $out/app/out
      for binary in ${lib.concatStringsSep " " binaries}; do
        ln -s ${package}/bin/$binary $out/app/out/$binary
      done
      ln -s ${package}/bin/${svcBinary} $out/app/svc
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
      extraContents = [
        convert.layout
      ]
      ++ convert.lokLibs;
      extraEnv = convert.extraEnv;
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
      svcBinary = "email_service";
    }
    {
      serviceName = "email-service-pubsub-workers";
      packageName = "email-service";
      binaries = [
        "email_service"
        "pubsub_workers"
      ];
      svcBinary = "pubsub_workers";
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
      extraContents = [ pdfium ];
    }
    {
      serviceName = "sha-cleanup-worker";
      binaries = [ "sha_cleanup_worker" ];
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

  mkSpec =
    spec:
    let
      packageName = spec.packageName or spec.serviceName;
      svcBinary = spec.svcBinary or (builtins.head spec.binaries);
      extraContents = spec.extraContents or [ ];
      extraEnv = spec.extraEnv or [ ];
    in
    {
      name = "docker-image-${spec.serviceName}";
      value = buildLayeredImage (
        runtime.mkImage {
          name = spec.serviceName;
          tag = "latest";
          extraContents = [
            (layout {
              package = deployPackages."deploy-service-binaries-${packageName}";
              binaries = spec.binaries;
              inherit svcBinary;
            })
          ]
          ++ extraContents;
          inherit extraEnv;
          extraConfig.Cmd = [ "/app/svc" ];
        }
      );
    };
in
lib.listToAttrs (map mkSpec specs)
