{ inputs, ... }:
{
  perSystem =
    { system, ... }:
    {
      packages.bun2nix = inputs.bun2nix.packages.${system}.default;
    };
}
