//! Our composite actions, each written to `.github/actions/<directory>/action.yml`
//! by `cargo x workflows`. Callers use the typed `Local*` steps generated for
//! them in [`super::actions`].

mod teardown_nix;

use gh_workflow::CompositeAction;

/// A composite action we generate.
pub struct ActionFile {
    /// The directory under `.github/actions/`.
    pub directory: &'static str,
    /// The module under `workflows/composite/` that defines it.
    pub module: &'static str,
    pub build: fn() -> CompositeAction,
}

/// Every composite action we generate. Add new ones here.
pub const ACTIONS: &[ActionFile] = &[ActionFile {
    directory: "teardown-nix",
    module: "teardown_nix",
    build: teardown_nix::teardown_nix,
}];
