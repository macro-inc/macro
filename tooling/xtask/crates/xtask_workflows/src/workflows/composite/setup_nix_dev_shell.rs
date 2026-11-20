//! `Setup Nix dev shell`: exports one of the flake's dev shells to the
//! job's later steps.

use gh_workflow::expr::typed::{Str, input};
use gh_workflow::{ActionInput, CompositeAction, Step, ZizmorRule};

pub fn setup_nix_dev_shell() -> CompositeAction {
    CompositeAction::new(
        "Setup Nix dev shell",
        "Enter a repository Nix dev shell without configuring a cache provider.",
    )
    .add_input(
        "shell",
        ActionInput::optional(
            "Flake `devShells` attribute to enter (e.g. `default`, `agent-daemon`).",
            "default",
        ),
    )
    .add_step(
        Step::new("Enter Nix dev shell")
            .run(include_str!("setup_nix_dev_shell/enter_dev_shell.sh"))
            .zizmor_ignore(
                ZizmorRule::GithubEnv,
                "exports the dev shell to later steps",
            )
            .shell("bash")
            .add_env(("DEV_SHELL", input::<Str>("shell"))),
    )
}
