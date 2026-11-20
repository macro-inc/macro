//! `Teardown Nix`: stops the Nix daemons so a `/nix` cache volume can be
//! unmounted and committed.

use gh_workflow::{CompositeAction, Step};

pub fn teardown_nix() -> CompositeAction {
    CompositeAction::new(
        "Teardown Nix",
        "Stop the Nix daemon(s) so a /nix cache volume can be unmounted and committed. \
         The Determinate Nix daemon runs out of /nix, which keeps the mount busy and \
         can make the cache-volume commit fail with \"target is busy\". Run this as the \
         final (always()) step of any job that mounts /nix as a cache volume.",
    )
    .add_step(
        Step::new("Stop Nix daemons holding /nix")
            .run(include_str!("teardown_nix.sh"))
            .shell("bash"),
    )
}
