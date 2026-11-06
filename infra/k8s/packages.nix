{
  pkgs,
  packages,
  platformLib,
  nix2container,
  crane,
  fenix,
  devBootstrap ? null,
}:
let
  inherit (pkgs) lib;
  n2c = nix2container.packages.${pkgs.stdenv.hostPlatform.system}.nix2container;
  upstream = builtins.fromJSON (builtins.readFile ./upstream/images.json);
  source = lib.cleanSourceWith {
    src = ../..;
    filter =
      path: type:
      let
        rel = lib.removePrefix (toString ../.. + "/") (toString path);
        allowed = builtins.any (prefix: rel == prefix || lib.hasPrefix (prefix + "/") rel) [
          "apps"
          "packages"
          "services"
        ];
      in
      (
        rel == ""
        || allowed
        || builtins.elem rel [
          "package.json"
          "bun.lock"
          "bunfig.toml"
          "tsconfig.json"
        ]
      )
      && !(builtins.any (x: lib.hasInfix x rel) [
        "/node_modules"
        "/target"
        "/.git"
        "/dist"
      ]);
  };
in
rec {
  # Canonical external backends are pinned by their native-platform manifests.
  # Every layer has its own fixed hash; nix2container publishes only missing layers.
  upstreamImage =
    name: registry:
    let
      spec = upstream.${name};
      base = n2c.pullImageFromManifest {
        inherit (spec) imageName imageTag;
        imageManifest = ./upstream + "/${name}.json";
      };
      drv = n2c.buildImage {
        name = "${registry}/macro/${name}";
        fromImage = base;
        fromImageEnv = true;
        config = {
          Entrypoint = [
            "${pkgs.dumb-init}/bin/dumb-init"
            "--"
          ]
          ++ spec.entrypoint;
          Cmd = spec.cmd;
          WorkingDir = spec.workingDir;
          User = spec.user;
        };
      };
    in
    drv // { ref = drv.imageRefUnsafe; };

  inherit
    (import ./node.nix {
      inherit
        pkgs
        packages
        source
        ;
    })
    workspace
    lexical
    websocket
    searchBootstrap
    ;
  sync = (
    import ./sync.nix {
      inherit
        pkgs
        crane
        fenix
        packages
        ;
    }
  );
  utilityImages = {
    volume-permissions = platformLib.image {
      name = "volume-permissions";
      entrypoint = [ "/bin/true" ];
    };
    readiness = platformLib.image {
      name = "readiness";
      contents = [ pkgs.kubectl ];
      entrypoint = [ "/bin/true" ];
    };
    network-wait = platformLib.image {
      name = "network-wait";
      entrypoint = [ "/bin/true" ];
    };
  };
  bootstrap = (
    if devBootstrap == null then
      import ./rust.nix { inherit pkgs crane fenix; }
    else
      platformLib.wrapBinary {
        name = "xtask_local";
        binary = builtins.path {
          path = devBootstrap;
          name = "kube-bootstrap-binary";
        };
      }
  );
  localstackImage =
    registry:
    let
      base = upstreamImage "localstack" registry;
      ready = pkgs.writeShellScript "macro-localstack-ready" ''
        exec ${bootstrap}/bin/xtask_local localstack-provision
      '';
      root = pkgs.runCommand "localstack-init" { } ''
        mkdir -p $out/etc/localstack/init/ready.d
        ln -s ${ready} $out/etc/localstack/init/ready.d/10-macro.sh
      '';
      drv = n2c.buildImage {
        name = "${registry}/macro/localstack-ready";
        fromImage = base;
        fromImageEnv = true;
        copyToRoot = [ root ];
        config = {
          Entrypoint = [ "docker-entrypoint.sh" ];
          WorkingDir = "/opt/code/localstack";
        };
      };
    in
    drv // { ref = drv.imageRefUnsafe; };

  postgres = pkgs.postgresql_18.withPackages (p: [ p.pgvector ]);
  sqlx = pkgs.sqlx-cli;
  migrations = ../../crates/macro_db_client/migrations;
  # The build has no live credentials: it initializes over a private Unix socket.
  # Runtime credentials enter only after the copied seed has started in its PVC.
  postgresSeed =
    pkgs.runCommand "macro-postgres-seed"
      {
        nativeBuildInputs = [
          postgres
          sqlx
        ];
        LOCALE_ARCHIVE = "${pkgs.glibcLocales}/lib/locale/locale-archive";
      }
      ''
        export PGHOST=$TMPDIR/socket PGPORT=5432 PGUSER=builder
        mkdir -p "$PGHOST"
        initdb -D "$TMPDIR/data" --locale=en_US.UTF-8 --encoding=UTF8 --auth=trust --username=builder > /dev/null
        pg_ctl -D "$TMPDIR/data" -o "-c listen_addresses= -k $PGHOST -c shared_preload_libraries=pg_stat_statements" -w start > /dev/null
        trap 'pg_ctl -D "$TMPDIR/data" -m immediate stop >/dev/null 2>&1 || true' EXIT
        psql postgres -v ON_ERROR_STOP=1 -c 'CREATE ROLE "user" LOGIN SUPERUSER;'
        createdb -O user macrodb
        DATABASE_URL="postgresql://builder@localhost/macrodb?host=$PGHOST" sqlx migrate run --source ${migrations}
        pg_ctl -D "$TMPDIR/data" -m fast -w stop > /dev/null
        trap - EXIT
        mkdir -p $out
        cp -a "$TMPDIR/data/." $out/
        rm -f $out/postmaster.pid $out/postmaster.opts
      '';

  # Reuse the existing frontend's Rust/Wasm derivations and dependency package,
  # changing only browser-local configuration and the Vite runtime.
  frontend = (
    packages.tauri-frontend.overrideAttrs (old: {
      pname = "macro-kubernetes-frontend";
      nativeBuildInputs = old.nativeBuildInputs ++ [ pkgs.nodejs ];
      VITE_POSTHOG_API_KEY = "";
      VITE_LOCAL_SERVERS = "ALL";
      VITE_LOCAL_BACKEND_ORIGIN = "same-origin";
      VITE_LOCAL_ONLY = "true";
      VITE_AI_EDITING_WORKER_URL = "/ai-editing";
      NODE_OPTIONS = "--max-old-space-size=16384";
      # A commit id in the image would make committed manifests change again
      # immediately after committing them. The content-addressed tag is the revision.
      buildPhase = lib.concatStringsSep "\n" (
        map (
          line:
          if lib.hasInfix "> dist/semver.txt" line then
            "printf '${old.version}+local-kubernetes\\n' > dist/semver.txt"
          else
            builtins.replaceStrings
              [ "MODE=production" "bun ../../node_modules/vite/bin/vite.js" ]
              [ "MODE=development" "node ../../node_modules/vite/bin/vite.js" ]
              line
        ) (lib.splitString "\n" old.buildPhase)
      );
    })
  );
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
      patchelf --set-rpath "$(echo "$rpath" | sed "s|${pkgs.jdk21_headless}/lib/openjdk|$out|g")" "$f"
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
    nativeBuildInputs = [
      pkgs.unzip
      pkgs.makeWrapper
    ];
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
        --prefix PATH : ${
          lib.makeBinPath [
            fusionauthJdk
            pkgs.bash
            pkgs.coreutils
            pkgs.gnugrep
            pkgs.gnused
          ]
        }
    '';
  };
}
