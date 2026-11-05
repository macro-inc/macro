use super::*;

fn yaml() -> String {
    regenerate_generated_code()
        .to_string()
        .expect("workflow yaml")
}

/// The OpenAPI clients, specta types, SDK and docs tool pages all come from
/// workspace binaries, so one job builds them once and writes all four. Specta
/// runs last: its `cargo run -p` builds resolve features per package and would
/// otherwise make the docs build recompile.
#[test]
fn regenerates_every_rust_generated_artifact_before_proposing() {
    let yaml = yaml();
    let order = [
        "Build schema binaries",
        "bun run gen-api",
        "bun run sync-specs",
        "bun run generate:tools",
        "just gen-agent-fold-types",
        "just gen-database-sql-types",
        "just gen-dynamic-ui-types",
        "just gen-agent-review-types",
        "Open or update the pull request",
    ];
    let positions: Vec<usize> = order
        .iter()
        .map(|needle| {
            yaml.find(needle)
                .unwrap_or_else(|| panic!("missing `{needle}`: {yaml}"))
        })
        .collect();
    assert!(positions.windows(2).all(|pair| pair[0] < pair[1]), "{yaml}");
    assert!(
        !yaml.contains("gen-api -- --check"),
        "the job writes the output instead of failing on it: {yaml}"
    );
}

#[test]
fn runs_only_for_main_and_keeps_only_the_newest_run() {
    let yaml = yaml();
    assert!(yaml.contains("push:"), "{yaml}");
    assert!(!yaml.contains("pull_request:"), "{yaml}");
    assert!(yaml.contains("github.ref == 'refs/heads/main'"), "{yaml}");
    assert!(yaml.contains("cancel-in-progress: true"), "{yaml}");
}

/// Every input of the generators starts a run, or stale output goes unnoticed.
#[test]
fn trigger_covers_every_generator_input() {
    let yaml = yaml();
    for path in [
        "crates/**/*.rs",
        "services/**/*.rs",
        "Cargo.toml",
        "Cargo.lock",
        "apps/web/scripts/generate-api-schema.ts",
        "apps/web/scripts/services.ts",
        "packages/sdk/**",
        "apps/docs/**",
    ] {
        assert!(yaml.contains(path), "{path} must start a run: {yaml}");
    }
}

/// Setup edits `bunfig.toml`, so a bare `git add -A` would propose it on every run.
#[test]
fn proposes_only_generated_paths() {
    let yaml = yaml();
    assert!(!yaml.contains("git add -A"), "{yaml}");
    for path in [
        "apps/web/src/lib/service-clients",
        "apps/web/src/lib/core/database-sql/generated",
        "apps/web/src/features/dynamic-ui/generated",
        "packages/lexical-core/generated",
        "packages/sdk",
        "apps/docs",
    ] {
        assert!(yaml.contains(path), "{path} must be proposed: {yaml}");
    }
}

/// With the workflow's own token, the pull request would start no checks.
#[test]
fn checkout_and_pull_request_use_the_bot_token() {
    let yaml = yaml();
    let uses = yaml.matches("secrets.GENERATED_CODE_BOT_TOKEN").count();
    assert_eq!(uses, 2, "checkout pushes and gh opens with it: {yaml}");
}

/// Debug info only slows the throwaway generator build. Set at job level so
/// every cargo call in the job shares the profile and reuses one build.
#[test]
fn builds_without_debug_info_for_every_step() {
    let yaml = yaml();
    let (header, steps) = yaml
        .split_once("\n    steps:\n")
        .expect("job header, then steps");
    assert!(header.contains("CARGO_PROFILE_DEV_DEBUG: '0'"), "{header}");
    assert!(
        header.contains("RUSTFLAGS: '-C link-arg=-fuse-ld=mold'"),
        "{header}"
    );
    for flag in ["CARGO_PROFILE_DEV_DEBUG", "RUSTFLAGS", "--config"] {
        assert!(!steps.contains(flag), "`{flag}` splits the build: {steps}");
    }
}
