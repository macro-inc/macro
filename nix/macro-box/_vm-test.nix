# Boots the guest module in a NixOS test VM and checks the macrod contract,
# the agent tools and nix-ld. Incus enrollment cannot run here, so
# macrod-enroll must fail with its readable reason.
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
in
pkgs.testers.runNixOSTest {
  name = "macro-box";
  nodes.machine = {
    imports = [ guest ];
    macro.box.macrod = macrod;
    virtualisation.memorySize = 4096;
    virtualisation.diskSize = 4096;
    environment.etc."macro-box-test/hello".source = "${downloadedBinary}/bin/hello";
  };
  testScript = ''
    machine.wait_for_unit("multi-user.target")

    with subtest("enrollment fails with a reason when Incus is missing"):
        machine.wait_until_fails("systemctl is-active --quiet macrod-enroll.service")
        machine.succeed("journalctl -u macrod-enroll.service | grep -F '/dev/incus/sock is missing'")

    with subtest("macrod runs as macro after enrollment and the token store"):
        after = machine.succeed("systemctl show macrod.service --property=After --value")
        assert "macrod-enroll.service" in after and "macrod-token-store.service" in after, after
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
        machine.succeed("su - macro -c '/bin/bash -c true'")

    with subtest("downloaded glibc binaries run through nix-ld"):
        machine.succeed("su - macro -c 'cp /etc/macro-box-test/hello /tmp/hello && /tmp/hello'")

    with subtest("the desktop and browser start for macro"):
        machine.wait_for_open_port(5900)
        machine.wait_for_open_port(9222)
        machine.succeed("curl --fail http://127.0.0.1:9222/json/version")
  '';
}
