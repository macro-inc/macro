# Shared dockerTools runtime used by the local stack and baked service images.
#
# Zigbuild binaries are FHS-linked. Nix/crane binaries keep their `/nix/store`
# interpreter and need that store bind-mounted (see `BinariesDir::NixStore`).
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

  fhs = pkgs.callPackage ./fhs.nix { };

  runtimeLibs = with pkgs; [
    glibc
    libgcc
    openssl.out
    zlib
    curl.out
  ];

  contents = [
    fakeNss
    binSh
    usrBinEnv
    caCertificates
    pkgs.cacert
    pkgs.coreutils
    pkgs.dumb-init
    pkgs.curl
  ]
  ++ runtimeLibs;

  env = [
    "PORT=8080"
    "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    "LD_LIBRARY_PATH=${lib.makeLibraryPath runtimeLibs}"
    "PATH=/bin:/usr/bin"
  ];

  config = {
    Entrypoint = [
      "${pkgs.dumb-init}/bin/dumb-init"
      "--"
    ];
    WorkingDir = "/app";
    ExposedPorts = {
      "8080/tcp" = { };
    };
    Env = env;
  };

  mkImage =
    {
      name,
      tag,
      extraContents ? [ ],
      extraEnv ? [ ],
      extraConfig ? { },
    }:
    let
      mergedEnv = env ++ extraEnv ++ (extraConfig.Env or [ ]);
      mergedConfig = (config // extraConfig) // {
        Env = mergedEnv;
      };
    in
    {
      inherit name tag;
      contents = contents ++ extraContents;
      extraCommands = fhs.extraCommands;
      config = mergedConfig;
    };
in
{
  imageName = "macro-local-runtime";
  imageTag = "dev";
  imageRef = "macro-local-runtime:dev";

  image = buildLayeredImage (mkImage {
    name = "macro-local-runtime";
    tag = "dev";
  });

  stream = streamLayeredImage (mkImage {
    name = "macro-local-runtime";
    tag = "dev";
  });

  inherit mkImage contents env runtimeLibs;
}
