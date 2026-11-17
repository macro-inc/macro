# Loki, Tempo and Mimir, each its own application in `observability`.
# endpoints.nix says how other apps reach them; lib.nix holds what they share.
{
  imports = [
    ./loki.nix
    ./tempo.nix
    ./mimir.nix
  ];
}
