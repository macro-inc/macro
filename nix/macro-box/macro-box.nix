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
  # An agent teammate's computer: the same guest without macro's sudo and
  # docker (agentMode).
  agentMode = image: {
    imports = [ image ];
    macro.box.agentMode = true;
  };
  machine = guest ./_image.nix;
  container = guest ./_container.nix;
  agentMachine = guest (agentMode ./_image.nix);
  agentContainer = guest (agentMode ./_container.nix);
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
    let
      # What `incus image import` takes.
      incusImage =
        name: nixos:
        pkgs.runCommand name { } ''
          mkdir $out
          ln -s ${nixos.config.system.build.metadata}/tarball/*.tar.xz $out/metadata.tar.xz
          ln -s ${nixos.config.system.build.qemuImage}/nixos.qcow2 $out/disk.qcow2
        '';
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
    in
    {
      packages = lib.optionalAttrs (system == "x86_64-linux") {
        macro-box-claude-code = box.claudeCode;
        macro-box-claude-agent-acp = box.claudeAgentAcp;
        macro-agent-runtime = box.agent.runtime;
        macro-box-computer-use-linux = box.agent.computerUse.package;
        macro-box-incus = incusImage "macro-box-incus" machine;
        macro-box-docker = dockerImage "macro-box" container;
        macro-box-agent = incusImage "macro-box-agent" agentMachine;
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
          };
          inherit (self'.packages) macrod;
        };
      };
    };
}
