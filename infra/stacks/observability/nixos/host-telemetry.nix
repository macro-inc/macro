{ lib, pkgs, ... }:
{
  services.alloy = {
    enable = true;
    configPath = pkgs.writeText "host.alloy" (builtins.readFile ./host.alloy);
    extraFlags = [
      "--server.http.listen-addr=127.0.0.1:12346"
      "--storage.path=/srv/observability/alloy"
      "--disable-reporting"
    ];
  };
  # Journal access is separate from the externally reachable OTLP receiver.
  users.users.alloy.extraGroups = [ "systemd-journal" ];
  systemd.services.alloy.serviceConfig = {
    DynamicUser = lib.mkForce false;
    User = "alloy";
    Group = "alloy";
    # No private mount namespace: filesystem metrics must describe the host,
    # not sandbox read-only bind mounts. Unix permissions restrict this user.
    StateDirectory = lib.mkForce "";
    WorkingDirectory = lib.mkForce "/srv/observability/alloy";
    MemoryMax = "1G";
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
  # Independent of Alloy, the data mount and the Grafana stack. Missing
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
