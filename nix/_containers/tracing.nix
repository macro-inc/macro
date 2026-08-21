# Optional tracing backends (compose profiles `jaeger` and `datadog`).
#
# Jaeger is the upstream linux-amd64 all-in-one binary (not in this nixpkgs).
# Datadog is Nixpkgs' datadog-agent. Neither image uses a registry base.
{ pkgs }:
let
  imageLib = pkgs.callPackage ./image-lib.nix { };

  jaegerSrc = pkgs.fetchurl {
    url = "https://github.com/jaegertracing/jaeger/releases/download/v1.68.0/jaeger-1.68.0-linux-amd64.tar.gz";
    hash = "sha256-xoczP7Xv16I+fPdOe5tLgxl8OYo6Vknp2mRK65gH7rE=";
  };

  jaegerBin = pkgs.runCommand "jaeger-all-in-one-1.68.0" {
    nativeBuildInputs = [
      pkgs.gnutar
      pkgs.gzip
    ];
  } ''
    mkdir -p "$out/bin"
    tar -xzf ${jaegerSrc} -C "$out"
    mv "$out"/jaeger-1.68.0-linux-amd64/jaeger-all-in-one "$out/bin/jaeger-all-in-one"
    chmod +x "$out/bin/jaeger-all-in-one"
    rm -rf "$out"/jaeger-1.68.0-linux-amd64
  '';

  jaeger = imageLib.mk {
    name = "macro-local-jaeger";
    extraContents = [ jaegerBin ];
    extraPath = [ jaegerBin ];
    extraEnv = [
      "COLLECTOR_OTLP_ENABLED=true"
    ];
    config = {
      Cmd = [
        "${jaegerBin}/bin/jaeger-all-in-one"
        "--collector.otlp.http.cors.allowed-origins=*"
        "--collector.otlp.http.cors.allowed-headers=*"
      ];
      ExposedPorts = {
        "16686/tcp" = { };
        "4317/tcp" = { };
        "4318/tcp" = { };
      };
    };
  };

  datadogAgent = imageLib.mk {
    name = "macro-local-datadog-agent";
    extraContents = [ pkgs.datadog-agent ];
    extraPath = [ pkgs.datadog-agent ];
    extraCommands = ''
      mkdir -p ./etc/datadog-agent
    '';
    config = {
      Cmd = [
        "${pkgs.datadog-agent}/bin/agent"
        "run"
      ];
      ExposedPorts = {
        "4317/tcp" = { };
        "4318/tcp" = { };
      };
    };
  };
in
{
  inherit jaeger datadogAgent;
}
