use super::{Selection, commands, parse};

fn words(line: &str) -> Vec<String> {
    commands(line).remove(0)
}

fn selection(line: &str) -> Selection {
    parse(&words(line)).unwrap().unwrap()
}

#[test]
fn reads_crane_and_zigbuild_commands_with_their_redirections() {
    assert_eq!(
        selection(
            "cargoWithProfile build --message-format json-render-diagnostics --locked --package agent_harness_service --bin agent_harness_service  >\"$cargoBuildLog\""
        ),
        Selection {
            packages: vec!["agent_harness_service".into()],
            ..Selection::default()
        }
    );
    assert_eq!(
        selection(
            "cargo zigbuild --release --locked --target x86_64-unknown-linux-gnu.2.26 --package deleted_item_poller --bin deleted_item_poller"
        ),
        Selection {
            packages: vec!["deleted_item_poller".into()],
            target: Some("x86_64-unknown-linux-gnu".into()),
            ..Selection::default()
        }
    );
}

#[test]
fn reads_equals_and_attached_forms_of_selection_options() {
    assert_eq!(
        selection(
            "cargo build --package=a -pb --features=x,y -Fz --no-default-features --all-features --target=wasm32-unknown-unknown --bin=a -j4"
        ),
        Selection {
            packages: vec!["a".into(), "b".into()],
            features: vec!["x,y".into(), "z".into()],
            no_default_features: true,
            all_features: true,
            target: Some("wasm32-unknown-unknown".into()),
        }
    );
}

#[test]
fn reads_leading_assignments_and_rejects_an_unsubstituted_build_argument() {
    assert_eq!(
        selection("SQLX_OFFLINE=true cargo build --release --package svc --bin svc"),
        Selection {
            packages: vec!["svc".into()],
            ..Selection::default()
        }
    );
    assert!(parse(&words("cargo build --package ${PACKAGE_NAME} --bin x")).is_err());
}

#[test]
fn ignores_commands_that_compile_no_workspace_code() {
    for line in [
        "cargo --version",
        "cargo install cargo-chef cargo-strip",
        "cargo chef prepare --recipe-path recipe.json --bin convert_service",
        "cargo strip",
        "strip /app/target/release/svc",
    ] {
        assert_eq!(parse(&words(line)).unwrap(), None, "{line}");
    }
}

#[test]
fn rejects_arguments_it_does_not_understand() {
    for line in [
        "cargo build --manifest-path other/Cargo.toml --bin a",
        "cargo build --workspace --bin a",
        "cargo build --features",
        "cargo build --package $NAME",
        "cargo build --release=yes",
        "cargo build positional",
        // Wrappers and subcommands outside the grammar cannot be read.
        "env SQLX_OFFLINE=true cargo build --package a --bin a",
        "sh -c \"cargo build --package a --bin a\"",
        "exec cargo build --package a --bin a",
        "cargo +nightly build --package a --bin a",
        "cargo b --package a",
        "cargo test --package a",
        "cargo chef unknown",
        // Cargo is matched by basename, so paths and cargo-* binaries are read too.
        "cargo-zigbuild build --package a --bin a",
        "/usr/local/cargo/bin/cargo-zigbuild zigbuild --package a",
        "env X=1 /usr/local/cargo/bin/cargo build --package a --bin a",
    ] {
        assert!(parse(&words(line)).is_err(), "{line} should be rejected");
    }
}

#[test]
fn reads_a_path_qualified_cargo_like_cargo() {
    for line in [
        "/usr/local/cargo/bin/cargo build --package a --bin a",
        "~/.cargo/bin/cargo build --package a --bin a",
        "\"$HOME/.cargo/bin/cargo\" build --package a --bin a",
    ] {
        assert_eq!(
            selection(line),
            Selection {
                packages: vec!["a".into()],
                ..Selection::default()
            },
            "{line}"
        );
    }
}

#[test]
fn splits_chained_commands() {
    let chained = commands(
        "test -n \"${PACKAGE_NAME}\" || exit 1 && cargo build --release --package p --bin b && strip /app/b",
    );
    assert_eq!(chained.len(), 4);
    assert_eq!(chained[2][..2], ["cargo".to_owned(), "build".to_owned()]);
}
