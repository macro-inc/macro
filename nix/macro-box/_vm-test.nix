# Boots the guest module in a NixOS test VM and checks the macrod contract,
# the agent tools and nix-ld. Incus enrollment cannot run here, so
# macrod-enroll must fail with its readable reason. Then a second image
# boots from the same data disk, as an image update does.
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
