# Boots the guest module in a NixOS test VM and checks the macrod contract,
# the agent tools, nix-ld and the agent brain's unit. Incus enrollment cannot
# run here, so macrod-enroll must fail with its readable reason. Then a
# second image boots from the same data disk, as an image update does.
{
  pkgs,
  guest,
  macrod,
}:
let
  # A prebuilt glibc binary as an agent would download it: generic loader,
  # no Nix rpath.
  downloadedBinary = pkgs.runCommand "downloaded-hello" { nativeBuildInputs = [ pkgs.patchelf ]; } ''
    install -Dm0755 ${pkgs.hello}/bin/hello $out/bin/hello
    patchelf --set-interpreter /lib64/ld-linux-x86-64.so.2 --remove-rpath $out/bin/hello
  '';
  # The test VMs' own fileSystems replace the guest's, so the data disk is
  # declared again here.
  dataDisk = {
    macro.box.dataDisk = "/dev/disk/by-id/virtio-data";
    virtualisation.fileSystems."/home" = {
      device = "/dev/disk/by-id/virtio-data";
      fsType = "ext4";
      autoFormat = true;
      neededForBoot = true;
    };
  };
  # A fake agent environment as `macrod enroll` writes it. Every service is
  # unreachable, so the brain gets past its checks and retries its events.
  agentEnvironment =
    repoUrl:
    pkgs.writeText "agent.env" ''
      MACRO_API_KEY=mak_test
      MACRO_GATEWAY=http://127.0.0.1:9
      OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL=http://127.0.0.1:9
      OVERRIDE_AUTH_SERVICE_URL=http://127.0.0.1:9
      OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL=http://127.0.0.1:9
      OVERRIDE_AGENT_HARNESS_SERVICE_URL=http://127.0.0.1:9
      OVERRIDE_SCHEDULED_ACTION_SERVICE_URL=http://127.0.0.1:9
      OVERRIDE_MCP_SERVICE_URL=http://127.0.0.1:9
      OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL=ws://127.0.0.1:9
      ANTHROPIC_BASE_URL=http://127.0.0.1:9/anthropic
      ANTHROPIC_AUTH_TOKEN=test-gateway-token
      MACRO_REPO_URL=${repoUrl}
      MACRO_REPO_TOKEN=test-token
      MACRO_AGENT_USER_ID=macro|ada@example.com
      MACRO_AGENT_NAME=Ada
      BRAIN_PROVISION_TRACEPARENT=00-11111111111111111111111111111111-2222222222222222-01
    '';
  goodAgentEnvironment = agentEnvironment "http://127.0.0.1:8080/repo.git";
  credentialedAgentEnvironment = agentEnvironment "http://brain:test-token@127.0.0.1:8080/repo.git";
in
pkgs.testers.runNixOSTest {
  name = "macro-box";
  # The guest sets nixpkgs.config (Claude Code is unfree).
  node.pkgsReadOnly = false;
  nodes.machine = {
    imports = [
      guest
      dataDisk
    ];
    macro.box.macrod = macrod;
    virtualisation.memorySize = 4096;
    # The brain's activation check (tsc, tests, fake boot) has a 60 s bound.
    virtualisation.cores = 4;
    virtualisation.diskSize = 4096;
    virtualisation.emptyDiskImages = [
      {
        size = 1024;
        driveConfig.deviceExtraOpts.serial = "data";
      }
    ];
    environment.etc."macro-box-test/hello".source = "${downloadedBinary}/bin/hello";
    # The agent's repo, served as agent_git serves it.
    systemd.services.test-git-server = {
      wantedBy = [ "multi-user.target" ];
      path = [ pkgs.git ];
      serviceConfig.ExecStart = "${pkgs.python3}/bin/python3 ${./files/test-git-server.py}";
    };
  };
  # The next image: a fresh root disk and machine's data disk.
  nodes.updated = {
    imports = [
      guest
      dataDisk
    ];
    macro.box.macrod = macrod;
    virtualisation.memorySize = 4096;
    virtualisation.diskSize = 4096;
    virtualisation.qemu.drives = [
      {
        name = "data";
        file = ''"$TMPDIR"/../vm-state-machine/empty0.qcow2'';
        deviceExtraOpts.serial = "data";
      }
    ];
    environment.etc."macro-box-image".text = "v2";
  };
  testScript =
    { nodes, ... }:
    ''
    machine.wait_for_unit("multi-user.target")

    with subtest("enrollment fails with a reason when Incus is missing"):
        machine.wait_until_fails("systemctl is-active --quiet macrod-enroll.service")
        machine.succeed("journalctl -u macrod-enroll.service | grep -F '/dev/incus/sock is missing'")

    with subtest("macrod runs as macro after enrollment"):
        after = machine.succeed("systemctl show macrod.service --property=After --value")
        assert "macrod-enroll.service" in after, after
        machine.succeed("[ $(systemctl show macrod.service --property=User --value) = macro ]")
        machine.succeed("[ $(systemctl show macrod.service --property=Restart --value) = always ]")
        machine.succeed("[ $(systemctl show macrod.service --property=WorkingDirectory --value) = /home/macro/work ]")

    with subtest("Claude Code's ACP adapter needs no install"):
        environment = machine.succeed("systemctl show macrod-enroll.service --property=Environment --value").strip()
        machine.succeed(
            f"systemd-run --quiet --wait --pipe --collect --property='Environment={environment}' "
            + "macrod detect-agents | jq --exit-status "
            + "'any(.agents[]; .id == \"claude-code\" and .needs_install == false)'"
        )

    with subtest("agent tools are on macro's PATH"):
        machine.succeed("su - macro -c 'command -v claude herdr docker chromium node git uv'")
        machine.succeed("su - macro -c 'docker info' >&2")
        machine.succeed("su - macro -c 'test -f ~/.claude/skills/this-machine/SKILL.md && test -O ~/.claude.json'")
        # herdr's official skill, from the source herdr was built from.
        machine.succeed("cmp /home/macro/.claude/skills/herdr/SKILL.md ${nodes.machine.macro.box.herdrSource}/skills/herdr/SKILL.md")
        machine.succeed("grep -F 'HERDR_ENV=1' /etc/skel/.claude/skills/herdr/SKILL.md && test -s /etc/skel/.claude/skills/herdr/LICENSE")
        machine.succeed("su - macro -c '/bin/bash -c true'")

    with subtest("downloaded glibc binaries run through nix-ld"):
        machine.succeed("su - macro -c 'cp /etc/macro-box-test/hello /tmp/hello && /tmp/hello'")

    with subtest("the desktop and browser start for macro"):
        machine.wait_for_open_port(5900)
        machine.wait_for_open_port(9222)
        machine.succeed("curl --fail http://127.0.0.1:9222/json/version")

    with subtest("the brain does not run without an agent"):
        machine.succeed("systemctl is-active --quiet macro-brain.path")
        machine.fail("systemctl is-active --quiet macro-brain.service")
        machine.succeed("[ $(systemctl show macro-brain.service --property=ConditionResult --value) = no ]")

    with subtest("the brain rejects a repo URL with credentials"):
        machine.succeed(
            "mkdir -p /srv/git && git init --quiet --bare -b main /srv/git/repo.git"
            + " && cp -r ${../../packages/brain/template} /tmp/seed && chmod -R u+w /tmp/seed"
            + " && git -C /tmp/seed init --quiet -b main && git -C /tmp/seed add -A"
            + " && git -C /tmp/seed -c user.name=seed -c user.email=seed@example.com commit --quiet -m seed"
            + " && git -C /tmp/seed push --quiet /srv/git/repo.git main"
        )
        machine.wait_for_open_port(8080)
        # Enrollment writes the file; the path unit starts the brain.
        machine.succeed("install -m 0600 -o macro -g macro ${credentialedAgentEnvironment} /var/lib/macrod/agent.env")
        machine.wait_until_succeeds("journalctl -u macro-brain.service | grep -F 'MACRO_REPO_URL must be an HTTP(S) URL without credentials'")
        machine.fail("test -e /home/macro/agent-workspace")
        # Rejected before git sends any request.
        machine.fail("test -e /srv/git/traceparents")

    with subtest("a rewritten agent environment restarts the brain, which clones and runs"):
        machine.succeed("install -m 0600 -o macro -g macro ${goodAgentEnvironment} /var/lib/macrod/agent.env")
        # The library's fake-event boot passed; then it retries the unreachable events stream.
        machine.wait_until_succeeds("journalctl -u macro-brain.service | grep -F '\"brain\":\"starting\"'")
        machine.wait_until_succeeds("journalctl -u macro-brain.service | grep -F '\"events\":\"failed\"'")
        machine.succeed("systemctl is-active --quiet macro-brain.service")
        machine.succeed("[ $(systemctl show macro-brain.service --property=User --value) = macro ]")
        machine.succeed("[ $(stat -c %U /home/macro/agent-workspace) = macro ]")
        machine.succeed("grep -Fx 0.2.0 /home/macro/agent-workspace/brain.lock")
        machine.succeed("[ \"$(git -c safe.directory=/home/macro/agent-workspace -C /home/macro/agent-workspace config user.email)\" = ada@example.com ]")
        machine.succeed("[ \"$(git -c safe.directory=/home/macro/agent-workspace -C /home/macro/agent-workspace config user.name)\" = Ada ]")
        machine.fail("grep -rF -e test-token -e traceparent /home/macro/agent-workspace/.git/config")
        # The first clone carries the provisioning trace.
        machine.succeed("grep -Fx 00-11111111111111111111111111111111-2222222222222222-01 /srv/git/traceparents")
        # The helper answers only for the agent's repo.
        helper = machine.succeed("git -c safe.directory=/home/macro/agent-workspace -C /home/macro/agent-workspace config --get-all credential.helper | tail -n 1").strip()
        machine.succeed(f"printf 'protocol=http\\nhost=127.0.0.1:8080\\npath=repo.git\\n\\n' | MACRO_REPO_URL=http://127.0.0.1:8080/repo.git MACRO_REPO_TOKEN=test-token {helper} get | grep -Fx password=test-token")
        machine.succeed(f"[ -z \"$(printf 'protocol=http\\nhost=other.invalid\\npath=repo.git\\n\\n' | MACRO_REPO_URL=http://127.0.0.1:8080/repo.git MACRO_REPO_TOKEN=test-token {helper} get)\" ]")

    with subtest("removing the agent environment stops the brain"):
        machine.succeed("rm /var/lib/macrod/agent.env")
        machine.wait_until_fails("systemctl is-active --quiet macro-brain.service")

    with subtest("an image update keeps homes, credentials and enrollment"):
        machine.succeed("findmnt --noheadings --output SOURCE /home | grep -F /dev/vd")
        machine.succeed("su - macro -c 'echo token > ~/.claude/.credentials.json && echo notes > ~/work/notes.txt'")
        # What a successful enrollment leaves behind.
        machine.succeed("printf 'mc-01900000000070008000000000000001\\n1\\n' > /var/lib/macrod/enrolled")
        machine.shutdown()

        updated.wait_for_unit("multi-user.target")
        updated.succeed("grep -Fx v2 /etc/macro-box-image")
        updated.succeed("su - macro -c 'grep -Fx token ~/.claude/.credentials.json && grep -Fx notes ~/work/notes.txt'")
        updated.succeed("grep -Fx mc-01900000000070008000000000000001 /var/lib/macrod/enrolled")
        # Enrollment runs on every boot; with a marker and no source the
        # check passes and leaves `macrod enroll` to keep the enrollment.
        updated.wait_until_succeeds("systemctl show macrod-enroll.service --property=ExecStartPre | grep -F 'status=0/0'")
        updated.fail("journalctl -b -u macrod-enroll.service | grep -F 'macrod-enroll: '")
        updated.succeed("systemctl cat docker.service | grep -o -- '--config-file=[^ ]*' | cut -d= -f2 | xargs jq --exit-status '.\"data-root\" == \"/home/.system/docker\"'")
  '';
}
