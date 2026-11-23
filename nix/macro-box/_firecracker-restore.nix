# A Firecracker computer's restore: what the golden snapshot leaves stopped
# (everything that needs /home), and `macro-restore`, which takes the
# computer's identity from MMDS, mounts /home and starts it. Separate from
# `_firecracker.nix` (kernel and disks) so the NixOS test runs it in QEMU.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.macro.box;
  # The customer's volume: the second drive.
  homeDevice = "/dev/vdb";
  # macro-restore writes it once /home's filesystem is there; home.mount
  # asserts it, so nothing mounts the golden snapshot's placeholder.
  homeReady = "/run/macro/home-ready";
in
{
  config = {
    macro.box.enrollFrom = "mmds";
    macro.box.dataDisk = homeDevice;
    # Not the guest's boot-time mount: macro-restore starts it.
    fileSystems."/home" = lib.mkForce {
      device = homeDevice;
      fsType = "ext4";
      options = [ "noauto" ];
      # No fsck on the way to macrod: ext4's journal recovers at mount.
      noCheck = true;
    };

    # One NIC. The link-local address reaches MMDS (169.254.169.254) in the
    # golden boot; macro-restore adds the computer's own address from MMDS.
    systemd.network.wait-online.enable = false;
    systemd.network.networks."10-eth0" = {
      matchConfig.Name = "eth0";
      address = [ "169.254.0.2/16" ];
      # Static addresses only (macro-restore adds the computer's in a
      # drop-in): no DHCP and no router advertisements, so no lease or DUID.
      networkConfig = {
        LinkLocalAddressing = "no";
        IPv6AcceptRA = false;
      };
      linkConfig.RequiredForOnline = "no";
    };

    # What needs /home waits for it: macro-home.target, which macro-restore
    # starts once /home is mounted. macro-home-setup goes first.
    systemd.targets.macro-home = {
      description = "This computer's /home is mounted";
      requires = [ "home.mount" ];
      after = [ "home.mount" ];
    };
    # What activation and tmpfiles made at boot on the root disk's /home,
    # made again on the volume; then macro's lingering, which starts the
    # display, window manager and browser.
    systemd.services.macro-home-setup = {
      description = "Set up macro's home on this computer's volume";
      wantedBy = [ "macro-home.target" ];
      before = [
        "macrod-enroll.service"
        "macrod.service"
        "harnessd.service"
      ];
      unitConfig.RequiresMountsFor = "/home";
      path = [
        pkgs.coreutils
        config.systemd.package
      ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
      };
      script = ''
        install -d -m 0700 -o macro -g macro /home/macro
        systemd-tmpfiles --create --prefix=/home
        loginctl enable-linger macro
      '';
    };
    systemd.services.macrod-enroll = {
      wantedBy = lib.mkForce [ "macro-home.target" ];
      requires = [ "macro-home-setup.service" ];
      unitConfig.RequiresMountsFor = "/home";
    };
    systemd.services.macrod = {
      wantedBy = lib.mkForce [ "macro-home.target" ];
      unitConfig.RequiresMountsFor = "/home";
    };
    systemd.services.harnessd = {
      wantedBy = lib.mkForce [ "macro-home.target" ];
      requires = [ "macro-home-setup.service" ];
      unitConfig.RequiresMountsFor = "/home";
    };
    # Started by its socket on first use, and never before /home.
    virtualisation.docker.enableOnBoot = false;
    systemd.services.docker = {
      requisite = [ "home.mount" ];
      after = [ "home.mount" ];
    };
    # macro-home-setup enables lingering once macro's home exists.
    users.users.macro.linger = lib.mkForce null;

    systemd.services.macro-restore = {
      description = "Take this computer's identity from MMDS and mount /home";
      # Every boot, for a computer started from its own disk; after a
      # restore the host starts it through its guest agent (the 6.18 vmgenid
      # driver reseeds the RNG but sends no uevent, so the guest cannot see a
      # restore by itself). Without a restore document in MMDS (the golden
      # boot) it changes nothing.
      wantedBy = [ "multi-user.target" ];
      after = [ "systemd-networkd.service" ];
      path = [
        pkgs.coreutils
        pkgs.curl
        pkgs.jq
        pkgs.iproute2
        pkgs.util-linux
        pkgs.acl
        config.systemd.package
      ];
      environment = {
        MACRO_HOME_DEVICE = homeDevice;
        MACRO_HOME_READY = homeReady;
      };
      serviceConfig = {
        Type = "oneshot";
        # A safety net: the host's start already reports the failure, with
        # the failing command in the journal.
        Restart = "on-failure";
        RestartSec = "50ms";
        ExecStart = pkgs.writeShellScript "macro-restore" (builtins.readFile ./files/macro-restore);
        StandardOutput = "journal+console";
        StandardError = "journal+console";
      };
    };
    systemd.units."home.mount" = {
      overrideStrategy = "asDropin";
      text = ''
        [Unit]
        AssertPathExists=${homeReady}
      '';
    };
    # A restore resumes the golden's clocks advanced by the golden's age
    # (kvm-clock with the host's clock_realtime), so every watchdog whose last
    # ping predates the snapshot fires at once and kills its daemon (seen on
    # every restore from a golden older than 3 min, and on every wake after a
    # longer hibernation). No systemd watchdogs in a Firecracker computer.
    systemd.services.systemd-homed.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-hostnamed.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-importd.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-journald.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-localed.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-logind.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-machined.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-mountfsd.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-networkd.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-nsresourced.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-oomd.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-portabled.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-resolved.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-sysupdated.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-timedated.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-timesyncd.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-udevd.serviceConfig.WatchdogSec = 0;
    systemd.services.systemd-userdbd.serviceConfig.WatchdogSec = 0;

    # What a restore can leave for after macro-restore has answered the host:
    # networkd reads the identity's drop-in (the address is already set), and
    # for a new identity journald moves to the new machine id and the saved
    # random seed is refreshed; timesyncd resynchronizes the stepped clock.
    systemd.services.macro-restore-settle = {
      description = "Let networkd, journald and timesyncd catch up with a restore";
      path = [
        pkgs.coreutils
        config.systemd.package
      ];
      serviceConfig.Type = "oneshot";
      script = ''
        networkctl reload
        if [ -e /run/macro-restore/new-identity ]; then
          # journald files the journal under the machine id: move the golden's
          # (and this restore's) to the new id, so journalctl keeps showing it.
          read -r old < /run/macro-restore/new-identity
          read -r new < /etc/machine-id
          # Its active files are archived first, so journald starts new ones
          # with their own sequence-number id instead of every computer
          # continuing the golden's.
          systemctl stop systemd-journald.service
          for journal in /var/log/journal /run/log/journal; do
            if [ -d "$journal/$old" ] && [ ! -e "$journal/$new" ]; then
              mv "$journal/$old" "$journal/$new"
            fi
            for active in "$journal/$new"/*.journal; do
              if [ -e "$active" ]; then
                mv "$active" "''${active%.journal}@golden.journal~"
              fi
            done
          done
          # journald also keeps its sequence-number id in a state file in
          # /run, which comes from the golden's memory.
          rm -f /run/systemd/journal/seqnum
          systemctl start systemd-journald.service
          systemctl restart systemd-random-seed.service
          rm /run/macro-restore/new-identity
        fi
        # Without egress its restart can wait a long time.
        systemctl --no-block restart systemd-timesyncd.service
      '';
    };

    # MMDS holds the enrollment until macrod claims it: only root reaches it.
    # Containers' traffic is forwarded, not sent, so drop it on the way in.
    networking.firewall.extraCommands = ''
      iptables -w -C OUTPUT -d 169.254.169.254 -m owner ! --uid-owner 0 -j REJECT 2>/dev/null \
        || iptables -w -I OUTPUT -d 169.254.169.254 -m owner ! --uid-owner 0 -j REJECT
      iptables -w -t raw -C PREROUTING ! -i lo -d 169.254.169.254 -j DROP 2>/dev/null \
        || iptables -w -t raw -I PREROUTING ! -i lo -d 169.254.169.254 -j DROP
    '';
    networking.firewall.extraStopCommands = ''
      iptables -w -D OUTPUT -d 169.254.169.254 -m owner ! --uid-owner 0 -j REJECT 2>/dev/null || true
      iptables -w -t raw -D PREROUTING ! -i lo -d 169.254.169.254 -j DROP 2>/dev/null || true
    '';

    # The host grows a drive by patching it to a larger file, at a restore or
    # later; the kernel announces the new size with RESIZE=1.
    services.udev.extraRules = ''
      ACTION=="change", SUBSYSTEM=="block", KERNEL=="vd[a-z]", ENV{RESIZE}=="1", RUN+="${lib.getExe' config.systemd.package "systemctl"} --no-block start macro-grow@%k.service"
    '';
    # Grow a mounted filesystem to its drive, online through its mount point
    # (systemd-growfs, the resize ioctl). resize2fs on the device fails on the
    # kernel-mounted root, which /proc/mounts names /dev/root.
    systemd.services."macro-grow@" = {
      description = "Grow the filesystem on /dev/%I to its drive";
      path = [ pkgs.util-linux ];
      serviceConfig.Type = "oneshot";
      script = ''
        mountpoint=$(lsblk --noheadings --output MOUNTPOINTS "/dev/$1" | head -n 1)
        if [ -n "$mountpoint" ]; then
          ${config.systemd.package}/lib/systemd/systemd-growfs "$mountpoint"
        fi
      '';
      scriptArgs = "%i";
    };

    # One image for a person's computer and an agent teammate's: the agent's
    # units are in the image (agentMode: macro has no sudo or docker group
    # in /etc), and macro-restore decides from MMDS's identity.role. A
    # person's computer gets sudo from /run/sudoers.d and Docker from an ACL
    # on its socket; an agent's computer starts macro-agent.target.
    macro.box.agentMode = true;
    security.sudo.extraConfig = ''
      @includedir /run/sudoers.d
    '';
    systemd.targets.macro-agent = {
      description = "This computer runs an agent teammate";
      requires = [ "macro-home.target" ];
      after = [ "macro-home.target" ];
    };
    # The agent's units sandbox /home/macro/agent, which macro-home-setup
    # makes on the computer's volume: before it they fail to start (seen as
    # a failed macro-agent-browser, whose start job doesn't retry).
    systemd.paths.macro-agent.wantedBy = lib.mkForce [ "macro-agent.target" ];
    systemd.services.macro-agent = {
      wantedBy = lib.mkForce [ "macro-agent.target" ];
      requires = [ "macro-home-setup.service" ];
      after = [ "macro-home-setup.service" ];
    };
    systemd.services.macro-agent-display = {
      wantedBy = lib.mkForce [ "macro-agent.target" ];
      requires = [ "macro-home-setup.service" ];
      after = [ "macro-home-setup.service" ];
    };
    systemd.services.macro-agent-openbox = {
      wantedBy = lib.mkForce [ "macro-agent.target" ];
      requires = [ "macro-home-setup.service" ];
      after = [ "macro-home-setup.service" ];
    };
    systemd.services.macro-agent-bus = {
      wantedBy = lib.mkForce [ "macro-agent.target" ];
      requires = [ "macro-home-setup.service" ];
      after = [ "macro-home-setup.service" ];
    };
    systemd.services.macro-agent-sound = {
      wantedBy = lib.mkForce [ "macro-agent.target" ];
      requires = [ "macro-home-setup.service" ];
      after = [ "macro-home-setup.service" ];
    };
    systemd.services.macro-agent-browser = {
      wantedBy = lib.mkForce [ "macro-agent.target" ];
      requires = [ "macro-home-setup.service" ];
      after = [ "macro-home-setup.service" ];
    };
    # Only an agent's screen is watched: a person's computer doesn't listen.
    systemd.sockets.macro-agent-screen-encoder.wantedBy = lib.mkForce [ "macro-agent.target" ];

    # The agent's environment arrives over macrod's socket (ApplyAgent): macrod,
    # as macro, stages it in /run/macro-agent-inbox, which macro-restore makes
    # only on an agent's computer (macrod refuses ApplyAgent without it); this
    # root unit installs it where macro-agent reads it, checking the role
    # again.
    systemd.paths.macro-agent-apply = {
      description = "Watch for an agent environment from macrod";
      wantedBy = [ "macro-agent.target" ];
      pathConfig.PathChanged = "/run/macro-agent-inbox/agent.env";
    };
    systemd.services.macro-agent-apply = {
      description = "Install the agent environment macrod received";
      path = [
        pkgs.coreutils
        pkgs.util-linux
      ];
      serviceConfig = {
        Type = "oneshot";
        UMask = "0077";
      };
      # The inbox is macro's, so root never opens anything in it: macro reads
      # it (a symlink to a root-only file fails there) and empties it, and
      # root only writes what macro handed over, capped at 64 KiB.
      script = ''
        inbox=/run/macro-agent-inbox/agent.env
        as_macro() { setpriv --reuid=macro --regid=macro --clear-groups "$@"; }
        if ! as_macro test -s "$inbox"; then
          exit 0
        fi
        role=$(cat /run/macro/role 2> /dev/null || true)
        if [ "$role" != agent ]; then
          echo "macro-agent-apply: refusing an agent environment on a $role computer" >&2
          as_macro truncate --size=0 "$inbox"
          exit 1
        fi
        if ! as_macro head --bytes=65536 "$inbox" > /var/lib/macrod/agent.env.new; then
          rm -f /var/lib/macrod/agent.env.new
          echo "macro-agent-apply: macro cannot read its inbox's agent.env" >&2
          exit 1
        fi
        # The setup trace macrod staged beside it (not a secret): installed
        # root-owned and read-only for start-agent, capped like a traceparent,
        # and only the first, so a redelivery's fresh one changes nothing.
        # Nothing here fails the environment's install: the trace is only
        # telemetry. One that can't be installed stays in the inbox for the
        # next delivery.
        trace_inbox=/run/macro-agent-inbox/setup-traceparent
        trace=/run/macrod/agent-traceparent
        if as_macro test -s "$trace_inbox"; then
          if [ -e "$trace" ] || {
            install -d -m 0755 /run/macrod &&
              as_macro head --bytes=128 "$trace_inbox" > "$trace.new" &&
              chmod 0644 "$trace.new" &&
              mv "$trace.new" "$trace"
          }; then
            as_macro truncate --size=0 "$trace_inbox" || true
          else
            rm -f "$trace.new" || true
            echo "macro-agent-apply: could not install the setup trace" >&2
          fi
        fi
        chown macro:macro /var/lib/macrod/agent.env.new
        mv /var/lib/macrod/agent.env.new /var/lib/macrod/agent.env
        as_macro truncate --size=0 "$inbox"
      '';
    };

    # Restored computers start what the golden boot left stopped; read their
    # files now so the snapshot holds them in the page cache.
    systemd.services.macro-prewarm = {
      description = "Read the computer's programs into the page cache";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        Nice = 19;
        IOSchedulingClass = "idle";
      };
      script = ''
        ${lib.getExe' pkgs.findutils "find"} -L \
          ${cfg.macrod} ${cfg.harnessd.package} ${cfg.claudeCode} ${cfg.claudeAgentAcp} ${cfg.chromeDevtoolsMcp} \
          ${pkgs.nodejs_24} ${pkgs.chromium} ${pkgs.tigervnc} ${pkgs.openbox} ${pkgs.docker} \
          -type f -exec cat {} + > /dev/null
      '';
    };

  };
}
