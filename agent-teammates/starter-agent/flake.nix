{
  description = "starter-agent: a new agent on muppet, with chat, calls and screen share";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.bun
            pkgs.nodejs
            # Credentials: secrets.enc.json is encrypted with sops to an age key.
            pkgs.sops
            pkgs.age
            pkgs.git
            pkgs.gh
            pkgs.jq
            # Calls: the working sound is decoded with ffmpeg; the share browser runs on a virtual display.
            pkgs.ffmpeg-headless
            pkgs.xvfb
            pkgs.chromium
            # The share browser's sound server, and parec, which records it for a share.
            pkgs.pulseaudio
            # The share browser's display is read with x11grab, which only ffmpeg-full is built with.
            # Under its own name, so `ffmpeg` stays the headless one.
            (pkgs.runCommand "ffmpeg-x11grab" { } ''
              mkdir -p $out/bin
              ln -s ${pkgs.ffmpeg-full}/bin/ffmpeg $out/bin/ffmpeg-x11grab
            '')
          ];

          env = {
            # The glibc Biome binary from npm can't run on NixOS; use the static musl build instead.
            BIOME_BINARY = "@biomejs/cli-linux-${
              if pkgs.stdenv.hostPlatform.isAarch64 then "arm64" else "x64"
            }-musl/biome";
            # LiveKit's native audio models link libstdc++, and NixOS has no global one.
            LD_LIBRARY_PATH = "${pkgs.stdenv.cc.cc.lib}/lib";
            LIVEKIT_FFMPEG_PATH = "${pkgs.ffmpeg-headless}/bin/ffmpeg";
            # The share browser draws CJK and emoji as boxes with the system's fonts alone.
            AGENT_SCREEN_FONTS = "${pkgs.noto-fonts-cjk-sans}:${pkgs.noto-fonts-color-emoji}";
          };
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-rfc-style);
    };
}
