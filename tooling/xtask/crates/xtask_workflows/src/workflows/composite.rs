//! Our composite actions, each written to `.github/actions/<directory>/action.yml`
//! by `cargo x workflows`. Callers use the typed `Local*` steps generated for
//! them in [`super::actions`].

mod check_macro_db_migrations;
mod cloud_storage_pulumi;
mod deploy_cloud_storage_pulumi;
mod get_project_name;
mod migrate_cloud_storage_db;
mod preview_cloud_storage_pulumi;
mod setup_nix;
mod setup_nix_dev_shell;
mod setup_reqs_web;
mod setup_rust;
mod setup_sccache;
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
pub const ACTIONS: &[ActionFile] = &[
    ActionFile {
        directory: "check-macro-db-migrations",
        module: "check_macro_db_migrations",
        build: check_macro_db_migrations::check_macro_db_migrations,
    },
    ActionFile {
        directory: "deploy-cloud-storage-pulumi",
        module: "deploy_cloud_storage_pulumi",
        build: deploy_cloud_storage_pulumi::deploy_cloud_storage_pulumi,
    },
    ActionFile {
        directory: "get-project-name",
        module: "get_project_name",
        build: get_project_name::get_project_name,
    },
    ActionFile {
        directory: "migrate-cloud-storage-db",
        module: "migrate_cloud_storage_db",
        build: migrate_cloud_storage_db::migrate_cloud_storage_db,
    },
    ActionFile {
        directory: "preview-cloud-storage-pulumi",
        module: "preview_cloud_storage_pulumi",
        build: preview_cloud_storage_pulumi::preview_cloud_storage_pulumi,
    },
    ActionFile {
        directory: "setup-nix",
        module: "setup_nix",
        build: setup_nix::setup_nix,
    },
    ActionFile {
        directory: "setup-nix-dev-shell",
        module: "setup_nix_dev_shell",
        build: setup_nix_dev_shell::setup_nix_dev_shell,
    },
    ActionFile {
        directory: "setup-reqs-web",
        module: "setup_reqs_web",
        build: setup_reqs_web::setup_reqs_web,
    },
    ActionFile {
        directory: "setup-rust",
        module: "setup_rust",
        build: setup_rust::setup_rust,
    },
    ActionFile {
        directory: "setup-sccache",
        module: "setup_sccache",
        build: setup_sccache::setup_sccache,
    },
    ActionFile {
        directory: "teardown-nix",
        module: "teardown_nix",
        build: teardown_nix::teardown_nix,
    },
];
