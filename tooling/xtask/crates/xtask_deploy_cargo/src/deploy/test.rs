use super::{dockerfile_selections, nix_selections, parse_dockerfile};
use crate::infra::Consumer;
use serde_json::json;

const PACKAGED: &str = "cargoWithProfile build --locked --package svc --bin svc >\"$log\"";

#[test]
fn every_deploy_root_needs_its_own_build_even_when_another_bundle_has_two() {
    let shown = json!({ "derivations": {
        "a.drv": { "env": { "buildPhase": "cargo --version\necho nothing" }, "inputs": { "drvs": {} } },
        "bundle.drv": { "env": { "buildPhase": "cp -r $x $out" }, "inputs": { "drvs": {
            "one-binaries-0.1.0.drv": {}, "two-binaries-0.1.0.drv": {}
        } } },
        "one-binaries-0.1.0.drv": { "env": { "buildPhase": PACKAGED } },
        "two-binaries-0.1.0.drv": { "env": { "buildPhase": PACKAGED } },
    } });
    let (bound, errors) = nix_selections(
        &[
            ("deploy-a".into(), "a.drv".into()),
            ("deploy-bundle".into(), "bundle.drv".into()),
        ],
        &shown,
    );
    assert_eq!(bound.len(), 2);
    assert_eq!(
        errors,
        ["deploy-a: no Cargo build command and no bundled build"]
    );
}

#[test]
fn a_bundled_build_without_a_command_fails_its_bundle() {
    let shown = json!({ "derivations": {
        "bundle.drv": { "env": { "buildPhase": "" }, "inputs": { "drvs": {
            "one-binaries-0.1.0.drv": {}, "empty-binaries-0.1.0.drv": {}
        } } },
        "one-binaries-0.1.0.drv": { "env": { "buildPhase": PACKAGED } },
        "empty-binaries-0.1.0.drv": { "env": { "buildPhase": "true" } },
    } });
    let (bound, errors) = nix_selections(&[("deploy-bundle".into(), "bundle.drv".into())], &shown);
    assert_eq!(bound.len(), 1);
    assert_eq!(
        errors,
        ["deploy-bundle: bundled empty-binaries-0.1.0.drv has no Cargo build command"]
    );
}

#[test]
fn a_root_that_was_not_shown_or_builds_without_a_package_fails() {
    let shown = json!({ "derivations": {
        "lambda.drv": { "env": { "buildPhase": "cargo zigbuild --release --locked --bin handler" } },
    } });
    let (bound, errors) = nix_selections(
        &[
            ("deploy-lambda".into(), "lambda.drv".into()),
            ("deploy-gone".into(), "gone.drv".into()),
        ],
        &shown,
    );
    assert!(bound.is_empty());
    assert_eq!(
        errors,
        [
            "deploy-lambda: a build selects no package, so Cargo resolves the whole workspace",
            "deploy-gone: derivation gone.drv was not shown",
        ]
    );
}

fn consumer(source: &str, args: &[(&str, &str)]) -> Consumer {
    Consumer {
        source: source.into(),
        dockerfile: "docker/Dockerfile".into(),
        args: args
            .iter()
            .map(|(k, v)| ((*k).into(), (*v).into()))
            .collect(),
    }
}

const GENERIC: &str = "FROM rust AS builder\nARG SERVICE_NAME\nARG PACKAGE_NAME\nARG FEATURES=default\n# cargo build --bin commented\nRUN --mount=type=cache,target=/x \\\n  test -n \"${PACKAGE_NAME}\" || exit 1 && \\\n  cargo build --release --package ${PACKAGE_NAME} --features ${FEATURES} --bin ${SERVICE_NAME} && \\\n  strip /app/svc\nRUN cargo install cargo-chef\n";

#[test]
fn reads_multi_line_run_instructions_without_their_mounts_and_their_defaults() {
    let dockerfile = parse_dockerfile(GENERIC).unwrap();
    assert_eq!(
        dockerfile.runs,
        [
            "test -n \"${PACKAGE_NAME}\" || exit 1 && cargo build --release --package ${PACKAGE_NAME} --features ${FEATURES} --bin ${SERVICE_NAME} && strip /app/svc",
            "cargo install cargo-chef",
        ]
    );
    assert_eq!(dockerfile.defaults["FEATURES"], "default");
}

#[test]
fn resolves_a_generic_dockerfile_once_per_stack_with_its_build_arguments() {
    let gateway = consumer(
        "infra/a.ts:3",
        &[
            ("SERVICE_NAME", "gateway_service"),
            ("PACKAGE_NAME", "gateway"),
            ("FEATURES", "native-editor"),
        ],
    );
    let other = consumer(
        "infra/b.ts:9",
        &[("SERVICE_NAME", "svc"), ("PACKAGE_NAME", "svc")],
    );
    let (bound, errors) = dockerfile_selections("docker/Dockerfile", GENERIC, &[&gateway, &other]);
    assert!(errors.is_empty(), "{errors:?}");
    let resolved: Vec<(&str, Vec<String>, Vec<String>)> = bound
        .iter()
        .map(|b| {
            (
                b.source.as_str(),
                b.selection.packages.clone(),
                b.selection.features.clone(),
            )
        })
        .collect();
    assert_eq!(
        resolved,
        [
            (
                "docker/Dockerfile for infra/a.ts:3",
                vec!["gateway".into()],
                vec!["native-editor".into()]
            ),
            (
                "docker/Dockerfile for infra/b.ts:9",
                vec!["svc".into()],
                vec!["default".into()]
            ),
        ]
    );
}

#[test]
fn an_unset_build_argument_or_a_dockerfile_no_stack_builds_fails() {
    let unset = consumer("infra/a.ts:3", &[("SERVICE_NAME", "svc")]);
    let (bound, errors) = dockerfile_selections("docker/Dockerfile", GENERIC, &[&unset]);
    assert!(bound.is_empty());
    assert_eq!(
        errors,
        ["docker/Dockerfile for infra/a.ts:3: build argument PACKAGE_NAME is not set"]
    );
    let (bound, errors) = dockerfile_selections("docker/Dockerfile", GENERIC, &[]);
    assert!(bound.is_empty());
    assert_eq!(
        errors,
        [
            "docker/Dockerfile: its Cargo commands use build arguments (FEATURES, PACKAGE_NAME, SERVICE_NAME) but no infra stack builds it"
        ]
    );
}

#[test]
fn a_dockerfile_build_without_a_package_fails_in_any_case() {
    let (bound, errors) = dockerfile_selections(
        "docker/Dockerfile.x",
        "RUN cargo chef cook --release --recipe-path recipe.json --bin x\nrun cargo build --release --bin x && cargo strip\n",
        &[],
    );
    assert!(bound.is_empty());
    assert_eq!(errors.len(), 2);
    assert!(
        errors
            .iter()
            .all(|error| error.contains("selects no package"))
    );
}

#[test]
fn unreadable_run_forms_fail_the_file() {
    for (text, expected) in [
        (
            "RUN env SQLX_OFFLINE=true cargo build --package a --bin a\n",
            "unsupported Cargo invocation shape",
        ),
        (
            "RUN [\"cargo\", \"build\", \"--bin\", \"a\"]\n",
            "unsupported RUN form",
        ),
        (
            "RUN cargo build --package a \\\n",
            "RUN continuation never ends",
        ),
        ("RUN cargo build --package $PACKAGE --bin a\n", "uses $NAME"),
        (
            "RUN <<EOF\ncargo build --bin svc\nEOF\n",
            "unsupported RUN form",
        ),
        (
            "RUN --mount=type=cache,target=/x <<-EOF\n  cargo build --bin svc\nEOF\n",
            "unsupported RUN form",
        ),
        ("RUN [\"sh\", \"build.sh\"]\n", "unsupported RUN form"),
        (
            "RUN /usr/local/cargo/bin/cargo build --bin svc\n",
            "selects no package",
        ),
        (
            "RUN ~/.cargo/bin/cargo build --bin svc\n",
            "selects no package",
        ),
        (
            "RUN cargo-zigbuild build --bin svc\n",
            "unsupported Cargo invocation shape",
        ),
        // A wrapper that runs Cargo without naming it yields no selection.
        (
            "RUN worker-build --profile sync-service-release\n",
            "no Cargo build command",
        ),
    ] {
        let (bound, errors) = dockerfile_selections("docker/Dockerfile.x", text, &[]);
        assert!(bound.is_empty(), "{text}");
        assert_eq!(errors.len(), 1, "{text}: {errors:?}");
        assert!(errors[0].contains(expected), "{text}: {errors:?}");
    }
}

#[test]
fn recognized_build_cannot_cover_a_grouped_or_substituted_unsafe_build() {
    for hidden in [
        "(cargo build --bin server)",
        "echo $(cargo build --bin server)",
        "echo `cargo build --bin server`",
    ] {
        let dockerfile =
            format!("FROM rust\nRUN cargo build --package safe --bin safe && {hidden}\n");
        let (_, errors) = dockerfile_selections("docker/Dockerfile", &dockerfile, &[]);
        assert!(!errors.is_empty(), "hidden Cargo build accepted: {hidden}");
    }
}
