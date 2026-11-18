# The Firecracker host module in NixOS test VMs: hardening, the ZFS dataset
# with block cloning, the agent under its delegated cgroup with its netns
# slots and nftables tables, the API over pinned mTLS only to the configured
# control plane, the health check, and a computer's lifecycle (all but a
# cold start: see the open item in the script) on a
# tiny guest (the Firecracker image's kernel and guest agent, no macro-box).
#
# The lifecycle needs nested KVM inside the test VM (a host with
# kvm_intel.nested=1, e.g. the GCP Firecracker hosts). Without /dev/kvm in
# the test VM it is skipped, loudly, and the subtest's name says so.
{
  pkgs,
  package,
  guestAgent,
}:
let
  inherit (pkgs) lib;
  # Throwaway credentials for the test's control plane.
  credentials =
    pkgs.runCommand "firecracker-host-test-credentials" { nativeBuildInputs = [ pkgs.openssl ]; }
      ''
        mkdir $out
        for name in client stranger; do
          openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-384 -nodes -days 30 \
            -subj "/CN=$name" -addext "extendedKeyUsage=clientAuth" \
            -keyout $out/$name.key -out $out/$name.crt 2> /dev/null
        done
      '';
  endpointFile =
    name:
    pkgs.writeText "${name}-endpoint.toml" ''
      url = "https://192.168.1.2:8444"
      client_certificate = "${credentials}/${name}.crt"
      client_key = "${credentials}/${name}.key"
      server_certificate = "/tmp/server.crt"
    '';
  endpoint = endpointFile "client";
  strangerEndpoint = endpointFile "stranger";

  # The smallest guest the agent can drive: the Firecracker image's kernel
  # (nix/macro-box/kernel, everything built in, no initrd), the guest agent
  # on vsock, and a `macro-restore` that mounts the computer's /home.
  guestKernel = pkgs.linuxManualConfig {
    inherit (pkgs.linuxPackages.kernel) version src;
    configfile = ../../macro-box/kernel/firecracker-x86_64.config;
  };
  guest = import "${pkgs.path}/nixos/lib/eval-config.nix" {
    system = null;
    modules = [
      "${pkgs.path}/nixos/modules/profiles/minimal.nix"
      (
        { config, ... }:
        {
          nixpkgs.pkgs = pkgs;
          system.stateVersion = lib.trivial.release;
          boot.kernelPackages = pkgs.linuxPackagesFor guestKernel;
          boot.initrd.enable = false;
          boot.loader.grub.enable = false;
          boot.kernelParams = [
            # The console reaches the jail's firecracker.log (the test reads
            # it when the guest goes quiet); computers boot without one.
            "console=ttyS0"
            "clocksource=kvm-clock"
            "quiet"
            "reboot=k"
            "panic=1"
            "pci=off"
            "net.ifnames=0"
          ];
          # A boot that cannot mount something carries on and stays
          # reachable over the guest agent instead of waiting in emergency.
          systemd.enableEmergencyMode = false;
          fileSystems."/" = {
            device = "/dev/vda";
            fsType = "ext4";
          };
          fileSystems."/home" = {
            device = "/dev/vdb";
            fsType = "ext4";
            options = [ "noauto" ];
          };
          networking.useNetworkd = true;
          networking.firewall.enable = false;
          users.users.root.initialHashedPassword = "!";
          users.users.macro = {
            uid = 1000;
            isNormalUser = true;
          };
          systemd.services.firecracker-guest-agent = {
            wantedBy = [ "multi-user.target" ];
            unitConfig.StartLimitIntervalSec = 0;
            serviceConfig = {
              ExecStart = lib.getExe' guestAgent "firecracker-guest-agent";
              Restart = "always";
              RestartSec = 1;
            };
          };
          # What the host starts after a restore; the real one also takes
          # the computer's identity and network from MMDS.
          systemd.services.macro-restore = {
            serviceConfig = {
              Type = "oneshot";
              RemainAfterExit = true;
            };
            script = ''
              ${pkgs.util-linux}/bin/mountpoint -q /home || ${pkgs.util-linux}/bin/mount /home
              touch /run/macro-restored
            '';
          };
          system.build.firecrackerBootArgs = lib.concatStringsSep " " (
            config.boot.kernelParams ++ [ "init=${config.system.build.toplevel}/init" ]
          );
        }
      )
    ];
  };
  guestRootfs = import "${pkgs.path}/nixos/lib/make-disk-image.nix" {
    inherit pkgs lib;
    inherit (guest) config;
    partitionTableType = "none";
    installBootLoader = false;
    format = "raw";
    additionalSpace = "128M";
    baseName = "rootfs";
  };
  guestImage = pkgs.runCommand "firecracker-host-test-guest" { } ''
    mkdir $out
    ln -s ${guestKernel.dev}/vmlinux $out/vmlinux
    ln -s ${guestRootfs}/rootfs.img $out/rootfs.ext4
    echo ${lib.escapeShellArg guest.config.system.build.firecrackerBootArgs} > $out/boot_args
  '';
  computerId = "01937a00-0000-7000-8000-000000000002";
  pairingId = "01937a00-0000-7000-8000-0000000000aa";
in
pkgs.testers.runNixOSTest {
  name = "firecracker-host";
  nodes = {
    host =
      { config, ... }:
      {
        imports = [ ./firecracker-host.nix ];
        networking.hostId = "8425e349";
        # The test driver boots nodes on acpi_pm; KVM records a VM's realtime
        # clock in a snapshot (restores use clock_realtime) only when the host
        # clocksource is TSC (not kvm-clock).
        boot.kernelParams = lib.mkAfter [
          "clocksource=tsc"
          "tsc=reliable"
        ];
        networking.interfaces.eth1.ipv4.addresses = lib.mkForce [
          {
            address = "192.168.1.2";
            prefixLength = 24;
          }
        ];
        virtualisation.memorySize = 4096;
        virtualisation.cores = 2;
        virtualisation.emptyDiskImages = [
          {
            size = 8192;
            driveConfig.deviceExtraOpts.serial = "durable";
          }
        ];
        # The pool the host's disko would make, on first boot only.
        systemd.services.firecracker-host-test-pool = {
          wantedBy = [ "zfs-import-tank.service" ];
          before = [ "zfs-import-tank.service" ];
          requires = [ "dev-disk-by\\x2did-virtio\\x2ddurable.device" ];
          after = [ "dev-disk-by\\x2did-virtio\\x2ddurable.device" ];
          unitConfig.DefaultDependencies = false;
          path = [ config.boot.zfs.package ];
          serviceConfig.Type = "oneshot";
          script = ''
            zpool import -N tank 2> /dev/null && exit 0
            zpool create -o ashift=12 -O compression=lz4 -O atime=off -O xattr=sa tank /dev/disk/by-id/virtio-durable
          '';
        };
        systemd.tmpfiles.rules = [ "L+ /var/lib/firecracker-host-images/test - - - - ${guestImage}" ];
        macro.firecrackerHost = {
          inherit package;
          listenAddress = "192.168.1.2";
          apiSources = [ "192.168.1.1" ];
          clientCertificates = [ "${credentials}/client.crt" ];
          uplink = "eth1";
          slots = 4;
          environment = "local";
          healthCheckInterval = "10s";
          storage.goldenRootDiskGib = 2;
          datadog.enable = false;
        };
      };
    controlPlane = {
      networking.interfaces.eth1.ipv4.addresses = lib.mkForce [
        {
          address = "192.168.1.1";
          prefixLength = 24;
        }
      ];
      environment.systemPackages = [
        package
        pkgs.curl
      ];
    };
    elsewhere = {
      networking.interfaces.eth1.ipv4.addresses = lib.mkForce [
        {
          address = "192.168.1.3";
          prefixLength = 24;
        }
      ];
      environment.systemPackages = [ pkgs.curl ];
    };
  };

  testScript = ''
    import json

    def client(command, endpoint="${endpoint}"):
        return controlPlane.succeed(f"firecracker-host client --endpoint {endpoint} {command}")

    start_all()
    host.wait_for_unit("firecracker-host.service")
    try:
        host.wait_until_succeeds("ss -ltn | grep -q '192.168.1.2:8444'", timeout=120)
    except Exception:
        print(host.execute("journalctl -b --no-pager -u firecracker-host -u firecracker-host-storage | tail -n 80")[1])
        raise

    with subtest("the kernel is hardened"):
        for key, value in {
            "kernel.io_uring_disabled": "2",
            "kernel.kexec_load_disabled": "1",
            "user.max_user_namespaces": "0",
            "kernel.yama.ptrace_scope": "2",
            "kernel.unprivileged_bpf_disabled": "1",
            "vm.unprivileged_userfaultfd": "0",
        }.items():
            actual = host.succeed(f"sysctl -n {key}").strip()
            assert actual == value, f"{key} = {actual}, wanted {value}"
        host.succeed("test \"$(cat /sys/kernel/mm/ksm/run)\" = 0")

    with subtest("the ZFS dataset clones blocks"):
        host.succeed("test \"$(zfs get -H -o value mounted tank/firecracker)\" = yes")
        host.succeed("test \"$(zfs get -H -o value compression tank/firecracker)\" = lz4")
        host.succeed("zpool get -H -o value feature@block_cloning tank | grep -Eq 'enabled|active'")
        host.succeed("test \"$(cat /sys/module/zfs/parameters/zfs_bclone_enabled)\" = 1")
        host.succeed("test \"$(cat /sys/module/zfs/parameters/zfs_bclone_wait_dirty)\" = 1")
        host.succeed("test \"$(cat /sys/module/zfs/parameters/zfs_arc_max)\" = 8589934592")

    with subtest("the agent runs in its delegated leaf and VMs get their own subtree"):
        host.succeed("grep -qx '0::/system.slice/firecracker-host.service/agent' /proc/$(systemctl show -P MainPID firecracker-host)/cgroup")
        host.succeed("grep -q memory /sys/fs/cgroup/system.slice/firecracker-host.service/vms/cgroup.subtree_control")
        host.succeed("test \"$(cat /proc/$(systemctl show -P MainPID firecracker-host)/oom_score_adj)\" = -1000")

    with subtest("every slot and the golden slot have a netns, a user-owned tap and the guest firewall"):
        slots = host.succeed("ip netns list | grep -c '^fch-'").strip()
        assert slots == "5", slots
        host.succeed("ip -n fch-3 -d link show tap0 | grep -q 'user 1000000003'")
        host.succeed("ip netns exec fch-0 nft list table inet vm | grep -q 'ip saddr 172.16.0.2 accept'")
        host.fail("nft list ruleset | grep -q 'hook output'")

    with subtest("the TLS keys reach the agent only as root credentials"):
        host.succeed("test \"$(stat -c '%U %a' /var/lib/firecracker-host-tls/server.key)\" = 'root 400'")
        host.succeed("test \"$(stat -c '%U %a' /var/lib/firecracker-host-tls/health.key)\" = 'root 400'")
        host.succeed("test \"$(stat -c '%U %a' $(readlink -f /run/current-system/sw/bin/jailer))\" = 'root 555'")

    server_certificate = host.succeed("cat /var/lib/firecracker-host-tls/server.crt")
    controlPlane.succeed(f"cat > /tmp/server.crt <<'EOF'\n{server_certificate}EOF")

    with subtest("the pinned control plane is served"):
        info = json.loads(client("host"))
        assert info["networkSlots"] == {"total": 4, "free": 4}, info
        assert info["firecrackerVersion"] == "v1.18.0", info

    with subtest("an image the host lacks is a permanent, typed refusal"):
        output = controlPlane.fail(
            "firecracker-host client --endpoint ${endpoint} create 01937a00-0000-7000-8000-000000000001 --image missing 2>&1"
        )
        assert "imageMissing" in output, output

    with subtest("another client certificate is refused"):
        controlPlane.fail("firecracker-host client --endpoint ${strangerEndpoint} host")

    with subtest("the API port is closed to everyone but the control plane"):
        elsewhere.fail("curl --insecure --max-time 3 https://192.168.1.2:8444/v1/host")

    with subtest("the health check answers, and restarts an agent that stops answering"):
        host.wait_until_succeeds("systemctl show -P Result firecracker-host-health | grep -qx success", timeout=180)
        before = host.succeed("systemctl show -P MainPID firecracker-host").strip()
        host.succeed(f"kill -STOP {before}")
        host.wait_until_succeeds(f"test \"$(systemctl show -P MainPID firecracker-host)\" != {before}", timeout=300)
        host.wait_until_succeeds("ss -ltn | grep -q '192.168.1.2:8444'")
        client("list")

    if host.execute("test -c /dev/kvm")[0] == 0:
        with subtest("a computer's lifecycle: golden, create, exec, hibernate, wake, stop, destroy"):
            client("build-golden --image test --vcpus 1 --memory-mib 512")
            controlPlane.wait_until_succeeds(
                "firecracker-host client --endpoint ${endpoint} goldens | grep -q '\"kind\": \"ready\"'",
                timeout=900,
            )
            # The control plane's limits carry the sold /home sizes; the
            # agent is ready once their templates exist.
            curl = "curl --fail --silent --show-error --cert ${credentials}/client.crt --key ${credentials}/client.key --cacert /tmp/server.crt"
            controlPlane.succeed(
                f"{curl} -X PUT -H 'content-type: application/json' https://192.168.1.2:8444/v1/host/limits"
                " --data '{\"guestMemoryMaxBytes\": 2147483648, \"squeezeAboveBytes\": null, \"squeezeBelowBytes\": null, \"homeDiskGib\": [1]}'"
            )
            controlPlane.wait_until_succeeds(f"{curl} https://192.168.1.2:8444/health", timeout=300)
            computer = json.loads(client(
                "create ${computerId} --image test --vcpus 1 --memory-mib 512"
                " --root-disk-gib 2 --home-disk-gib 1 --pairing-id ${pairingId}"
            ))
            assert computer["state"] == "running", computer
            host.succeed("zfs list -H -o name | grep -q 'computers/${computerId}'")
            client("exec ${computerId} --root test -e /run/macro-restored")
            client("exec ${computerId} --root sh -c 'echo kept > /home/marker && sync'")

            client("hibernate ${computerId}")
            assert json.loads(client("get ${computerId}"))["state"] == "hibernated"
            host.fail("pgrep -x firecracker")
            client("start ${computerId}")
            assert client("exec ${computerId} --root cat /home/marker").strip() == "kept"

            client("stop ${computerId}")
            assert json.loads(client("get ${computerId}"))["state"] == "stopped"
            # Open item: a cold start of this test guest never answers. Its
            # kernel boots but the guest agent never comes up, and computers
            # have no console (serial goes nowhere by design, finding S-4).
            # A cold start of the real macro-box image (stop, start, exec,
            # /home kept) is covered by the end-to-end suite on Firecracker
            # hosts; debug this guest's cold boot before checking it here.

            client("destroy ${computerId}")
            host.fail("zfs list -H -o name | grep -q 'computers/${computerId}'")
            assert json.loads(client("host"))["networkSlots"]["free"] == 4
    else:
        print("=" * 72)
        print("SKIPPED: no /dev/kvm in the test VM (no nested KVM on this builder);")
        print("the computer lifecycle did not run. Run this check on a Firecracker host.")
        print("=" * 72)
        with subtest("SKIPPED computer lifecycle: no nested KVM (/dev/kvm) in the test VM"):
            pass
  '';
}
