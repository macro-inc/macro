# Runs a Firecracker computer's restore in a QEMU NixOS test: `_guest.nix`
# with `_firecracker-restore.nix` (not the Firecracker kernel or disks), a
# stand-in MMDS on 169.254.169.254. A "restore" is what the host does after
# resuming: write the identity to MMDS and start macro-restore (the RNG reseed
# at a VM generation change is the kernel's, checked on Firecracker).
{
  pkgs,
  guest,
  macrod,
  harnessd,
}:
let
  identity =
    id: role:
    builtins.toJSON {
      inherit id role;
      # 2030-01-01T00:00:00Z
      time_unix_ms = 1893456000000;
      network = {
        mac = "06:00:0a:c8:07:02";
        address = "10.200.7.2/24";
        gateway = "10.200.7.1";
        dns = [ "10.200.7.1" ];
      };
    };
  enrollment = pkgs.writeText "enrollment.json" (
    builtins.toJSON {
      generation = 1;
      computer_id = "00000000-0000-0000-0000-00000000000c";
      pairing_id = "00000000-0000-0000-0000-00000000000a";
      device_secret = "mhds_test";
      name = "Agent computer";
      role = "agent";
      deployment = {
        agent_harness_url = "http://127.0.0.1:41009/agent-harness/";
        document_storage_url = "http://127.0.0.1:41009/dss";
        app_url = "http://127.0.0.1:41009";
        egress_url = "http://127.0.0.1:41009";
      };
    }
  );
  # What the service sends an agent's computer; the repo is unreachable.
  agentEnvironment = pkgs.writeText "agent-environment.json" (
    builtins.toJSON {
      MACRO_REPO_URL = "http://127.0.0.1:9/repo.git";
      MACRO_REPO_TOKEN = "test-token";
      MACRO_AGENT_USER_ID = "macro|ada@example.com";
      MACRO_AGENT_NAME = "Applied";
    }
  );
in
pkgs.testers.runNixOSTest {
  name = "macro-box-firecracker-restore";
  # The guest sets nixpkgs.config (Claude Code is unfree).
  node.pkgsReadOnly = false;
  nodes.machine = {
    imports = [
      guest
      ./_firecracker-restore.nix
    ];
    macro.box.macrod = macrod;
    macro.box.harnessd.package = harnessd;
    virtualisation.memorySize = 4096;
    virtualisation.cores = 2;
    virtualisation.diskSize = 4096;
    # /dev/vdb, the computer's volume (no placeholder swap in QEMU).
    virtualisation.emptyDiskImages = [ 256 ];
    # The test VM's own fileSystems replace the guest's.
    virtualisation.fileSystems."/home" = {
      device = "/dev/vdb";
      fsType = "ext4";
      options = [ "noauto" ];
    };
    # The test VM's eth0 is QEMU's user network; nothing answers on the
    # computer's address, and nothing needs to.
    networking.usePredictableInterfaceNames = false;
    # Macro on loopback for the agent computer's enrollment: it claims the
    # pairing, and the runtime websocket hands macrod the agent's environment.
    systemd.services.fake-macro = {
      wantedBy = [ "multi-user.target" ];
      serviceConfig.ExecStart = "${pkgs.python3}/bin/python3 ${./files/test-fake-macro.py} 41009 ${agentEnvironment}";
    };
    systemd.services.test-mmds = {
      wantedBy = [ "multi-user.target" ];
      before = [ "macro-restore.service" ];
      requiredBy = [ "macro-restore.service" ];
      serviceConfig = {
        ExecStartPre = "${pkgs.iproute2}/bin/ip address replace 169.254.169.254/32 dev lo";
        ExecStart = "${pkgs.python3}/bin/python3 ${./files/test-mmds.py}";
        StateDirectory = "test-mmds/macro";
      };
    };
  };
  testScript = ''
    macro_uid = 1000
    macro_session = f"user@{macro_uid}.service"

    def restore(identity_json):
        machine.succeed(f"echo '{identity_json}' > /var/lib/test-mmds/macro/identity.json")
        before = machine.succeed("systemctl show macro-restore.service --property=InvocationID --value")
        # What the host runs through firecracker-guest-agent.
        machine.succeed("systemctl start macro-restore.service")
        after = machine.succeed("systemctl show macro-restore.service --property=InvocationID --value")
        assert after != before, after

    machine.wait_for_unit("multi-user.target")

    with subtest("the golden boot leaves /home and what needs it alone"):
        machine.wait_until_succeeds("journalctl -u macro-restore.service | grep -F 'no identity in MMDS'")
        machine.fail("mountpoint -q /home")
        machine.fail("test -e /run/macro/home-ready")
        for unit in ["home.mount", "macrod-enroll.service", "macrod.service", "harnessd.service", "docker.service", macro_session]:
            machine.fail(f"systemctl is-active --quiet {unit}")
        machine.succeed("systemctl is-active --quiet docker.socket")
        golden_id = machine.succeed("cat /etc/machine-id").strip()
        # The host attaches the computer's volume already formatted.
        machine.succeed("mkfs.ext4 -q -L home /dev/vdb")

    with subtest("only root reaches MMDS"):
        token = "curl -s --max-time 2 -X PUT -H 'X-metadata-token-ttl-seconds: 60' http://169.254.169.254/latest/api/token"
        machine.succeed(token)
        machine.fail(f"runuser -u macro -- {token}")
        machine.fail(f"runuser -u nobody -- {token}")

    with subtest("a restore takes the identity from MMDS and mounts /home"):
        restore('${identity "computer-a" "person"}')
        first_id = machine.succeed("cat /etc/machine-id").strip()
        assert first_id != golden_id, first_id
        machine.succeed("date --utc +%Y | grep -x 2030")
        machine.wait_until_succeeds("ip -4 address show dev eth0 | grep -F 10.200.7.2/24")
        machine.succeed("ip -4 address show dev eth0 | grep -F 169.254.0.2/16")
        # The guest keeps the golden's MAC (its own netns makes the host's moot).
        machine.fail("ip link show dev eth0 | grep -F 06:00:0a:c8:07:02")
        machine.wait_until_succeeds("ip route show default | grep -F 'via 10.200.7.1'")
        # systemd mounts it on the way to macrod, after macro-restore answered.
        machine.wait_until_succeeds("findmnt --noheadings --output SOURCE,FSTYPE /home | grep -x '/dev/vdb ext4'")
        machine.succeed("stat -c '%U %a' /home/macro | grep -x 'macro 700'")
        machine.succeed("test -L /home/macro/.macrod/adapters/@agentclientprotocol/claude-agent-acp*")
        machine.succeed("test -d /home/.system/macrod")
        machine.wait_for_unit("macro-home.target")
        machine.wait_for_unit("harnessd.service")
        machine.wait_for_unit(macro_session)
        machine.wait_until_succeeds("journalctl -u macrod-enroll.service | grep -F 'put the Enrollment JSON at macro.enrollment'")

    with subtest("a person's computer gives macro sudo and Docker, and runs no agent"):
        machine.succeed("runuser -u macro -- sudo -n true")
        machine.succeed("getfacl -p /run/docker.sock | grep -x 'user:macro:rw-'")
        machine.fail("test -e /run/macro-agent-inbox")
        machine.fail("systemctl is-active --quiet macro-agent.target")
        machine.fail("systemctl is-active --quiet macro-agent-display.service")
        machine.fail("systemctl is-active --quiet macro-agent-screen-encoder.socket")
        machine.fail("ss -ltnH 'sport = :5902' | grep .")

    with subtest("a drive the host grows grows its mounted filesystem"):
        # drive1 is the root disk (vda); drive2, the first empty disk, is /dev/vdb.
        machine.send_monitor_command("block_resize drive2 512M")
        machine.wait_until_succeeds("test $(df --output=size -BM /home | tail -1 | tr -dc 0-9) -gt 400")

    with subtest("a repeated restore of the same computer keeps its machine id and files"):
        machine.succeed("echo kept > /home/macro/work/kept && chown macro: /home/macro/work/kept")
        restore('${identity "computer-a" "person"}')
        machine.succeed("journalctl -u macro-restore.service | grep -F 'woke as computer-a'")
        assert machine.succeed("cat /etc/machine-id").strip() == first_id
        machine.succeed("grep -x kept /home/macro/work/kept")

    with subtest("another computer's identity gets another machine id"):
        machine.succeed("cp ${enrollment} /var/lib/test-mmds/macro/enrollment.json")
        restore('${identity "computer-b" "agent"}')
        second_id = machine.succeed("cat /etc/machine-id").strip()
        assert second_id not in (golden_id, first_id), second_id

    with subtest("an agent's computer gives macro no sudo and installs the agent's environment"):
        machine.fail("runuser -u macro -- sudo -n true")
        machine.wait_for_unit("macro-agent.target")
        machine.wait_for_unit("macro-agent-display.service")
        machine.wait_for_unit("macro-agent-browser.service")
        machine.wait_for_unit("macro-agent-screen-encoder.socket")
        machine.succeed("${pkgs.python3}/bin/python3 ${./files/test-screen-encoder-client.py} 5902 '10 640 360 10' 3 /tmp/encoder.mp4")
        first = machine.succeed("${pkgs.ffmpeg-headless}/bin/ffprobe -v error -select_streams v:0 -show_entries packet=flags -of csv=p=0 /tmp/encoder.mp4 | head -n 1").strip()
        assert first.startswith("K"), first

    with subtest("the service's ApplyAgent reaches the agent through macrod and starts it"):
        # macrod enrolls from MMDS against the fake Macro, which sends
        # ApplyAgent as soon as macrod's runtime websocket opens.
        machine.wait_until_succeeds("journalctl -u fake-macro -o cat | grep -F 'sent applyAgent'", timeout=120)
        machine.wait_until_succeeds("grep -Fx 'MACRO_AGENT_NAME=\"Applied\"' /var/lib/macrod/agent.env", timeout=60)
        machine.succeed("stat -c '%U %a' /var/lib/macrod/agent.env | grep -x 'macro 600'")
        machine.wait_until_succeeds("journalctl -u macro-agent.service -o cat | grep -F 'Started Macro agent teammate'")
        machine.succeed("test ! -s /run/macro-agent-inbox/agent.env")

    with subtest("macro's own write to the inbox is installed the same way"):
        # What macrod stages for ApplyAgent: the setup trace first, then the environment.
        trace = "00-11111111111111111111111111111111-2222222222222222-01"
        machine.succeed(f"runuser -u macro -- sh -c 'printf %s {trace} > /run/macro-agent-inbox/setup-traceparent'")
        machine.succeed("runuser -u macro -- sh -c 'echo MACRO_AGENT_NAME=Ada > /run/macro-agent-inbox/agent.env'")
        machine.wait_until_succeeds("grep -x MACRO_AGENT_NAME=Ada /var/lib/macrod/agent.env")
        machine.succeed("stat -c '%U %a' /var/lib/macrod/agent.env | grep -x 'macro 600'")
        machine.succeed("test ! -s /run/macro-agent-inbox/agent.env")
        # The setup trace is installed root-owned and read-only, once.
        machine.succeed(f"grep -x {trace} /run/macrod/agent-traceparent")
        machine.succeed("stat -c '%U %a' /run/macrod/agent-traceparent | grep -x 'root 644'")
        machine.succeed("test ! -s /run/macro-agent-inbox/setup-traceparent")
        # A trace that can't be installed doesn't stop the environment, and
        # stays in the inbox for the next delivery.
        machine.succeed("rm -f /run/macrod/agent-traceparent && mkdir /run/macrod/agent-traceparent.new")
        machine.succeed(f"runuser -u macro -- sh -c 'printf %s {trace} > /run/macro-agent-inbox/setup-traceparent'")
        machine.succeed("runuser -u macro -- sh -c 'echo MACRO_AGENT_NAME=Bea > /run/macro-agent-inbox/agent.env'")
        machine.wait_until_succeeds("grep -x MACRO_AGENT_NAME=Bea /var/lib/macrod/agent.env")
        machine.succeed("test ! -e /run/macrod/agent-traceparent")
        machine.succeed(f"grep -x {trace} /run/macro-agent-inbox/setup-traceparent")
        machine.succeed("rmdir /run/macrod/agent-traceparent.new")
        machine.succeed("runuser -u macro -- sh -c 'echo MACRO_AGENT_NAME=Ada > /run/macro-agent-inbox/agent.env'")
        machine.wait_until_succeeds("grep -x MACRO_AGENT_NAME=Ada /var/lib/macrod/agent.env")
        machine.succeed(f"grep -x {trace} /run/macrod/agent-traceparent")
        machine.succeed("test ! -s /run/macro-agent-inbox/setup-traceparent")
        # A symlink macro plants in its inbox can't make root read or write
        # through it.
        shadow = machine.succeed("sha256sum /etc/shadow")
        machine.succeed("runuser -u macro -- ln -sfn /etc/shadow /run/macro-agent-inbox/agent.env")
        machine.wait_until_succeeds("systemctl show macro-agent-apply.service --property=Result --value | grep -x exit-code")
        machine.fail("test -e /var/lib/macrod/agent.env.new")
        machine.succeed("grep -x MACRO_AGENT_NAME=Ada /var/lib/macrod/agent.env")
        assert machine.succeed("sha256sum /etc/shadow") == shadow

    with subtest("a cold boot of a restored computer mounts its /home at boot"):
        machine.shutdown()
        machine.start()
        machine.wait_for_unit("macro-home.target")
        machine.succeed("grep -x kept /home/macro/work/kept")
        machine.wait_for_unit(macro_session)
        assert machine.succeed("cat /etc/machine-id").strip() == second_id
  '';
}
