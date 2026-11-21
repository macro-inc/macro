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
          {
            macro.box.macrod = self'.packages.macro-box-macrod;
            macro.box.harnessd.package = self'.packages.macro-box-harnessd;
          }
        ];
      }
    );
  # An agent teammate's computer: the same guest without macro's sudo and
  # docker (agentMode).
  agentMode = image: {
    imports = [ image ];
    macro.box.agentMode = true;
  };
  container = guest ./_container.nix;
  firecracker = guest {
    imports = [ ./_firecracker.nix ];
    macro.box.firecracker.guestAgent = withSystem system (
      { self', ... }: self'.packages.firecracker-guest-agent
    );
  };
  agentContainer = guest (agentMode ./_container.nix);
  box = container.config.macro.box;
in
{
  flake.nixosConfigurations.macro-box = container;
  flake.nixosConfigurations.macro-box-firecracker = firecracker;

  perSystem =
    {
      system,
      self',
      lib,
      pkgs,
      ...
    }:
    let
      # `docker load < result` → <name>:latest; run as DockerFleet does
      # (AGENTS.md).
      dockerImage =
        name: nixos:
        pkgs.dockerTools.buildLayeredImage {
          inherit name;
          tag = "latest";
          includeNixDB = true;
          config = {
            Entrypoint = [ "${nixos.config.system.build.toplevel}/init" ];
            Env = [
              "container=docker"
              # For `docker exec <id> systemctl ...`, which DockerFleet runs.
              "PATH=/run/wrappers/bin:/run/current-system/sw/bin"
            ];
            StopSignal = "SIGRTMIN+3";
          };
        };
      # What the Firecracker host boots: `vmlinux`, `rootfs.ext4` (the first
      # drive) and `boot_args`.
      firecrackerImage =
        name: nixos:
        let
          rootfs = import "${inputs.nixpkgs}/nixos/lib/make-disk-image.nix" {
            inherit pkgs lib;
            inherit (nixos) config;
            partitionTableType = "none";
            installBootLoader = false;
            format = "raw";
            additionalSpace = "2G";
            baseName = "rootfs";
          };
        in
        pkgs.runCommand name { } ''
          mkdir $out
          ln -s ${nixos.config.boot.kernelPackages.kernel.dev}/vmlinux $out/vmlinux
          ln -s ${rootfs}/rootfs.img $out/rootfs.ext4
          echo ${lib.escapeShellArg (lib.concatStringsSep " " nixos.config.macro.box.firecracker.kernelParams)} > $out/boot_args
        '';
    in
    {
      packages = lib.optionalAttrs (system == "x86_64-linux") {
        macro-box-claude-code = box.claudeCode;
        macro-box-claude-agent-acp = box.claudeAgentAcp;
        macro-agent-runtime = box.agent.runtime;
        macro-box-computer-use-linux = box.agent.computerUse.package;
        macro-box-docker = dockerImage "macro-box" container;
        macro-box-firecracker = firecrackerImage "macro-box-firecracker" firecracker;
        macro-box-agent-docker = dockerImage "macro-box-agent" agentContainer;
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
        # agentMode takes the macro user's sudo rule and docker group away.
        macro-box-agent-mode =
          let
            agent = (guest ./_container.nix).extendModules {
              modules = [ { macro.box.agentMode = true; } ];
            };
            groups = agent.config.users.users.macro.extraGroups;
            macroSudo = builtins.filter (
              rule: builtins.elem "macro" rule.users
            ) agent.config.security.sudo.extraRules;
          in
          assert lib.assertMsg (
            !(builtins.elem "docker" groups) && !(builtins.elem "wheel" groups)
          ) "agentMode leaves macro in ${builtins.toJSON groups}";
          assert lib.assertMsg (macroSudo == [ ]) "agentMode leaves a sudo rule for macro";
          pkgs.runCommand "macro-box-agent-mode" { } "touch $out";
        macro-box = import ./_vm-test.nix {
          inherit pkgs;
          guest = {
            imports = [
              ./_guest.nix
              herdr
            ];
            # Never written, so enrollment fails with its reason.
            macro.box.enrollFrom = lib.mkDefault "file:/run/macro/enrollment.json";
          };
          macrod = self'.packages.macro-box-macrod;
          harnessd = self'.packages.macro-box-harnessd;
        };
        macro-box-firecracker-restore = import ./_firecracker-test.nix {
          inherit pkgs;
          guest = {
            imports = [
              ./_guest.nix
              herdr
            ];
          };
          macrod = self'.packages.macro-box-macrod;
          harnessd = self'.packages.macro-box-harnessd;
        };
        macro-box-claude-wrapper = import ./_claude-wrapper-test.nix { inherit pkgs; };
        # start-agent's boot (lock adoption, rollback) and agent-stopped's
        # failure count, against local git repositories.
        macro-box-boot = pkgs.runCommand "macro-box-boot" {
          nativeBuildInputs = [
            pkgs.bash
            pkgs.bun
            pkgs.git
            pkgs.diffutils
            pkgs.gnused
            pkgs.coreutils
            pkgs.gnugrep
          ];
        } "bash ${./files}/test-start-agent.sh && touch $out";
      };
    };
}
