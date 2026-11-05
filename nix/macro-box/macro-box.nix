# Flake outputs for the Macro computer image; see AGENTS.md.
{ inputs, ... }:
{
  perSystem =
    {
      system,
      self',
      lib,
      ...
    }:
    let
      pkgs = import inputs.nixpkgs {
        inherit system;
        # Claude Code is unfree.
        config.allowUnfree = true;
      };
      box = import ./_build.nix {
        inherit pkgs;
        inherit (self'.packages) macrod;
      };
    in
    {
      checks = lib.optionalAttrs (system == "x86_64-linux") {
        macro-brain-persona =
          pkgs.runCommand "macro-brain-persona-test"
            {
              nativeBuildInputs = [
                pkgs.python3
                pkgs.git
                pkgs.bash
                pkgs.systemd
                pkgs.bubblewrap
              ];
            }
            ''
              export HOME=$TMPDIR/home
              export XDG_RUNTIME_DIR=$TMPDIR/runtime
              mkdir -p "$XDG_RUNTIME_DIR"
              mkdir -p "$HOME"
              cp -r ${./files} root
              chmod -R u+w root
              for target in sysinit network-online shutdown basic; do
                printf '[Unit]\nDescription=Test target\n' > "root/etc/systemd/system/$target.target"
              done
              unit="brain@"persona.service
              bwrap --tmpfs / --ro-bind /nix /nix --bind "$PWD" "$PWD" \
                --proc /proc --dev /dev --tmpfs /run --tmpfs /tmp -- \
                systemd-analyze verify --root="$PWD/root" --man=no "$unit"
              # macrod enroll's concrete units must receive the template drop-in too.
              cp root/etc/systemd/system/brain@.service root/etc/systemd/system/"$unit"
              sed -i 's|ExecStart=.*|ExecStart=/opt/macro/brain run|' root/etc/systemd/system/"$unit"
              bwrap --tmpfs / --ro-bind /nix /nix --bind "$PWD" "$PWD" \
                --proc /proc --dev /dev --tmpfs /run --tmpfs /tmp -- \
                systemd-analyze verify --root="$PWD/root" --man=no "$unit"
              cp ${./test-brain.py} test-brain.py
              ln -s ${./files} files
              python3 test-brain.py
              touch $out
            '';
      };
      packages = lib.optionalAttrs (system == "x86_64-linux") {
        macro-brain = import ./_brain.nix { inherit pkgs; };
        macro-box-claude-code = box.claudeCode;
        macro-box-rootfs = box.rootfs;
        macro-box-incus = box.incus;
        macro-box-docker = box.docker;
      };
    };
}
