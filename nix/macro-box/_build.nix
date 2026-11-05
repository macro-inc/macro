# The macro-box guest: one Ubuntu 24.04 rootfs built from hash-pinned debs,
# packed as an Incus VM image and as a Docker image. Not a flake-parts
# module (import-tree skips `_` paths); `macro-box.nix` calls it.
{ pkgs, macrod }:
let
  inherit (pkgs) lib;
  lock = lib.importJSON ./debs.lock.json;

  fetchDeb =
    deb:
    pkgs.fetchurl {
      inherit (deb) url hash;
      # Store path names cannot contain `~`.
      name = builtins.replaceStrings [ "~" ] [ "_" ] deb.file;
    };
  debs = pkgs.linkFarm "macro-box-debs" (
    map (deb: {
      name = deb.file;
      path = fetchDeb deb;
    }) lock.debs
  );
  efiDebs = map fetchDeb lock.efi;

  chromeDevtoolsMcp = pkgs.stdenvNoCC.mkDerivation rec {
    pname = "chrome-devtools-mcp";
    version = "1.12.0";
    # The npm package bundles its dependencies.
    src = pkgs.fetchurl {
      url = "https://registry.npmjs.org/chrome-devtools-mcp/-/chrome-devtools-mcp-${version}.tgz";
      hash = "sha512-lAGpH0zXT1ZdaPefP1KK/MvxwihOlu7VGQ7p4wbhD9OhN17vUC4KWk/ImUYR9DE4s+7r4r0ySV4xr2OkTa7ZMA==";
    };
    nativeBuildInputs = [ pkgs.makeWrapper ];
    installPhase = ''
      mkdir -p $out/lib/chrome-devtools-mcp
      cp -r . $out/lib/chrome-devtools-mcp
      makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/chrome-devtools-mcp \
        --add-flags $out/lib/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js
    '';
  };

  brain = import ./_brain.nix { inherit pkgs; };
  claudeCode = import ./_claude-code.nix { inherit pkgs; };

  # Linked into /usr/local/bin; the closure is copied into the guest's
  # /nix/store.
  tools = pkgs.buildEnv {
    name = "macro-box-tools";
    paths = [
      macrod
      brain
      claudeCode
      pkgs.chromium
      pkgs.nodejs_22
      pkgs.herdr
      chromeDevtoolsMcp
    ];
    pathsToLink = [ "/bin" ];
  };
  closure = pkgs.closureInfo { rootPaths = [ tools ]; };

  # Fixed so fstab and grub.cfg can name the filesystems.
  rootUuid = "6d61f6b2-7b8e-4c1a-9d0e-6d6163726f30";
  espVolumeId = "4D414352";
  espUuid = "4D41-4352";

  rootfs =
    pkgs.runCommand "macro-box-rootfs"
      {
        nativeBuildInputs = [
          pkgs.dpkg
          pkgs.util-linux
          pkgs.gnutar
          pkgs.coreutils
          pkgs.findutils
        ];
        DEBS = debs;
        BASE = pkgs.writeText "macro-box-base-debs" (
          lib.concatMapStrings (deb: deb.file + "\n") (lib.filter (deb: deb.base) lock.debs)
        );
        FILES = ./files;
        SKILLS = ./skills;
        CLOSURE = closure;
        TOOLS = tools;
        ROOT_UUID = rootUuid;
        ESP_UUID = espUuid;
      }
      ''
        unshare --user --map-root-user --mount bash ${./rootfs.sh}
      '';

  grubCfg = pkgs.writeText "grub.cfg" ''
    set timeout=0
    search --no-floppy --fs-uuid --set=root ${rootUuid}
    linux /boot/vmlinuz root=UUID=${rootUuid} ro console=tty1 console=ttyS0
    initrd /boot/initrd.img
    boot
  '';

  metadata = pkgs.writeText "metadata.yaml" ''
    architecture: x86_64
    creation_date: 1793836800
    properties:
      architecture: amd64
      description: Macro computer (Ubuntu 24.04, snapshot ${lock.snapshot})
      os: Ubuntu
      release: noble
      variant: macro-box
      serial: "${lock.snapshot}"
    templates: {}
  '';

  incus =
    pkgs.runCommand "macro-box-incus"
      {
        nativeBuildInputs = [
          pkgs.e2fsprogs
          pkgs.dosfstools
          pkgs.mtools
          pkgs.gptfdisk
          pkgs.qemu-utils
          pkgs.dpkg
          pkgs.gnutar
          pkgs.xz
        ];
        # mke2fs loads libarchive at runtime to read `-d rootfs.tar`.
        LD_LIBRARY_PATH = "${pkgs.libarchive.lib}/lib";
      }
      ''
        for deb in ${lib.concatStringsSep " " efiDebs}; do dpkg-deb -x "$deb" efi; done

        espMiB=256
        tarMiB=$(( $(stat -c %s ${rootfs}/rootfs.tar) / 1048576 ))
        rootMiB=$(( tarMiB + tarMiB / 4 + 1024 ))

        mkfs.vfat -C -F 32 -n ESP -i ${espVolumeId} esp.img $(( espMiB * 1024 ))
        mmd -i esp.img ::/EFI ::/EFI/BOOT ::/EFI/ubuntu
        mcopy -i esp.img efi/usr/lib/shim/shimx64.efi.signed.latest ::/EFI/BOOT/BOOTX64.EFI
        mcopy -i esp.img efi/usr/lib/shim/mmx64.efi ::/EFI/BOOT/mmx64.efi
        mcopy -i esp.img efi/usr/lib/grub/x86_64-efi-signed/grubx64.efi.signed ::/EFI/BOOT/grubx64.efi
        mcopy -i esp.img ${grubCfg} ::/EFI/BOOT/grub.cfg
        mcopy -i esp.img ${grubCfg} ::/EFI/ubuntu/grub.cfg

        mkfs.ext4 -q -L macro-root -U ${rootUuid} -E root_owner=0:0 \
          -d ${rootfs}/rootfs.tar root.img "''${rootMiB}M"

        truncate -s $(( (1 + espMiB + rootMiB + 1) * 1048576 )) disk.raw
        sgdisk --clear \
          -n 1:1MiB:+''${espMiB}MiB -t 1:ef00 -c 1:ESP \
          -n 2:0:0 -t 2:8304 -c 2:root \
          disk.raw
        dd if=esp.img of=disk.raw bs=1M seek=1 conv=notrunc,sparse status=none
        dd if=root.img of=disk.raw bs=1M seek=$(( 1 + espMiB )) conv=notrunc,sparse status=none

        mkdir -p $out
        qemu-img convert -c -O qcow2 disk.raw $out/disk.qcow2
        cp ${metadata} metadata.yaml
        tar --owner=0 --group=0 --numeric-owner --mtime=@1 -cJf $out/metadata.tar.xz metadata.yaml
      '';

  # Docker only: enrollment comes from a bind-mounted file, Docker owns
  # /etc/resolv.conf, and there are no disks to mount.
  dockerLayer = pkgs.runCommand "macro-box-docker-layer" { nativeBuildInputs = [ pkgs.gnutar ]; } ''
    mkdir -p root/etc/macro
    printf 'MACRO_ENROLL_FROM=file:/run/macro/enrollment.json\n' > root/etc/macro/enroll.env
    : > root/etc/resolv.conf
    : > root/etc/fstab
    tar --owner=0 --group=0 --numeric-owner --mtime=@1 --sort=name -C root -cf $out etc
  '';

  dockerConfig = {
    architecture = "amd64";
    os = "linux";
    config = {
      Entrypoint = [ "/sbin/init" ];
      Env = [
        "container=docker"
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      ];
      StopSignal = "SIGRTMIN+3";
    };
  };

  # A docker-save archive put together by hand: dockerTools copies files out
  # of the store, which loses the ownership and setuid bits dpkg recorded.
  docker =
    pkgs.runCommand "macro-box-docker.tar.gz"
      {
        nativeBuildInputs = [
          pkgs.jq
          pkgs.gnutar
          pkgs.pigz
        ];
        passAsFile = [ "config" ];
        config = builtins.toJSON dockerConfig;
      }
      ''
        mkdir image
        diffIds=()
        layers=()
        for layer in ${rootfs}/container.tar ${dockerLayer}; do
          sum=$(sha256sum "$layer" | cut -d' ' -f1)
          mkdir image/$sum
          ln -s "$layer" image/$sum/layer.tar
          diffIds+=("sha256:$sum")
          layers+=("$sum/layer.tar")
        done
        jq --args '.rootfs = { type: "layers", diff_ids: $ARGS.positional }' "''${diffIds[@]}" \
          < "$configPath" > config.json
        configSum=$(sha256sum config.json | cut -d' ' -f1)
        mv config.json image/$configSum.json
        jq -n --arg config "$configSum.json" --args \
          '[{ Config: $config, RepoTags: ["macro-box:latest"], Layers: $ARGS.positional }]' \
          "''${layers[@]}" > image/manifest.json
        tar --dereference --owner=0 --group=0 --numeric-owner --mtime=@1 --sort=name \
          -C image -cf - . | pigz -1 > $out
      '';
in
{
  inherit
    rootfs
    incus
    docker
    tools
    claudeCode
    ;
}
