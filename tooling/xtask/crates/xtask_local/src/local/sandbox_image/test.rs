use super::*;
use std::collections::BTreeMap;
use std::path::Path;

fn env_with(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

#[test]
fn skips_when_the_flag_is_off() {
    assert_eq!(EnsurePlan::from_env(&BTreeMap::new()), None);
    assert_eq!(
        EnsurePlan::from_env(&env_with(&[("DEV_DANGEROUS_LOCAL_CONTAINERS", "false")])),
        None
    );
}

#[test]
fn skips_truthy_non_true_values() {
    assert_eq!(
        EnsurePlan::from_env(&env_with(&[("DEV_DANGEROUS_LOCAL_CONTAINERS", "1")])),
        None
    );
}

#[test]
fn default_tag_pulls_ghcr_before_building() {
    assert_eq!(
        EnsurePlan::from_env(&env_with(&[("DEV_DANGEROUS_LOCAL_CONTAINERS", "true")])),
        Some(EnsurePlan {
            tag: DEFAULT_LOCAL_TAG.to_owned(),
            pull_ghcr: true,
        })
    );
}

#[test]
fn custom_tag_does_not_pull_or_retag_ghcr() {
    assert_eq!(
        EnsurePlan::from_env(&env_with(&[
            ("DEV_DANGEROUS_LOCAL_CONTAINERS", "true"),
            ("LOCAL_CONTAINER_IMAGE", "my-sandbox:dev"),
        ])),
        Some(EnsurePlan {
            tag: "my-sandbox:dev".to_owned(),
            pull_ghcr: false,
        })
    );
}

#[test]
fn docker_arg_builders_match_the_cli() {
    assert_eq!(
        image_inspect_args(DEFAULT_LOCAL_TAG),
        ["image", "inspect", DEFAULT_LOCAL_TAG]
    );
    assert_eq!(pull_args(GHCR_LATEST), ["pull", GHCR_LATEST]);
    assert_eq!(
        tag_args(GHCR_LATEST, DEFAULT_LOCAL_TAG),
        ["tag", GHCR_LATEST, DEFAULT_LOCAL_TAG]
    );
    assert_eq!(
        build_args(DEFAULT_LOCAL_TAG, Path::new(CONTEXT_REL)),
        ["build", "--tag", DEFAULT_LOCAL_TAG, CONTEXT_REL]
    );
}

#[test]
fn ghcr_latest_is_the_image_plus_latest() {
    assert_eq!(GHCR_LATEST, format!("{GHCR_IMAGE}:latest"));
    assert_eq!(DEFAULT_LOCAL_TAG, "macro-agent-harness:latest");
}
