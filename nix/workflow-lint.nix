# The GitHub Actions linters `check generated workflows` runs, as the
# `workflow-lint` dev shell: `nix develop .#workflow-lint -c actionlint`.
{ inputs, ... }:
{
  perSystem =
    { system, ... }:
    let
      pkgs = import inputs.nixpkgs { inherit system; };
      # actionlint 1.7.12 writes a script to shellcheck's stdin before starting
      # it, so a script larger than the pipe buffer hangs it forever. Upstream
      # fixed this on main after the release; drop the patch with the next one.
      actionlint = pkgs.actionlint.overrideAttrs (old: {
        patches = (old.patches or [ ]) ++ [
          (pkgs.fetchpatch {
            url = "https://github.com/rhysd/actionlint/commit/fd33e9f582a01a02885c93ae3775e1190cf63653.patch";
            hash = "sha256-PbdXDn6tG4Ii2xXDauJ0b3+tWqTIcv0J8keUWdAxWmU=";
          })
        ];
      });
    in
    {
      devShells.workflow-lint = pkgs.mkShell {
        packages = [
          actionlint
          pkgs.shellcheck
          pkgs.zizmor
        ];
      };
    };
}
