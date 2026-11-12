# Google Compute Engine guest: guest agent, OS Login, DHCP, metadata, serial console.
# The pieces of nixpkgs' google-compute-config.nix we want, without its
# filesystem and bootloader settings, which disko owns here.
{
  config,
  lib,
  modulesPath,
  pkgs,
  ...
}:
{
  imports = [
    "${modulesPath}/profiles/qemu-guest.nix"
    "${modulesPath}/profiles/headless.nix"
  ];

  boot.kernelParams = [ "console=ttyS0,115200" ];
  boot.initrd.availableKernelModules = [
    "virtio_scsi"
    "virtio_pci"
    "virtio_net"
    "gve"
  ];
  boot.loader.timeout = lib.mkDefault 1;

  # Serial console login is the recovery path when IAP SSH is broken.
  systemd.services."serial-getty@ttyS0".enable = true;

  services.openssh = {
    enable = true;
    settings = {
      PermitRootLogin = "prohibit-password";
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
    };
  };
  users.users.root.openssh.authorizedKeys.keyFiles = [ ./keys/admin.pub ];

  # `gcloud compute ssh --tunnel-through-iap` logs in as the OS Login user.
  security.googleOsLogin.enable = true;
  # pam_oslogin_login's account check denies every non-OS-Login user, so
  # root's key login (nixos-rebuild) would fail. Skip it for uid 0.
  security.pam.services.sshd.rules.account.local-root = {
    order = config.security.pam.services.sshd.rules.account.oslogin_login.order - 1;
    control = "[success=1 default=ignore]";
    modulePath = "${config.security.pam.package}/lib/security/pam_succeed_if.so";
    args = [
      "uid"
      "eq"
      "0"
      "quiet"
    ];
  };

  services.udev.packages = [ pkgs.google-guest-configs ];
  services.udev.path = [ pkgs.google-guest-configs ];

  # GCE assigns the internal address over DHCP (a /32 with a gateway route).
  networking.usePredictableInterfaceNames = false;
  networking.interfaces.eth0.mtu = 1460;
  # Keep eth0's lease when dhcpcd restarts, so a switch does not drop IAP SSH.
  networking.dhcpcd.persistent = true;
  networking.hosts."169.254.169.254" = [
    "metadata.google.internal"
    "metadata"
  ];
  networking.timeServers = [ "metadata.google.internal" ];

  systemd.packages = [ pkgs.google-guest-agent ];
  systemd.services.google-guest-agent = {
    wantedBy = [ "multi-user.target" ];
    restartTriggers = [ config.environment.etc."default/instance_configs.cfg".source ];
    path = lib.optional config.users.mutableUsers pkgs.shadow;
  };
  systemd.services.google-startup-scripts.wantedBy = [ "multi-user.target" ];
  systemd.services.google-shutdown-scripts.wantedBy = [ "multi-user.target" ];

  security.sudo.extraRules = [
    {
      groups = [ "google-sudoers" ];
      commands = [
        {
          command = "ALL";
          options = [ "NOPASSWD" ];
        }
      ];
    }
  ];
  users.groups.google-sudoers = { };

  environment.etc."modprobe.d/gce-blacklist.conf".source =
    "${pkgs.google-guest-configs}/etc/modprobe.d/gce-blacklist.conf";
  environment.etc."sysctl.d/60-gce-network-security.conf".source =
    "${pkgs.google-guest-configs}/etc/sysctl.d/60-gce-network-security.conf";
  environment.etc."default/instance_configs.cfg".text = ''
    [Accounts]
    useradd_cmd = useradd -m -s /run/current-system/sw/bin/bash -p * {user}

    [Daemons]
    accounts_daemon = ${lib.boolToString config.users.mutableUsers}

    [InstanceSetup]
    set_host_keys = false

    [MetadataScripts]
    default_shell = ${pkgs.stdenv.shell}

    [NetworkInterfaces]
    dhclient_script = ${pkgs.google-guest-configs}/bin/google-dhclient-script
    setup = false
  '';
}
