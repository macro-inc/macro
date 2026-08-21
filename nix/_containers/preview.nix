# Fly preview VM image and the scratch hot-update carrier.
#
# Replaces `infra/preview/Dockerfile` and `infra/preview/update.Dockerfile`.
# CI stages a context directory and passes it as `src`. The machine runs an
# inner dockerd, so the image includes Docker plus the FHS bits dockerd needs.
{
  pkgs,
  src,
}:
let
  inherit (pkgs.dockerTools) buildLayeredImage;

  previewContents = with pkgs; [
    bashInteractive
    cacert
    coreutils
    curl
    docker
    docker-compose
    doppler
    e2fsprogs
    findutils
    gawk
    gnugrep
    gnupg
    gnused
    gzip
    iproute2
    iptables
    jq
    kmod
    procps
    shadow
    util-linux
  ];

  preview = buildLayeredImage {
    name = "macro-preview";
    tag = "latest";
    contents = previewContents ++ [
      pkgs.dockerTools.fakeNss
      pkgs.dockerTools.binSh
      pkgs.dockerTools.usrBinEnv
      pkgs.dockerTools.caCertificates
    ];
    extraCommands = ''
      mkdir -p ./srv/macro ./var/lib/docker ./var/log ./var/run ./run ./tmp ./etc/docker
      chmod 1777 ./tmp
      cp -a ${src}/. ./srv/macro/
      chmod +x ./srv/macro/entrypoint.sh ./srv/macro/bin/xtask ./srv/macro/bin/hot-update || true
    '';
    config = {
      Entrypoint = [ "/srv/macro/entrypoint.sh" ];
      ExposedPorts = {
        "8090/tcp" = { };
      };
      Env = [
        "MACRO_REPO_ROOT=/srv/macro/repo"
        "MACRO_STACK_SNAPSHOT_DIR=/srv/macro/artifacts/snapshots"
        "PATH=/bin:/usr/bin"
        "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
      ];
    };
  };

  update = buildLayeredImage {
    name = "macro-preview-update";
    tag = "latest";
    contents = [ ];
    extraCommands = ''
      mkdir -p ./update
      cp -a ${src}/bin/xtask ./update/xtask
      cp -a ${src}/preload/manifest.txt ./update/manifest.txt
      cp -a ${src}/deployment.json ./update/deployment.json
      cp -a ${src}/artifacts/frontend-dist ./update/frontend-dist
      cp -a ${src}/artifacts/binaries ./update/binaries
      chmod +x ./update/xtask
    '';
    config.Cmd = [ "/update/xtask" ];
  };
in
{
  docker-image-preview = preview;
  docker-image-preview-update = update;
}
