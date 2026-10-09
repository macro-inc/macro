{ lib, pkgs, ... }:
let
  runtimePath = with pkgs; [
    awscli2
    bash
    coreutils
    e2fsprogs
    python3
    util-linux
  ];
  prepareHost = pkgs.writeShellScript "observability-prepare-host" ''
    set -euo pipefail
    ${pkgs.python3}/bin/python3 ${./read-user-data.py}
    ${pkgs.bash}/bin/bash ${./mount-data.sh}
  '';
in
{
  imports = [ ./host-telemetry.nix ];

  system.stateVersion = "26.05";
  image.baseName = "macro-observability";
  virtualisation.diskSize = 12 * 1024;
  ec2.efi = true;
  networking.hostName = "observability";
  networking.firewall.allowedTCPPorts = [ 8080 ];
  services.openssh.enable = lib.mkForce false;
  services.amazon-ssm-agent.enable = true;
  # User data is a versioned JSON document, never an executable Nix expression.
  virtualisation.amazon-init.enable = false;
  systemd.services.fetch-ec2-metadata.enable = false;
  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];
  environment.systemPackages = runtimePath ++ [ pkgs.docker-compose ];

  virtualisation.docker.enable = true;
  virtualisation.docker.daemon.settings = {
    live-restore = false;
  };
  # Docker cannot start until the exact retained data volume is mounted. This
  # retries metadata/attachment failures without requiring operator intervention.
  systemd.services.docker = {
    path = runtimePath;
    preStart = lib.mkBefore "${prepareHost}";
    unitConfig.StartLimitIntervalSec = 0;
    serviceConfig = {
      TimeoutStartSec = 900;
      Restart = lib.mkForce "always";
      RestartSec = 30;
    };
  };
  systemd.services.observability = {
    description = "Macro observability pilot";
    wantedBy = [ "multi-user.target" ];
    requires = [ "docker.service" ];
    after = [
      "docker.service"
      "network-online.target"
    ];
    wants = [ "network-online.target" ];
    partOf = [ "docker.service" ];
    path = runtimePath;
    unitConfig.StartLimitIntervalSec = 0;
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      WorkingDirectory = "/opt/observability";
      ExecStartPre = [
        "${pkgs.util-linux}/bin/mountpoint -q /srv/observability"
        "${pkgs.python3}/bin/python3 ${../assets/refresh-secrets.py}"
      ];
      ExecStart = "${pkgs.docker-compose}/bin/docker-compose -f compose.json up -d --remove-orphans --force-recreate";
      ExecStop = "${pkgs.docker-compose}/bin/docker-compose -f compose.json down --timeout 60";
      TimeoutStartSec = 900;
      TimeoutStopSec = 120;
      Restart = "on-failure";
      RestartSec = 30;
    };
  };
  # A dependency failure does not itself retry the dependent unit. Upholds
  # starts the stack once Docker eventually recovers from a boot-time failure.
  systemd.services.docker.unitConfig.Upholds = [
    "observability.service"
    "alloy.service"
  ];

  environment.etc."observability/prepare-volume.sh".source = ../assets/prepare-volume.sh;
  environment.etc."observability/config".source = import ./application-config.nix { inherit pkgs; };
}
