# Local-stack auxiliary images: Node/Bun runtime, OpenSSH webhook relay.
#
# JS services bind-mount the repo (see `nix/_arion/aux.nix`) and run from this
# shared runtime. The relay is a complete image — no build context.
{ pkgs }:
let
  inherit (pkgs) lib;
  inherit (pkgs.dockerTools)
    buildLayeredImage
    streamLayeredImage
    fakeNss
    binSh
    usrBinEnv
    caCertificates
    ;

  # Host-installed workerd (wrangler) is FHS-linked against
  # `/lib64/ld-linux-x86-64.so.2`. glibc in contents materialises that path.
  fhsLibs = with pkgs; [
    glibc
    libgcc
    zlib
  ];

  nodeBunContents = [
    fakeNss
    binSh
    usrBinEnv
    caCertificates
    pkgs.cacert
    pkgs.coreutils
    pkgs.bash
    pkgs.dumb-init
    pkgs.nodejs_22
    pkgs.bun
  ]
  ++ fhsLibs;

  nodeBunEnv = [
    "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    "PATH=/bin:/usr/bin"
    "LD_LIBRARY_PATH=${lib.makeLibraryPath fhsLibs}"
  ];

  nodeBunImage =
    {
      name,
      tag,
      extraContents ? [ ],
      extraConfig ? { },
    }:
    {
      inherit name tag;
      contents = nodeBunContents ++ extraContents;
      extraCommands = ''
        mkdir -p ./app
      '';
      config = {
        Entrypoint = [
          "${pkgs.dumb-init}/bin/dumb-init"
          "--"
        ];
        WorkingDir = "/app";
        Env = nodeBunEnv;
      }
      // extraConfig;
    };

  nodeBun = nodeBunImage {
    name = "macro-local-node-bun";
    tag = "dev";
  };

  sshdConfig = pkgs.writeText "sdk-webhook-sshd_config" ''
    Port 22
    PermitRootLogin no
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PubkeyAuthentication yes
    StrictModes no
    AuthorizedKeysFile /etc/ssh/authorized_keys/%u
    AllowTcpForwarding remote
    GatewayPorts clientspecified
    PidFile /run/sshd.pid
    HostKey /etc/ssh/ssh_host_ed25519_key
  '';

  sshdEntrypoint = pkgs.writeShellScriptBin "sdk-webhook-sshd" ''
    set -euo pipefail
    mkdir -p /etc/ssh/authorized_keys /run
    if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
      ${pkgs.openssh}/bin/ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N ""
    fi
    exec ${pkgs.openssh}/bin/sshd -D -e -f ${sshdConfig}
  '';

  sdkWebhook = {
    name = "macro-sdk-webhook-relay";
    tag = "dev";
    contents = [
      fakeNss
      binSh
      usrBinEnv
      pkgs.coreutils
      pkgs.openssh
      sshdEntrypoint
    ];
    extraCommands = ''
      mkdir -p ./etc/ssh/authorized_keys ./run ./var/empty/sshd
      chmod 755 ./var/empty ./var/empty/sshd
      if [ -e ./etc/passwd ]; then
        cp --remove-destination "$(readlink -f ./etc/passwd)" ./etc/passwd
        chmod u+w ./etc/passwd
      fi
      if [ -e ./etc/group ]; then
        cp --remove-destination "$(readlink -f ./etc/group)" ./etc/group
        chmod u+w ./etc/group
      fi
      echo 'sshd:x:74:74:Privilege-separated SSH:/var/empty/sshd:/sbin/nologin' >> ./etc/passwd
      echo 'sshd:x:74:' >> ./etc/group
      echo 'sdk-webhook:x:1000:1000:sdk-webhook:/:/bin/false' >> ./etc/passwd
      echo 'sdk-webhook:x:1000:' >> ./etc/group
    '';
    config = {
      Cmd = [ "${sshdEntrypoint}/bin/sdk-webhook-sshd" ];
      ExposedPorts = {
        "22/tcp" = { };
      };
    };
  };
in
{
  nodeBunRef = "macro-local-node-bun:dev";
  sdkWebhookRef = "macro-sdk-webhook-relay:dev";

  docker-image-local-node-bun = buildLayeredImage nodeBun;
  stream-docker-image-local-node-bun = streamLayeredImage nodeBun;
  docker-image-sdk-webhook-relay = buildLayeredImage sdkWebhook;
  stream-docker-image-sdk-webhook-relay = streamLayeredImage sdkWebhook;

  inherit nodeBunContents nodeBunEnv nodeBunImage;
}
