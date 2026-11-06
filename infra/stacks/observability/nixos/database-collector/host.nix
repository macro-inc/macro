{ lib, pkgs, ... }:
{
  system.stateVersion = "26.05";
  image.baseName = "macro-database-collector";
  virtualisation.diskSize = 8 * 1024;
  ec2.efi = true;
  networking.hostName = "database-collector-dev";
  networking.firewall.enable = true;
  services.openssh.enable = lib.mkForce false;
  services.amazon-ssm-agent.enable = true;
  virtualisation.amazon-init.enable = false;
  systemd.services.fetch-ec2-metadata.enable = false;
  systemd.services.print-host-key.enable = false;
  environment.systemPackages = with pkgs; [
    awscli2
    curl
  ];
  environment.etc."ssl/certs/rds-us-east-1.pem".source = pkgs.fetchurl {
    url = "https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem";
    hash = "sha256-sXEdErrlGDhYEoHiO2y5exB0AWhztNr8gO0UACRi3Xc=";
  };
  environment.etc."observability/prepare-volume.sh".source = ../../assets/prepare-volume.sh;
  users.groups.alloy.gid = lib.mkForce 20005;
  users.users.alloy = {
    uid = lib.mkForce 20005;
    isSystemUser = true;
    group = "alloy";
    createHome = lib.mkForce false;
  };
  services.alloy = {
    enable = true;
    configPath = pkgs.writeText "database.alloy" (builtins.readFile ./collector.alloy);
    extraFlags = [
      "--server.http.listen-addr=127.0.0.1:12345"
      "--storage.path=/srv/observability/alloy"
      "--disable-reporting"
    ];
  };
  systemd.services.database-collector-bootstrap = {
    description = "Load database credentials and mount retained metric WAL";
    wantedBy = [ "multi-user.target" ];
    wants = [ "network-online.target" ];
    after = [ "network-online.target" ];
    unitConfig.Upholds = [ "alloy.service" ];
    startLimitIntervalSec = 0;
    path = with pkgs; [
      awscli2
      bash
      coreutils
      e2fsprogs
      util-linux
    ];
    script = ''
      ${pkgs.python3}/bin/python3 ${./bootstrap.py}
      ${pkgs.bash}/bin/bash ${../mount-data.sh}
      install -d -m 0700 -o alloy -g alloy /srv/observability/alloy
    '';
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      Restart = "on-failure";
      RestartMode = "direct";
      RestartSec = 30;
      TimeoutStartSec = 900;
      UMask = "0077";
    };
  };
  systemd.services.alloy = {
    requires = [ "database-collector-bootstrap.service" ];
    after = [ "database-collector-bootstrap.service" ];
    partOf = [ "database-collector-bootstrap.service" ];
    startLimitIntervalSec = 0;
    serviceConfig = {
      DynamicUser = lib.mkForce false;
      User = "alloy";
      Group = "alloy";
      StateDirectory = lib.mkForce "";
      WorkingDirectory = lib.mkForce "/srv/observability/alloy";
      LoadCredential = map (name: "${name}:/run/macro-database-collector/${name}") [
        "writer_dsn"
        "replica_dsn"
        "otlp_token"
      ];
      ExecStartPre = "${pkgs.util-linux}/bin/mountpoint -q /srv/observability";
      Restart = lib.mkForce "always";
      RestartMode = "direct";
      RestartSec = lib.mkForce 30;
      MemoryMax = "768M";
      NoNewPrivileges = true;
      ProtectSystem = "strict";
      ProtectHome = true;
      PrivateTmp = true;
      ReadWritePaths = [ "/srv/observability/alloy" ];
      IPAddressDeny = [ "169.254.169.254/32" ];
      UMask = lib.mkForce "0077";
    };
  };
}
