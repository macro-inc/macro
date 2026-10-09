{ lib, pkgs, ... }:
{
  services.alloy = {
    enable = true;
    configPath = pkgs.writeText "host.alloy" (import ./host-alloy.nix);
    extraFlags = [
      "--server.http.listen-addr=127.0.0.1:12346"
      "--storage.path=/srv/observability/host-alloy"
      "--disable-reporting"
    ];
  };
  # cAdvisor and Docker log discovery need privileged host access. Keep this
  # collector separate from the unprivileged, externally reachable OTLP receiver.
  systemd.services.alloy = {
    requires = [ "docker.service" ];
    after = [ "docker.service" ];
    partOf = [ "docker.service" ];
    unitConfig.StartLimitIntervalSec = 0;
    serviceConfig = {
      DynamicUser = lib.mkForce false;
      User = "root";
      ExecStartPre = "${pkgs.util-linux}/bin/mountpoint -q /srv/observability";
      RestartSec = lib.mkForce 30;
      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = true;
      PrivateTmp = true;
      ReadWritePaths = [ "/srv/observability/host-alloy" ];
      MemoryMax = "1G";
      # Host collection needs no EC2 credentials.
      IPAddressDeny = [ "169.254.169.254/32" ];
    };
  };

  users.groups.cloudwatch-agent = { };
  users.users.cloudwatch-agent = {
    isSystemUser = true;
    group = "cloudwatch-agent";
  };
  services.amazon-cloudwatch-agent = {
    enable = true;
    user = "cloudwatch-agent";
    mode = "ec2";
    configuration = import ./cloudwatch.nix;
  };
  # Independent of Docker, Alloy, the data mount and the Grafana stack. Missing
  # data-disk samples must reach the alarm's missing-data policy, not a fallback.
  systemd.services.amazon-cloudwatch-agent = {
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    unitConfig.StartLimitIntervalSec = 0;
    serviceConfig = {
      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = true;
      PrivateTmp = true;
      MemoryMax = "512M";
    };
  };
}
