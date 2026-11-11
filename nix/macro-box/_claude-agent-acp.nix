# The Claude Code ACP adapter macrod launches, installed from
# claude-agent-acp/package-lock.json so macrod never npm-installs it at first
# start. The version must equal macrod's pin; lock.sh regenerates the lock.
{ pkgs }:
let
  inherit (pkgs) lib;
  pin = builtins.readFile ../../crates/coding_agent_worker/src/tui/agent_catalog/claude_code.rs;
  pinned = builtins.elemAt (builtins.match ''.*"@agentclientprotocol/claude-agent-acp@([^"]+)".*'' pin) 0;
  package = lib.importJSON ./claude-agent-acp/package.json;
  lock = lib.importJSON ./claude-agent-acp/package-lock.json;
  # The SDK's optional per-platform Claude Code binaries are unused (macrod
  # points CLAUDE_CODE_EXECUTABLE at the image's claude) and ~200 MB each.
  packageLock = lock // {
    packages = lib.mapAttrs (_: module: removeAttrs module [ "optionalDependencies" ]) (
      lib.filterAttrs (_: module: !(module.optional or false)) lock.packages
    );
  };
in
assert lib.assertMsg (package.version == pinned)
  "claude-agent-acp ${package.version} does not match macrod's pin ${pinned}; run nix/macro-box/claude-agent-acp/lock.sh";
# An npm prefix: macrod runs <prefix>/node_modules/.bin/claude-agent-acp.
pkgs.importNpmLock.buildNodeModules {
  inherit package packageLock;
  nodejs = pkgs.nodejs_24;
  derivationArgs = {
    pname = "claude-agent-acp";
    npmInstallFlags = [ "--omit=optional" ];
    postInstall = "test -x $out/node_modules/.bin/claude-agent-acp";
    # The directory under ~/.macrod/adapters macrod looks for.
    passthru.adapterDirectory = "@agentclientprotocol/claude-agent-acp@${package.version}";
  };
}
