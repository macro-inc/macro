# Shared dockerTools constructor for local-stack infra images.
#
# Every image is built from Nixpkgs packages (plus FODs for upstream
# tarballs that nixpkgs does not pin). Nothing here uses `fromImage` or a
# registry base.
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

  fhsLibs = with pkgs; [
    glibc
    libgcc
    zlib
  ];

  baseContents = [
    fakeNss
    binSh
    usrBinEnv
    caCertificates
    pkgs.cacert
    pkgs.coreutils
    pkgs.bash
    pkgs.dumb-init
    pkgs.curl
    pkgs.gnugrep
  ]
  ++ fhsLibs;

  basePath = [
    pkgs.coreutils
    pkgs.bash
    pkgs.curl
    pkgs.gnugrep
    pkgs.gnused
  ];

  # fakeNss files are 0444 store links; copy before appending users.
  writablePasswd = ''
    if [ -e ./etc/passwd ]; then
      cp --remove-destination "$(readlink -f ./etc/passwd)" ./etc/passwd
      chmod u+w ./etc/passwd
    fi
    if [ -e ./etc/group ]; then
      cp --remove-destination "$(readlink -f ./etc/group)" ./etc/group
      chmod u+w ./etc/group
    fi
  '';

  mk =
    {
      name,
      tag ? "dev",
      extraContents ? [ ],
      extraCommands ? "",
      extraEnv ? [ ],
      extraPath ? [ ],
      config ? { },
    }:
    let
      spec = {
        inherit name tag;
        contents = baseContents ++ extraContents;
        extraCommands = ''
          mkdir -p ./tmp ./var/tmp ./run ./app ./bin ./usr/bin ./opt
          chmod 1777 ./tmp ./var/tmp
          ln -sf ${pkgs.bash}/bin/bash ./bin/bash
          ln -sf ${pkgs.bash}/bin/bash ./usr/bin/bash
        ''
        + extraCommands;
        config =
          {
            Entrypoint = [
              "${pkgs.dumb-init}/bin/dumb-init"
              "--"
            ];
            Env = [
              "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              "PATH=${lib.makeBinPath (basePath ++ extraPath)}:/bin:/usr/bin"
              "LD_LIBRARY_PATH=${lib.makeLibraryPath fhsLibs}"
            ]
            ++ extraEnv
            ++ (config.Env or [ ]);
          }
          // (builtins.removeAttrs config [ "Env" ]);
      };
    in
    {
      inherit spec;
      image = buildLayeredImage spec;
      stream = streamLayeredImage spec;
      ref = "${name}:${tag}";
    };
in
{
  inherit
    mk
    writablePasswd
    fhsLibs
    buildLayeredImage
    streamLayeredImage
    ;
}
