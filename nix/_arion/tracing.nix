{ lib }:
let
  inherit (lib) paths;
in
{
  jaeger = lib.pulled "jaegertracing/all-in-one:latest" {
    environment = {
      COLLECTOR_OTLP_ENABLED = "true";
    };
    command = [
      "--collector.otlp.http.cors.allowed-origins=*"
      "--collector.otlp.http.cors.allowed-headers=*"
    ];
    ports = [
      "16686:16686"
      "4317:4317"
      "4318:4318"
    ];
    networks = {
      services = {
        aliases = [ "otel-collector" ];
      };
    };
  }
  // {
    out.service.profiles = [ "jaeger" ];
  };

  datadog-agent = lib.pulled "gcr.io/datadoghq/agent:7" {
    environment = {
      DD_API_KEY = "";
      DD_SITE = "us5.datadoghq.com";
      DD_ENV = "local";
      DD_HOSTNAME = "local-dev";
      DD_APM_ENABLED = "true";
    };
    volumes = [
      "${paths.datadogYaml}:/etc/datadog-agent/datadog.yaml:ro"
    ];
    ports = [
      "4317:4317"
      "4318:4318"
    ];
    networks = {
      services = {
        aliases = [ "otel-collector" ];
      };
    };
  }
  // {
    out.service.profiles = [ "datadog" ];
  };
}
