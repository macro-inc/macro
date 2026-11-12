{
  platformPkgs,
  instance,
  lib,
  ...
}:
lib.optionalAttrs instance.telemetry {
  otel-collector = {
    image = platformPkgs.upstreamImage "lgtm" instance.registry;
    infra = true;
    aliases = [ "lgtm" ];
    ports = [
      3000
      4317
      4318
      3100
      3200
      9090
    ];
    volumes.data = "/data";
    files.tempo = {
      configMap = "lgtm-tempo";
      mountPath = "/otel-lgtm/tempo-config.yaml";
      subPath = "tempo-config.yaml";
    };
    env = {
      GF_AUTH_ANONYMOUS_ENABLED = "true";
      GF_AUTH_ANONYMOUS_ORG_ROLE = "Admin";
      GF_AUTH_DISABLE_LOGIN_FORM = "true";
      GF_AUTH_BASIC_ENABLED = "false";
      GF_AUTH_DISABLE_SIGNOUT_MENU = "true";
      GF_USERS_ALLOW_SIGN_UP = "false";
      GF_SERVER_ROOT_URL = "https://${instance.host}:${toString (32443 + instance.slot)}/traces/";
      GF_SERVER_SERVE_FROM_SUB_PATH = "true";
    };
    readiness.exec = [
      "/bin/bash"
      "-ec"
      "curl -fsS http://127.0.0.1:3000/traces/api/health >/dev/null && curl -fsS http://127.0.0.1:3200/ready >/dev/null && curl -sS http://127.0.0.1:4318/ >/dev/null"
    ];
    terminationGracePeriod = 30;
  };
}
