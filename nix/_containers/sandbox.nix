# Agent-sandbox images (agent harness + coding-agent-worker).
#
# Replaces the Ubuntu+Determinate-Nix Dockerfiles: sidecar from Cargo.lock,
# sandbox tools from nixpkgs, no nested `nix develop` bake.
{
  pkgs,
}:
let
  inherit (pkgs) lib;
  inherit (pkgs.dockerTools)
    buildLayeredImage
    fakeNss
    binSh
    usrBinEnv
    caCertificates
    ;

  sidecar =
    src: lock:
    pkgs.rustPlatform.buildRustPackage {
      pname = "acp-sidecar";
      version = "0.1.0";
      inherit src;
      cargoLock.lockFile = lock;
      doCheck = false;
    };

  harnessSidecar = sidecar ../../crates/agent_harness/container/sidecar ../../crates/agent_harness/container/sidecar/Cargo.lock;
  codingSidecar = sidecar ../../services/coding-agent-worker/container/sidecar ../../services/coding-agent-worker/container/sidecar/Cargo.lock;

  sandboxTools = with pkgs; [
    bashInteractive
    cacert
    coreutils
    curl
    git
    gh
    gnused
    nodejs_22
    openssh
    sudo
    xz
  ]
  ++ lib.optional (pkgs ? opencode) pkgs.opencode
  ++ lib.optional (pkgs ? github-mcp-server) pkgs.github-mcp-server;

  repoDevEnv = pkgs.writeText "repo-dev-env.sh" ''
    export SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
    export NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
  '';

  mkSandbox =
    {
      name,
      sidecarBin,
      extraFiles,
    }:
    buildLayeredImage {
      inherit name;
      tag = "dev";
      contents = [
        fakeNss
        binSh
        usrBinEnv
        caCertificates
        pkgs.cacert
      ]
      ++ sandboxTools;
      extraCommands = extraFiles;
      config = {
        Cmd = [ "${pkgs.bashInteractive}/bin/bash" ];
        Env = [
          "PATH=/bin:/usr/bin"
          "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
          "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
          "SHELL=${pkgs.bashInteractive}/bin/bash"
        ];
      };
    };

in
{
  docker-image-agent-harness-sandbox = mkSandbox {
    name = "macro-agent-harness-sandbox";
    sidecarBin = harnessSidecar;
    extraFiles = ''
      mkdir -p ./opt ./env ./etc/macro-agent ./root/.config/opencode
      cp ${harnessSidecar}/bin/acp-sidecar ./opt/acp-sidecar
      chmod +x ./opt/acp-sidecar
      cp ${repoDevEnv} ./env/repo-dev-env.sh
      cp ${repoDevEnv} ./env/dev-env.sh
      cp ${../../crates/agent_harness/container/SYSTEM.md} ./etc/macro-agent/SYSTEM.md
      cp ${../../crates/agent_harness/container/opencode.json} ./root/.config/opencode/opencode.json
    '';
  };

  docker-image-coding-agent-sandbox = mkSandbox {
    name = "macro-coding-agent-sandbox";
    sidecarBin = codingSidecar;
    extraFiles = ''
      mkdir -p ./opt ./env ./root/.config/opencode
      cp ${codingSidecar}/bin/acp-sidecar ./opt/acp-sidecar
      chmod +x ./opt/acp-sidecar
      cp ${repoDevEnv} ./env/repo-dev-env.sh
      cp ${repoDevEnv} ./env/dev-env.sh
      cp ${../../services/coding-agent-worker/container/ensure.sh} ./opt/ensure.sh
      chmod +x ./opt/ensure.sh
      cp ${../../services/coding-agent-worker/container/opencode.json} ./root/.config/opencode/opencode.json
    '';
  };
}
