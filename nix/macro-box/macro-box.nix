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
      packages = lib.optionalAttrs (system == "x86_64-linux") {
        macro-box-claude-code = box.claudeCode;
        macro-box-claude-agent-acp = box.claudeAgentAcp;
        macro-box-rootfs = box.rootfs;
        macro-box-config = box.config.artifacts;
        macro-box-incus = box.incus;
        macro-box-docker = box.docker;
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
      };
    };
}
