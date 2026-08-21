{ lib }:
let
  inherit (lib) paths;
in
{
  jaeger = lib.nixImage lib.images.jaeger {
    environment = {
      COLLECTOR_OTLP_ENABLED = "true";
    };
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

  datadog-agent = lib.nixImage lib.images.datadog-agent {
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
