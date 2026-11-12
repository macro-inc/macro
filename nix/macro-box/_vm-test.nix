# Boots the guest module in a NixOS test VM and checks the macrod contract,
# the agent tools, nix-ld, and the agent teammate's units and computer use. Incus enrollment cannot
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
  # A fake agent environment as `macrod enroll` writes it (systemd's quoted
  # KEY="value" lines). Macro itself is
  # unreachable; the repo is the in-VM git server.
  agentEnvironment =
    repoUrl:
    pkgs.writeText "agent.env" ''
      MACRO_API_KEY="mak_test"
      MACRO_GATEWAY="http://127.0.0.1:9"
      OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL="http://127.0.0.1:9"
      OVERRIDE_AUTH_SERVICE_URL="http://127.0.0.1:9"
      OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL="http://127.0.0.1:9"
      OVERRIDE_AGENT_HARNESS_SERVICE_URL="http://127.0.0.1:9"
      OVERRIDE_SCHEDULED_ACTION_SERVICE_URL="http://127.0.0.1:9"
      OVERRIDE_MCP_SERVICE_URL="http://127.0.0.1:9"
      OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL="ws://127.0.0.1:9"
      ANTHROPIC_BASE_URL="http://127.0.0.1:9/anthropic"
      ANTHROPIC_AUTH_TOKEN="test-gateway-token"
      MACRO_REPO_URL="${repoUrl}"
      MACRO_REPO_TOKEN="test-token"
      MACRO_AGENT_USER_ID="macro|ada@example.com"
      MACRO_AGENT_NAME="Ada"
    '';
  goodAgentEnvironment = agentEnvironment "http://127.0.0.1:8080/repo.git";
  credentialedAgentEnvironment = agentEnvironment "http://agent:test-token@127.0.0.1:8080/repo.git";
  # The repo agent_git renders: the starter agent without its packages.
  starterAgent = pkgs.lib.fileset.toSource {
    root = ../../packages/starter-agent;
    fileset = pkgs.lib.fileset.difference ../../packages/starter-agent (
      pkgs.lib.fileset.maybeMissing ../../packages/starter-agent/node_modules
    );
  };
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
    virtualisation.cores = 4;
    virtualisation.diskSize = 4096;
    virtualisation.emptyDiskImages = [
      {
        size = 1024;
        driveConfig.deviceExtraOpts.serial = "data";
      }
    ];
    environment.etc."macro-box-test/hello".source = "${downloadedBinary}/bin/hello";
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
  # An agent teammate's computer (agentMode): macro has no sudo or docker,
  # and the agent's units run against an in-VM agent_git and an
  # unreachable Macro.
  nodes.agent = {
    imports = [ guest ];
    macro.box = {
      inherit macrod;
      agentMode = true;
      dataDisk = null;
      # Prints the environment the `claude` wrapper hands it.
      claudeCode = pkgs.writeShellScriptBin "claude" "env";
    };
    virtualisation.memorySize = 4096;
    virtualisation.cores = 4;
    virtualisation.diskSize = 4096;
    # The agent's repo, served as agent_git serves it.
    systemd.services.test-git-server = {
      wantedBy = [ "multi-user.target" ];
      path = [ pkgs.git ];
      serviceConfig.ExecStart = "${pkgs.python3}/bin/python3 ${./files/test-git-server.py}";
    };
  };
  testScript =
    { nodes, ... }:
    ''
      import json

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

      with subtest("in agent mode macro has no sudo or docker"):
          agent.wait_for_unit("multi-user.target")
          groups = agent.succeed("id -nG macro").split()
          assert "docker" not in groups and "wheel" not in groups, groups
          agent.fail("su - macro -c 'sudo -n true'")
          agent.fail("su - macro -c 'docker info'")

      with subtest("the agent does not run without an agent environment"):
          agent.succeed("systemctl is-active --quiet macro-agent.path")
          agent.fail("systemctl is-active --quiet macro-agent.service")
          agent.succeed("[ $(systemctl show macro-agent.service --property=ConditionResult --value) = no ]")

      with subtest("the agent's browser runs on its desktop, DevTools on loopback only"):
          port = 9223
          agent.wait_for_open_port(port)
          agent.succeed(f"curl --fail http://127.0.0.1:{port}/json/version")
          listeners = agent.succeed(f"ss -ltnH 'sport = :{port}'")
          assert all(line.split()[3].startswith("127.0.0.1:") for line in listeners.splitlines()), listeners
          agent.wait_until_succeeds("test -d /home/macro/agent/browser/Default")
          agent.succeed("[ $(stat -c %U /home/macro/agent/browser) = macro ]")

      with subtest("the agent's virtual sink and its monitor source exist"):
          pactl = "su - macro -c 'XDG_RUNTIME_DIR=/run/user/1000 pactl list short {}'"
          agent.wait_until_succeeds(pactl.format("sinks") + " | grep -w agent")
          agent.succeed(pactl.format("sources") + " | grep -w agent.monitor")

      with subtest("a call can capture the agent's desktop and sound"):
          agent.succeed("su - macro -c 'DISPLAY=:1 ${pkgs.ffmpeg-full}/bin/ffmpeg -loglevel error -f x11grab -video_size 1920x1080 -i :1 -frames:v 1 /tmp/frame.png' && test -s /tmp/frame.png")
          sound = agent.succeed("su - macro -c 'XDG_RUNTIME_DIR=/run/user/1000 timeout 2 parec -d @DEFAULT_MONITOR@ --raw | head -c 4096 | wc -c' || true").strip()
          assert int(sound) == 4096, sound

      with subtest("computer use sees and captures the agent's desktop"):
          agent.wait_for_open_port(5901)
          agent.wait_until_succeeds("systemctl --user --machine=macro@ is-active --quiet macro-agent-openbox.service")
          servers = "${pkgs.writeText "mcp-servers.json" (builtins.toJSON nodes.agent.macro.box.agent.mcpServers)}"
          # Chromium's AT-SPI tree appears a few seconds after its window.
          size = agent.wait_until_succeeds(f"su - macro -c '${pkgs.python3}/bin/python3 ${./files/test-computer-use.py} {servers}'", timeout=120).strip()
          assert int(size) > 1000, size

      with subtest("the agent rejects a repo URL with credentials"):
          agent.succeed(
              "mkdir -p /srv/git && git init --quiet --bare -b main /srv/git/repo.git"
              + " && cp -r ${starterAgent} /tmp/seed && chmod -R u+w /tmp/seed"
              + " && git -C /tmp/seed init --quiet -b main && git -C /tmp/seed add -A"
              + " && git -C /tmp/seed -c user.name=seed -c user.email=seed@example.com commit --quiet -m seed"
              + " && git -C /tmp/seed push --quiet /srv/git/repo.git main"
          )
          agent.wait_for_open_port(8080)
          # Enrollment writes the file; the path unit starts the agent.
          agent.succeed("install -m 0600 -o macro -g macro ${credentialedAgentEnvironment} /var/lib/macrod/agent.env")
          agent.wait_until_succeeds("journalctl -u macro-agent.service | grep -F 'MACRO_REPO_URL must be an HTTP(S) URL without credentials'")
          agent.fail("test -e /home/macro/agent/workspace")
          # Rejected before git sends any request, and not a failed boot.
          agent.fail("test -e /srv/git/traceparents")
          agent.fail("test -s /home/macro/agent/state/failed-boots")

      with subtest("a rewritten agent environment restarts the agent, which clones and runs"):
          agent.succeed("install -m 0600 -o macro -g macro ${goodAgentEnvironment} /var/lib/macrod/agent.env")
          agent.wait_until_succeeds("journalctl -u macro-agent.service | grep -F 'starting the runtime at'")
          agent.wait_until_succeeds("pgrep -u macro -f 'bun /home/macro/agent/workspace/cli.ts run'")
          agent.succeed("[ $(systemctl show macro-agent.service --property=User --value) = macro ]")
          agent.succeed("[ $(stat -c %U /home/macro/agent/workspace) = macro ]")
          # The image's packages, with muppet and the SDK beside them.
          agent.succeed("[ $(readlink /home/macro/agent/workspace/node_modules) = ${nodes.agent.macro.box.agent.runtime}/node_modules ]")
          agent.succeed("test -f /home/macro/agent/workspace/node_modules/@macro-inc/sdk/dist/src/macro.js")
          agent.succeed("test -f /home/macro/agent/workspace/node_modules/@macro-inc/muppet/package.json")
          git = "git -c safe.directory=/home/macro/agent/workspace -C /home/macro/agent/workspace"
          agent.succeed(f"[ \"$({git} config user.email)\" = ada@example.com ] && [ \"$({git} config user.name)\" = Ada ]")
          agent.fail(f"grep -rF test-token /home/macro/agent/workspace/.git/config")
          # The helper answers only for the agent's repo.
          helper = agent.succeed(f"{git} config --get-all credential.helper | tail -n 1").strip()
          program, credentials = helper.removeprefix("!").split(" ")
          assert credentials == "/run/credentials/macro-agent.service/agent.env", credentials
          agent.succeed(f"printf 'protocol=http\\nhost=127.0.0.1:8080\\npath=repo.git\\n\\n' | {program} /var/lib/macrod/agent.env get | grep -Fx password=test-token")
          agent.succeed(f"[ -z \"$(printf 'protocol=http\\nhost=other.invalid\\npath=repo.git\\n\\n' | {program} /var/lib/macrod/agent.env get)\" ]")
          # agent.env is a credential, not process environment.
          pid = agent.succeed("systemctl show macro-agent.service --property=MainPID --value").strip()
          agent.fail(f"tr '\\0' '\\n' < /proc/{pid}/environ | grep -F MACRO_API_KEY")
          agent.succeed(f"tr '\\0' '\\n' < /proc/{pid}/environ | grep -Fx MUPPET_CREDENTIALS_FILE=/run/credentials/macro-agent.service/agent.env")
          agent.succeed(f"nsenter -t {pid} -m -- test -r /run/credentials/macro-agent.service/agent.env")

      with subtest("claude in the agent's unit uses harnessd's sign-in when there is one"):
          sign_in = "${nodes.agent.macro.box.harnessd.stateDirectory}/claude"
          agent.succeed(f"tr '\\0' '\\n' < /proc/{pid}/environ | grep -Fx HARNESSD_STATE_DIRECTORY={sign_in}")
          # As the runtime starts it: as macro, in the unit's view of the files.
          as_agent = f"nsenter -t {pid} -m -- setpriv --reuid=macro --regid=macro --init-groups"
          claude = f"{as_agent} env ANTHROPIC_BASE_URL=http://gateway.invalid /run/current-system/sw/bin/claude"
          # No sign-in: the gateway environment passes through.
          env = agent.succeed(claude)
          assert "ANTHROPIC_BASE_URL=http://gateway.invalid" in env, env
          assert "CLAUDE_CODE_OAUTH_TOKEN" not in env, env
          # The directory the unit binds is harnessd's: it (as macro) writes
          # the sign-in there, atomically.
          agent.succeed(f"[ \"$(stat -c '%U:%G %a' {sign_in})\" = 'macro:macro 700' ]")
          agent.succeed(f"su macro -s /bin/sh -c 'umask 077 && echo {{\\\"token\\\":\\\"test-oauth-token\\\"}} > {sign_in}/.credential.json.tmp && mv {sign_in}/.credential.json.tmp {sign_in}/credential.json'")
          env = agent.succeed(claude)
          assert "CLAUDE_CODE_OAUTH_TOKEN=test-oauth-token" in env, env
          assert "ANTHROPIC_BASE_URL" not in env, env
          # Bound read-only: the agent can't replace the sign-in.
          agent.fail(f"{as_agent} touch {sign_in}/credential.json")
          agent.succeed(f"rm {sign_in}/credential.json")

      with subtest("repeated failed boots roll the workspace back to last-good"):
          good = agent.succeed(f"{git} rev-parse HEAD").strip()
          agent.succeed(f"echo {good} > /home/macro/agent/state/last-good && chown macro:macro /home/macro/agent/state/last-good")
          # A broken self-edit: it records what the agent can reach from inside
          # its unit, then fails to boot.
          agent.succeed("su - macro -c 'touch ~/work/secret'")
          agent.succeed(
              "su - macro -c 'cp ${./files/test-agent-probe.ts} /home/macro/agent/workspace/cli.ts"
              + " && git -C /home/macro/agent/workspace -c user.name=t -c user.email=t@example.com commit --quiet -am broken'"
          )
          bad = agent.succeed(f"{git} rev-parse HEAD").strip()
          assert bad != good
          agent.succeed("systemctl restart macro-agent.service")
          agent.wait_until_succeeds(f"[ $({git} rev-parse HEAD) = {good} ]", timeout=180)
          agent.succeed("journalctl -u macro-agent.service | grep -F 'rolling back from'")

      with subtest("inside its unit the agent has no root, docker, credentials in env or other homes"):
          probe = json.loads(agent.succeed("cat /home/macro/agent/probe.json"))
          assert probe["sudo"] != 0, probe
          assert probe["docker"] != 0, probe
          assert probe["noNewPrivileges"], probe
          assert not probe["otherHome"], probe
          assert probe["apiKeyInEnvironment"] is False, probe
          assert probe["credentialsReadable"], probe
          # 1: bwrap ran (user namespaces work in the unit) and the file was hidden.
          assert probe["credentialsInChildren"] == 1, probe

      with subtest("the restart marker restarts the agent"):
          before = agent.succeed("systemctl show macro-agent.service --property=InvocationID --value").strip()
          agent.succeed("su - macro -c 'touch /home/macro/agent/.restart'")
          agent.wait_until_succeeds(f"[ $(systemctl show macro-agent.service --property=InvocationID --value) != {before} ]")

      with subtest("removing the agent environment stops the agent"):
          agent.succeed("rm /var/lib/macrod/agent.env")
          agent.wait_until_fails("systemctl is-active --quiet macro-agent.service")
    '';
}
