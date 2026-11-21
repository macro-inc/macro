{
  description = "Observability EKS cluster: AWS layer in OpenTofu, written with terranix";

  inputs = {
    # Same channel as infra/stacks/observability.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    terranix = {
      url = "github:terranix/terranix/2.9.0";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, terranix, ... }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      settings = import ./settings.nix;

      perSystem =
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          tofu = pkgs.opentofu.withPlugins (p: [ p.hashicorp_aws ]);

          render =
            modules: stateKey:
            terranix.lib.terranixConfiguration {
              inherit system modules;
              extraArgs = { inherit settings stateKey; };
            };

          configs = {
            main = render [
              ./modules/provider.nix
              ./modules/existing.nix
              ./modules/network.nix
              ./modules/eks.nix
              ./modules/pod-identity.nix
              ./modules/buckets.nix
              ./modules/rds.nix
              ./modules/edge.nix
              ./modules/alarms.nix
              ./modules/outputs.nix
            ] settings.state.mainKey;
            bootstrap = render [
              ./modules/provider.nix
              ./bootstrap/state.nix
            ] settings.state.bootstrapKey;
            # The bootstrap before its bucket exists: same resources, local state.
            bootstrap-local = render [
              ./modules/provider.nix
              ./bootstrap/state.nix
            ] null;
          };

          # Runs tofu on one rendered config in .tofu/<config>/ (gitignored),
          # where tofu keeps its working files and the plan.
          tofuApp = pkgs.writeShellApplication {
            name = "observability-tofu";
            runtimeInputs = [
              tofu
              pkgs.git
            ];
            text = ''
              usage="usage: nix run .#tofu -- <main|bootstrap> <tofu arguments>"
              config="''${1:?$usage}"
              shift
              case "$config" in
                main) rendered=${configs.main} ;;
                bootstrap) rendered=${configs.bootstrap} ;;
                *) echo "$usage" >&2; exit 2 ;;
              esac
              root="$(git rev-parse --show-toplevel)/infra/k8s/observability/aws"
              work="$root/.tofu/$config"
              mkdir -p "$work"
              install -m 0644 "$rendered" "$work/config.tf.json"
              cd "$work"
              exec tofu "$@"
            '';
          };

          # The one-time bootstrap: create the state bucket with local state,
          # then move that state into the bucket. README "First apply".
          bootstrapApp = pkgs.writeShellApplication {
            name = "observability-tofu-bootstrap";
            runtimeInputs = [
              tofu
              pkgs.git
              pkgs.awscli2
            ];
            text = ''
              bucket=${settings.state.bucket}
              key=${settings.state.bootstrapKey}
              # Go on only when the bootstrap state is known to be absent: a 404
              # (no object or no bucket), or a 403 while the bucket itself is
              # missing. Anything else stops here, so the migration below can't
              # overwrite a state it failed to see.
              if err="$(aws s3api head-object --region ${settings.region} --bucket "$bucket" --key "$key" 2>&1 >/dev/null)"; then
                echo "The state bucket is already bootstrapped; use: nix run .#tofu -- bootstrap plan" >&2
                exit 1
              fi
              case "$err" in
                *"(404)"*) ;;
                *"(403)"*)
                  if bucket_err="$(aws s3api head-bucket --region ${settings.region} --bucket "$bucket" 2>&1 >/dev/null)" \
                    || [[ "$bucket_err" != *"(404)"* ]]; then
                    echo "Can't tell whether s3://$bucket/$key exists; use credentials with s3:ListBucket on it. head-object: $err" >&2
                    exit 1
                  fi
                  ;;
                *)
                  echo "Can't check s3://$bucket/$key: $err" >&2
                  exit 1
                  ;;
              esac
              work="$(git rev-parse --show-toplevel)/infra/k8s/observability/aws/.tofu/bootstrap"
              mkdir -p "$work"
              cd "$work"
              # Not bootstrapped yet, so any S3 backend recorded here is from a
              # run whose migration failed; its local state is still here and the
              # rerun applies nothing new before migrating again.
              rm -rf .terraform
              install -m 0644 ${configs.bootstrap-local} config.tf.json
              tofu init -input=false
              tofu apply
              install -m 0644 ${configs.bootstrap} config.tf.json
              tofu init -input=false -migrate-state -force-copy
              rm -f terraform.tfstate terraform.tfstate.backup
              tofu plan -detailed-exitcode
            '';
          };

          # Renders each config and runs `tofu validate` on it offline, and
          # refuses any resource or argument that would put a secret value in
          # the config or its state.
          validate =
            pkgs.runCommand "observability-aws-validate"
              {
                nativeBuildInputs = [
                  tofu
                  pkgs.jq
                ];
              }
              ''
                export HOME="$TMPDIR"
                ${lib.concatMapStrings (name: ''
                  echo "== ${name}"
                  jq -e '
                    [ (.resource // {} | keys[]) as $type
                      | select($type | test("^(aws_secretsmanager_secret_version|aws_ssm_parameter|random_password|tls_private_key|aws_iam_access_key)$"))
                      | $type ]
                    + [ (.data // {} | keys[]) as $type
                        | select($type | test("^(aws_secretsmanager_secret_versions?|aws_secretsmanager_random_password|aws_ssm_parameters?|aws_ssm_parameters_by_path|aws_kms_secrets?|aws_iam_access_keys)$"))
                        | "data.\($type)" ]
                    + [ ..| objects | to_entries[]
                        | select(.key | test("^(password|master_password|secret_string|secret_binary|value_wo)$")) | .key ]
                    | if length == 0 then true else error("secret-bearing config: \(.)") end
                  ' ${configs.${name}} >/dev/null
                  # EC2 accepts only these characters in security group and rule
                  # descriptions, and says so only at apply.
                  jq -e '
                    [ .resource // {} | to_entries[]
                      | select(.key | test("^aws_(security_group|vpc_security_group_(ingress|egress)_rule|security_group_rule)$"))
                      | .value | to_entries[]
                      | select((.value.description // "") | test("\\A[a-zA-Z0-9. _:/()#,@\\[\\]+=&;{}!$*-]{0,255}\\z") | not)
                      | .key ]
                    | if length == 0 then true else error("security group descriptions EC2 rejects: \(.)") end
                  ' ${configs.${name}} >/dev/null
                  mkdir ${name}
                  cp ${configs.${name}} ${name}/config.tf.json
                  tofu -chdir=${name} init -backend=false -input=false -no-color >/dev/null
                  tofu -chdir=${name} validate -no-color
                '') (builtins.attrNames configs)}
                touch $out
              '';
        in
        {
          packages = configs // {
            inherit tofu;
            default = configs.main;
          };
          apps = {
            tofu = {
              type = "app";
              program = lib.getExe tofuApp;
            };
            bootstrap = {
              type = "app";
              program = lib.getExe bootstrapApp;
            };
          };
          checks.validate = validate;
          devShells.default = pkgs.mkShell {
            packages = [
              tofu
              pkgs.awscli2
              pkgs.kubectl
            ];
          };
          formatter = pkgs.nixfmt;
        };

      forSystems = attr: lib.genAttrs systems (system: (perSystem system).${attr});
    in
    {
      packages = forSystems "packages";
      apps = forSystems "apps";
      checks = forSystems "checks";
      devShells = forSystems "devShells";
      formatter = forSystems "formatter";
    };
}
