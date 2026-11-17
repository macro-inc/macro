//! `Setup Nix`: a working multi-user Nix on runners that don't ship one,
//! reusing a `/nix` cache volume when there is one.

use gh_workflow::expr::typed::{Str, hash_files, input};
use gh_workflow::{ActionInput, CompositeAction, Step};

pub fn setup_nix() -> CompositeAction {
    CompositeAction::new(
        "Setup Nix",
        "Ensure a working Nix (flakes enabled, daemon running) is available on a runner \
         that does not ship Nix preinstalled. Idempotent: when /nix is already populated \
         from a cache volume it only re-initialises the daemon and config rather than \
         reinstalling the store. Init-agnostic: uses systemd units when systemd is active \
         (full VMs), otherwise starts nix-daemon directly as a background process (e.g. \
         Namespace runners, where systemd is not active). Optionally configures a private \
         S3 binary cache as a substituter: the daemon performs substitution, so it is \
         started with the AWS credentials in its environment. All four cache inputs must \
         be set for the substituter to be configured; otherwise the action behaves exactly \
         as before.",
    )
    .add_input(
        "nix-cache-url",
        ActionInput::optional(
            "S3 store URL of the private nix binary cache \
             (e.g. s3://macro-nix-cache?region=us-east-1). Empty disables.",
            "",
        ),
    )
    .add_input(
        "nix-cache-public-key",
        ActionInput::optional(
            "Public signing key the daemon should trust for that cache.",
            "",
        ),
    )
    .add_input(
        "aws-access-key-id",
        ActionInput::optional(
            "AWS access key id for reading the private cache bucket.",
            "",
        ),
    )
    .add_input(
        "aws-secret-access-key",
        ActionInput::optional(
            "AWS secret access key for reading the private cache bucket.",
            "",
        ),
    )
    .add_input(
        "seed-cache",
        ActionInput::optional(
            "Namespace cache name holding a copy of /nix with the dev shell, restored when \
             the volume is empty. Its writers are PR jobs, so only PR check jobs pass this, \
             never jobs that deploy or hold deploy secrets. Empty disables.",
            "",
        ),
    )
    .add_step(
        Step::new("Install or re-initialise Nix")
            .run(include_str!("setup_nix/install_or_reinitialise_nix.sh"))
            .shell("bash")
            .add_env(("NIX_CACHE_URL", input::<Str>("nix-cache-url")))
            .add_env(("NIX_CACHE_PUBLIC_KEY", input::<Str>("nix-cache-public-key")))
            .add_env((
                "NIX_CACHE_AWS_ACCESS_KEY_ID",
                input::<Str>("aws-access-key-id"),
            ))
            .add_env((
                "NIX_CACHE_AWS_SECRET_ACCESS_KEY",
                input::<Str>("aws-secret-access-key"),
            ))
            .add_env(("NIX_SEED_CACHE", input::<Str>("seed-cache")))
            .add_env((
                "NIX_SEED_KEY",
                hash_files(["flake.lock", "flake.nix", "nix/**", "rust-toolchain.toml"]),
            )),
    )
}
