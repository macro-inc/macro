{ inputs, ... }:
{
  perSystem =
    { system, ... }:
    let
      pkgs = import inputs.nixpkgs { inherit system; };
      version = "1.4.2";
      platform =
        {
          aarch64-darwin = "darwin-aarch64";
          aarch64-linux = "linux-aarch64";
          x86_64-darwin = "darwin-x64";
          x86_64-linux = "linux-x64";
        }
        .${system};
      hashes = {
        darwin-aarch64 = "sha256-kJh6OhbX21VtiGrD1VHnttPt8KHPQ6yu1iLoZ2vh0S8=";
        darwin-x64 = "sha256-gFINfhdSYwjJGF0mFnmsbSd5jTgDoOn3/5Ehq4r/sBI=";
        linux-aarch64 = "sha256-VDKLvC2cjgyfiSxUTWbFeoO4QTnjSQnl7oF1jxrI/ac=";
        linux-x64 = "sha256-NjaPrvdSeHXV/6UuU81IAhdB8qg+tiCKjdZAaNQiqRM=";
      };
    in
    {
      packages.bun-captcha-lab = pkgs.bun.overrideAttrs {
        inherit version;
        src = pkgs.fetchurl {
          url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-${platform}.zip";
          hash = hashes.${platform};
        };
      };
    };
}
