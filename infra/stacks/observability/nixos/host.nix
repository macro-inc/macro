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
    "grafana"
    "loki"
    "tempo"
    "prometheus"
    "alloy"
    "alloy-ingest"
    "nginx"
  ];
  secretConsumers = [
    "grafana.service"
    "alloy-ingest.service"
  ];
  dataUsers = {
    grafana = 20001;
    loki = 20002;
    tempo = 20003;
    prometheus = 20004;
    alloy = 20005;
    alloy-ingest = 20006;
  };
in
{
  imports = [
    ./services.nix
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
        # Grafana uses the role for CloudWatch reads and SNS notifications.
        IPAddressDeny = lib.optionals (
          !builtins.elem name [
            "loki"
            "tempo"
            "grafana"
          ]
        ) [ "169.254.169.254/32" ];
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
        description = "Fetch runtime credentials for Grafana and OTLP ingress";
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
