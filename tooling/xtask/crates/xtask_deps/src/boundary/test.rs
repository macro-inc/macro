use std::path::Path;

use super::violations;

#[test]
fn allows_connect_dependencies_and_the_hakari_exemption() {
    assert!(
        violations(
            "connect_api",
            Path::new("connect/services/connect_api/Cargo.toml"),
            [
                (
                    "connect_registry",
                    Path::new("connect/crates/connect_registry/Cargo.toml")
                ),
                (
                    "workspace-hack",
                    Path::new("crates/workspace-hack/Cargo.toml")
                ),
            ],
        )
        .is_empty()
    );
}

#[test]
fn rejects_connect_dependency_on_macro_crate() {
    assert_eq!(
        violations(
            "connect_api",
            Path::new("connect/services/connect_api/Cargo.toml"),
            [("macro_auth", Path::new("crates/macro_auth/Cargo.toml"))],
        ),
        ["connect_api -> macro_auth: connect/ package depends on a Macro workspace package"]
    );
}

#[test]
fn allows_macro_dependency_on_connect_client() {
    assert!(
        violations(
            "macro_api",
            Path::new("services/macro_api/Cargo.toml"),
            [(
                "connect_client",
                Path::new("connect/crates/connect_client/Cargo.toml")
            )],
        )
        .is_empty()
    );
}

#[test]
fn rejects_macro_dependency_on_connect_internals() {
    assert_eq!(
        violations(
            "macro_api",
            Path::new("services/macro_api/Cargo.toml"),
            [(
                "connect_registry",
                Path::new("connect/crates/connect_registry/Cargo.toml")
            )],
        ),
        ["macro_api -> connect_registry: Macro package depends on a non-client connect/ package"]
    );
}

#[test]
fn reports_naming_and_every_forbidden_dependency() {
    assert_eq!(
        violations(
            "registry",
            Path::new("connect/crates/registry/Cargo.toml"),
            [
                ("macro_auth", Path::new("crates/macro_auth/Cargo.toml")),
                ("macro_db", Path::new("crates/macro_db/Cargo.toml")),
            ],
        ),
        [
            "registry -> registry: package under connect/ must be named connect_*",
            "registry -> macro_auth: connect/ package depends on a Macro workspace package",
            "registry -> macro_db: connect/ package depends on a Macro workspace package",
        ]
    );
}
