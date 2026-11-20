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
      # fixed this on main after the release (rhysd/actionlint@fd33e9f); drop
      # the patch with the next one. Vendored: github.com's commit `.patch`
      # URLs answer CI runners with 503s.
      actionlint = pkgs.actionlint.overrideAttrs (old: {
        patches = (old.patches or [ ]) ++ [ ./patches/actionlint-shellcheck-stdin.patch ];
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
