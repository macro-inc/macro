# Third-party platform components that nixpkgs does not package. Everything
# else (Postgres, Kafka, OpenSearch, Valkey, Traefik, Caddy, Mailpit,
# ElasticMQ) comes from nixpkgs directly; see components.nix.
{ pkgs }:
let
  inherit (pkgs) lib;
in
rec {
  # S3-compatible object storage (Apache-2.0). Upstream's static musl build.
  rustfs = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "rustfs";
    version = "1.0.4";
    src = pkgs.fetchurl {
      url = "https://github.com/rustfs/rustfs/releases/download/${version}/rustfs-linux-x86_64-musl-v${version}.zip";
      hash = "sha256-SSStS2mbn1mUMFHv7a4tHrbUysUDobA4TEsl98LDG1w=";
    };
    nativeBuildInputs = [ pkgs.unzip ];
    unpackPhase = "unzip $src";
    installPhase = ''
      install -Dm755 rustfs $out/bin/rustfs
    '';
    meta.license = lib.licenses.asl20;
  };

  # Self-hosted Workers and Durable Objects (Apache-2.0).
  celld = pkgs.stdenv.mkDerivation rec {
    pname = "celld";
    version = "0.6.3";
    src = pkgs.fetchurl {
      url = "https://github.com/denoland/celld/releases/download/v${version}/celld-x86_64-unknown-linux-gnu.gz";
      hash = "sha256-UISgg0cs8DZVGn6sY/ok0iu5pWMjxRf2MgVyTBJ4MEc=";
    };
    nativeBuildInputs = [ pkgs.autoPatchelfHook ];
    buildInputs = [ pkgs.stdenv.cc.cc.lib ];
    unpackPhase = "gunzip -c $src > celld";
    installPhase = ''
      install -Dm755 celld $out/bin/celld
    '';
    meta.license = lib.licenses.asl20;
  };

  # DynamoDB-compatible API on Postgres (Apache-2.0).
  extenddb = pkgs.rustPlatform.buildRustPackage rec {
    pname = "extenddb";
    version = "0.1.14";
    src = pkgs.fetchFromGitHub {
      owner = "ExtendDB";
      repo = "extenddb";
      rev = "v${version}";
      hash = "sha256-h1jUoIXGXZtQB7fNHfk0KWPttnje0S8O69a1nzJEpUU=";
    };
    cargoLock.lockFile = "${src}/Cargo.lock";
    cargoBuildFlags = [ "--bin" "extenddb" ];
    nativeBuildInputs = [ pkgs.pkg-config pkgs.cmake pkgs.protobuf ];
    buildInputs = [ pkgs.openssl ];
    doCheck = false;
    meta.license = lib.licenses.asl20;
  };

  # AWS KMS API emulator for local and non-prod instances (MIT). Prod uses
  # OpenBao Transit behind the KMS port instead.
  local-kms = pkgs.buildGoModule rec {
    pname = "local-kms";
    version = "3.12.0";
    src = pkgs.fetchFromGitHub {
      owner = "nsmithuk";
      repo = "local-kms";
      rev = version;
      hash = "sha256-N71papZZK6rxmborp9I+RAgBefsvxeDXKcQHNE/3jRs=";
    };
    vendorHash = "sha256-ZkQuE+4rU/mOnlN0GKywcBAh6N0ar8CcsE6jVEORNYQ=";
    doCheck = false;
    meta.license = lib.licenses.mit;
  };

  # FusionAuth's start.sh deletes the xmldsig `disallowAlg` lines from the
  # JDK's java.security at every boot (SAML with SHA-1 signatures). The store
  # is read-only, so make that edit once, on a JDK of its own.
  fusionauthJdk = pkgs.runCommand "fusionauth-jdk" { nativeBuildInputs = [ pkgs.patchelf ]; } ''
    cp -r ${pkgs.jdk21_headless}/lib/openjdk $out
    chmod -R u+w $out
    # The copy must load its own libraries. Otherwise libnio links the original
    # libnet beside this one, and only one of them learns IPv6 is available.
    # On a Nix host the two are hardlinks, which ld.so merges; in an image they
    # are separate files, and the JVM then fails to bind "::".
    find $out/bin $out/lib -type f \( -name '*.so' -o -perm -u+x \) | while read -r f; do
      rpath=$(patchelf --print-rpath "$f" 2>/dev/null) || continue
      patchelf --set-rpath "''${rpath//${pkgs.jdk21_headless}\/lib\/openjdk/$out}" "$f"
    done
    sed -i -E '/^.*disallowAlg.*xmldsig.*$/d' $out/conf/security/java.security
  '';

  # Identity provider. Already self-hosted; runs on nixpkgs' JDK.
  fusionauth = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "fusionauth";
    version = "1.62.1";
    src = pkgs.fetchurl {
      url = "https://files.fusionauth.io/products/fusionauth/${version}/fusionauth-app-${version}.zip";
      hash = "sha256-R5ZNJ7EY7tg4zeSOzxUtaggxKYhR26Z1n5xgbaXKQ2o=";
    };
    nativeBuildInputs = [ pkgs.unzip pkgs.makeWrapper ];
    unpackPhase = "mkdir fusionauth && unzip -q $src -d fusionauth";
    installPhase = ''
      mkdir -p $out/share
      cp -r fusionauth $out/share/fusionauth
      # start.sh derives its writable base (data, logs, config) from its own
      # physical path, which is the read-only store; let the image choose.
      substituteInPlace $out/share/fusionauth/fusionauth-app/bin/start.sh \
        --replace-fail 'cd "''${SCRIPT_DIR}/../.."' 'cd "''${FUSIONAUTH_BASE:-''${SCRIPT_DIR}/../..}"' \
        --replace-fail "sed -i -E '/^.*disallowAlg.*xmldsig.*\$/d' \"\''${JAVA_HOME}/conf/security/java.security\"" ":"
      makeWrapper $out/share/fusionauth/fusionauth-app/bin/start.sh $out/bin/fusionauth \
        --set JAVA_HOME ${fusionauthJdk} \
        --prefix PATH : ${lib.makeBinPath [ fusionauthJdk pkgs.bash pkgs.coreutils pkgs.gnugrep pkgs.gnused ]}
    '';
  };
}
