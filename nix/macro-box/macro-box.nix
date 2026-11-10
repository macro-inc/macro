# Flake outputs for the Macro computer guest, a NixOS configuration; see
# AGENTS.md.
{
  inputs,
  withSystem,
  lib,
  ...
}:
let
  system = "x86_64-linux";
  # herdr and its skill come from one tagged source; the tag must be the
  # version that source builds.
  herdrTag = (lib.importJSON ../../flake.lock).nodes.herdr.original.ref;
  herdrVersion = (lib.importTOML "${inputs.herdr}/Cargo.toml").package.version;
  herdr =
    assert lib.assertMsg (herdrTag == "v${herdrVersion}")
      "the herdr input is pinned to ${herdrTag}, but its source builds herdr ${herdrVersion}; pin the input to the v${herdrVersion} tag";
    {
      macro.box.herdrSource = inputs.herdr;
    };
  guest =
    module:
    withSystem system (
      { self', ... }:
      inputs.nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          module
          herdr
          { macro.box.macrod = self'.packages.macrod; }
        ];
      }
    );
  machine = guest ./_image.nix;
  container = guest ./_container.nix;
  box = machine.config.macro.box;
in
{
  flake.nixosConfigurations.macro-box = machine;

  perSystem =
    {
      system,
      self',
      lib,
      pkgs,
      ...
    }:
    {
      packages = lib.optionalAttrs (system == "x86_64-linux") {
        macro-box-claude-code = box.claudeCode;
        macro-box-claude-agent-acp = box.claudeAgentAcp;
        # What `incus image import` takes.
        macro-box-incus = pkgs.runCommand "macro-box-incus" { } ''
          mkdir $out
          ln -s ${machine.config.system.build.metadata}/tarball/*.tar.xz $out/metadata.tar.xz
          ln -s ${machine.config.system.build.qemuImage}/nixos.qcow2 $out/disk.qcow2
        '';
        # `docker load < result` → macro-box:latest; run as DockerFleet does
        # (AGENTS.md).
        macro-box-docker = pkgs.dockerTools.buildLayeredImage {
          name = "macro-box";
          tag = "latest";
          includeNixDB = true;
          config = {
            Entrypoint = [ "${container.config.system.build.toplevel}/init" ];
            Env = [
              "container=docker"
              # For `docker exec <id> systemctl ...`, which DockerFleet runs.
              "PATH=/run/wrappers/bin:/run/current-system/sw/bin"
            ];
            StopSignal = "SIGRTMIN+3";
          };
        };
      };
      checks = lib.optionalAttrs (system == "x86_64-linux") {
        # The baked adapter starts and answers ACP initialize offline.
        macro-box-claude-agent-acp =
          pkgs.runCommand "macro-box-claude-agent-acp-initialize" { nativeBuildInputs = [ pkgs.jq ]; }
            ''
              export HOME=$TMPDIR
              echo '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}' \
                | ${box.claudeAgentAcp}/node_modules/.bin/claude-agent-acp \
                | head -n 1 \
                | jq --exit-status '.result.agentInfo.version == "${box.claudeAgentAcp.version}"'
              touch $out
            '';
        macro-box = import ./_vm-test.nix {
          inherit pkgs;
          guest = {
            imports = [
              ./_guest.nix
              herdr
            ];
          };
          inherit (self'.packages) macrod;
        };
      };
    };
}
