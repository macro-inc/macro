//! `Setup sccache`: installs a pinned sccache release and makes it cargo's
//! `RUSTC_WRAPPER`.

use gh_workflow::expr::typed::{Str, input};
use gh_workflow::{ActionInput, CompositeAction, Step, ZizmorRule};

pub fn setup_sccache() -> CompositeAction {
    CompositeAction::new(
        "Setup sccache",
        "Install sccache and configure it as RUSTC_WRAPPER.",
    )
    .add_input(
        "version",
        ActionInput::optional("sccache release version to install", "v0.15.0"),
    )
    .add_step(
        Step::new("Install sccache")
            .run(include_str!("setup_sccache/install_sccache.sh"))
            .shell("bash")
            .zizmor_ignore(
                ZizmorRule::GithubEnv,
                "puts sccache on PATH for later steps",
            )
            .add_env(("SCCACHE_VERSION", input::<Str>("version"))),
    )
    .add_step(
        Step::new("Configure sccache")
            .run(include_str!("setup_sccache/configure_sccache.sh"))
            .shell("bash"),
    )
}
