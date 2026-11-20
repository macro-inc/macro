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
  services = [
    "alloy"
    "nginx"
    "postgresql"
    "goalert"
    "macro-alerts-relay"
  ];
  secretConsumers = [
    "alloy.service"
    "goalert.service"
    "macro-alerts-relay.service"
  ];
  # Grafana (20001), Loki (20002), Tempo (20003), Prometheus (20004) and OTLP
  # ingress (20006) moved to the observability cluster. Their directories stay
  # on the volume under those ids, so an image that runs them again finds its
  # data: never give those ids to anything else.
  dataUsers = {
    alloy = 20005;
    postgres = 20007;
    goalert = 20008;
  };
in
{
  imports = [
    ./goalert.nix
    ./host-telemetry.nix
    ./proxy.nix
  ];
  system.stateVersion = "26.05";
  image.baseName = "macro-observability";
  virtualisation.diskSize = 12 * 1024;
  ec2.efi = true;
  networking.hostName = "observability";
  networking.firewall.allowedTCPPorts = [ 8080 ];
  services.openssh.enable = lib.mkForce false;
  services.amazon-ssm-agent.enable = true;
  # EC2 user data contains validated JSON settings, never executable Nix.
  virtualisation.amazon-init.enable = false;
  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];
  environment.systemPackages = runtimePath;

  # Stable identities preserve ownership when a replacement AMI reuses EBS.
  users.users = lib.mapAttrs (name: uid: {
    uid = lib.mkForce uid;
    isSystemUser = true;
    group = name;
    createHome = lib.mkForce false;
  }) dataUsers;
  users.groups = lib.mapAttrs (_: gid: { gid = lib.mkForce gid; }) dataUsers;

  systemd.services =
    lib.genAttrs services (name: {
      requires = [ "observability-bootstrap.service" ];
      after = [ "observability-bootstrap.service" ];
      partOf = [ "observability-bootstrap.service" ];
      startLimitIntervalSec = lib.mkForce 0;
      serviceConfig = {
        ExecStartPre = lib.mkBefore [ "${pkgs.util-linux}/bin/mountpoint -q /srv/observability" ];
        Restart = lib.mkForce "always";
        RestartSec = lib.mkForce 30;
        # Stay activating during automatic restarts so Upholds cannot bypass
        # the backoff by starting a briefly failed/inactive unit.
        RestartMode = "direct";
        NoNewPrivileges = true;
        ProtectSystem = lib.mkForce (if name == "alloy" then false else "strict");
        ProtectHome = name != "alloy";
        PrivateTmp = name != "alloy";
        UMask = lib.mkForce "0077";
        TimeoutStopSec = 90;
        # None of these needs the instance role. The GoAlert backup does and
        # runs as its own unit (`goalert.nix`).
        IPAddressDeny = [ "169.254.169.254/32" ];
      };
    })
    // {
      fetch-ec2-metadata.enable = false;
      print-host-key.enable = false;
      observability-bootstrap = {
        description = "Validate EC2 settings and mount retained observability storage";
        wantedBy = [ "multi-user.target" ];
        wants = [ "network-online.target" ];
        after = [ "network-online.target" ];
        path = runtimePath;
        startLimitIntervalSec = 0;
        # Only the secret service upholds its consumers. Starting them here would
        # repeatedly pull a failed secret service out of its restart backoff.
        unitConfig.Upholds = [
          "observability-secrets.service"
        ]
        ++ lib.subtractLists secretConsumers (map (name: "${name}.service") services);
        script = ''
          ${pkgs.python3}/bin/python3 ${./read-user-data.py}
          ${pkgs.bash}/bin/bash ${./mount-data.sh}
          ${lib.concatMapStringsSep "\n" (
            name: "install -d -m 0700 -o ${name} -g ${name} /srv/observability/${name}"
          ) (builtins.attrNames dataUsers)}
        '';
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          Restart = "on-failure";
          RestartMode = "direct";
          RestartSec = 30;
          TimeoutStartSec = 900;
        };
      };
      observability-secrets = {
        description = "Fetch runtime credentials for GoAlert, its relay and host telemetry";
        requires = [ "observability-bootstrap.service" ];
        after = [ "observability-bootstrap.service" ];
        partOf = [ "observability-bootstrap.service" ];
        path = [ pkgs.awscli2 ];
        startLimitIntervalSec = 0;
        unitConfig.Upholds = secretConsumers;
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          ExecStart = "${pkgs.python3}/bin/python3 ${../assets/refresh-secrets.py}";
          Restart = "on-failure";
          RestartMode = "direct";
          RestartSec = 30;
          TimeoutStartSec = 120;
          UMask = lib.mkForce "0077";
        };
      };
    };
  environment.etc."observability/prepare-volume.sh".source = ../assets/prepare-volume.sh;
}
