//! `Setup Rust`: the toolchain `rust-toolchain.toml` pins, with sccache and
//! a Cargo target cache when asked.

use gh_workflow::expr::typed::{Str, input};
use gh_workflow::{ActionInput, CompositeAction, Step, ZizmorRule};

use crate::workflows::actions::{LocalSetupSccache, SwatinemRustCache};

pub fn setup_rust() -> CompositeAction {
    CompositeAction::new(
        "Setup Rust",
        "Installs Rust and configures cargo/sccache caching.",
    )
    .add_input(
        "sccache",
        ActionInput::optional("Configure sccache as RUSTC_WRAPPER", "true"),
    )
    .add_input(
        "rust-cache",
        ActionInput::optional("Restore Swatinem/rust-cache Cargo target cache", "false"),
    )
    .add_step(
        Step::new("setup rust toolchain")
            .run(include_str!("setup_rust/setup_rust_toolchain.sh"))
            .shell("bash")
            .zizmor_ignore(
                ZizmorRule::GithubEnv,
                "puts the toolchain on PATH for later steps",
            ),
    )
    .add_step(
        LocalSetupSccache::new("setup sccache")
            .step()
            .if_condition(input::<Str>("sccache").eq("true")),
    )
    .add_step(
        SwatinemRustCache::new("setup rust caching")
            .shared_key("cloud-storage")
            .cache_all_crates(true)
            .workspaces(".")
            .step()
            .if_condition(input::<Str>("rust-cache").eq("true")),
    )
}
