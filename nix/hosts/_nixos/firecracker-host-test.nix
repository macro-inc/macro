# The Firecracker host module in NixOS test VMs: the agent starts under its
# delegated cgroup, creates its netns slots and nftables tables, serves the
# API over pinned mTLS only to the configured control plane, refuses work it
# cannot do with typed errors, and survives a restart. Nested KVM is not
# available in test VMs on our builders, so no microVM boots here; the
# restore path is tested on a Firecracker host (services/firecracker_host
# AGENTS.md).
{
  pkgs,
  package,
}:
let
  # Throwaway credentials for the test's control plane.
  credentials = pkgs.runCommand "firecracker-host-test-credentials" { nativeBuildInputs = [ pkgs.openssl ]; } ''
    mkdir $out
    for name in client stranger; do
      openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-384 -nodes -days 30 \
        -subj "/CN=$name" -addext "extendedKeyUsage=clientAuth" \
        -keyout $out/$name.key -out $out/$name.crt 2> /dev/null
    done
  '';
  endpoint = pkgs.writeText "endpoint.toml" ''
    url = "https://192.168.1.2:8444"
    client_certificate = "${credentials}/client.crt"
    client_key = "${credentials}/client.key"
    server_certificate = "/tmp/server.crt"
  '';
  strangerEndpoint = pkgs.writeText "stranger-endpoint.toml" ''
    url = "https://192.168.1.2:8444"
    client_certificate = "${credentials}/stranger.crt"
    client_key = "${credentials}/stranger.key"
    server_certificate = "/tmp/server.crt"
  '';
in
pkgs.testers.runNixOSTest {
  name = "firecracker-host";
  nodes = {
    host = {
      imports = [ ./firecracker-host.nix ];
      networking.interfaces.eth1.ipv4.addresses = pkgs.lib.mkForce [
        {
          address = "192.168.1.2";
          prefixLength = 24;
        }
      ];
      virtualisation.memorySize = 2048;
      virtualisation.emptyDiskImages = [
        {
          size = 2048;
          driveConfig.deviceExtraOpts.serial = "durable";
        }
      ];
      virtualisation.fileSystems."/var/lib/firecracker-host" = {
        device = "/dev/disk/by-id/virtio-durable";
        fsType = "xfs";
        autoFormat = true;
      };
      macro.firecrackerHost = {
        inherit package;
        listenAddress = "192.168.1.2";
        apiSources = [ "192.168.1.1" ];
        clientCertificates = [ "${credentials}/client.crt" ];
        uplink = "eth1";
        slots = 4;
        environment = "local";
      };
    };
    controlPlane = {
      networking.interfaces.eth1.ipv4.addresses = pkgs.lib.mkForce [
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
      networking.interfaces.eth1.ipv4.addresses = pkgs.lib.mkForce [
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

    start_all()
    host.wait_for_unit("firecracker-host.service")
    host.wait_until_succeeds("ss -ltn | grep -q '192.168.1.2:8444'")

    with subtest("the agent runs in its delegated leaf and VMs get their own subtree"):
        host.succeed("grep -qx '0::/system.slice/firecracker-host.service/agent' /proc/$(systemctl show -P MainPID firecracker-host)/cgroup")
        host.succeed("grep -q memory /sys/fs/cgroup/system.slice/firecracker-host.service/vms/cgroup.subtree_control")

    with subtest("every slot and the golden slot have a netns, a user-owned tap and the guest firewall"):
        slots = host.succeed("ip netns list | grep -c '^fch-'").strip()
        assert slots == "5", slots
        host.succeed("ip -n fch-3 -d link show tap0 | grep -q 'user 1000000003'")
        host.succeed("ip netns exec fch-0 nft list table inet vm | grep -q 'ip saddr 172.16.0.2 accept'")
        host.fail("nft list ruleset | grep -q 'hook output'")

    with subtest("the TLS key reaches the agent only as a root credential"):
        host.succeed("test \"$(stat -c '%U %a' /var/lib/firecracker-host-tls/server.key)\" = 'root 400'")

    server_certificate = host.succeed("cat /var/lib/firecracker-host-tls/server.crt")
    controlPlane.succeed(f"cat > /tmp/server.crt <<'EOF'\n{server_certificate}EOF")

    with subtest("the pinned control plane is served"):
        info = json.loads(controlPlane.succeed("firecracker-host client --endpoint ${endpoint} host"))
        assert info["networkSlots"] == {"total": 4, "free": 4}, info
        assert info["firecrackerVersion"] == "v1.18.0", info

    with subtest("an image the host lacks is a permanent, typed refusal"):
        output = controlPlane.fail(
            "firecracker-host client --endpoint ${endpoint} create 01937a00-0000-7000-8000-000000000001 --image macro-box/missing 2>&1"
        )
        assert "imageMissing" in output, output

    with subtest("another client certificate is refused"):
        controlPlane.fail("firecracker-host client --endpoint ${strangerEndpoint} host")

    with subtest("the API port is closed to everyone but the control plane"):
        elsewhere.fail("curl --insecure --max-time 3 https://192.168.1.2:8444/v1/host")

    with subtest("a restart keeps serving"):
        host.succeed("systemctl restart firecracker-host")
        host.wait_until_succeeds("ss -ltn | grep -q '192.168.1.2:8444'")
        controlPlane.succeed("firecracker-host client --endpoint ${endpoint} list")
  '';
}
