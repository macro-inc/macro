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
fn builds_the_configured_tag_when_local_containers_are_on() {
    assert_eq!(
        EnsurePlan::from_env(&env_with(&[("DEV_DANGEROUS_LOCAL_CONTAINERS", "true")])),
        Some(EnsurePlan {
            tag: DEFAULT_LOCAL_TAG.to_owned(),
        })
    );
    assert_eq!(
        EnsurePlan::from_env(&env_with(&[
            ("DEV_DANGEROUS_LOCAL_CONTAINERS", "true"),
            ("LOCAL_CONTAINER_IMAGE", "my-sandbox:dev"),
        ])),
        Some(EnsurePlan {
            tag: "my-sandbox:dev".to_owned(),
        })
    );
}

#[test]
fn docker_build_args_match_the_cli() {
    let args = build_args(DEFAULT_LOCAL_TAG, Path::new(CONTEXT_REL));
    assert_eq!(args, ["build", "--tag", DEFAULT_LOCAL_TAG, CONTEXT_REL]);
    assert!(
        !args.iter().any(|arg| arg == "--platform"),
        "pinning a platform would qemu Apple Silicon: {args:?}"
    );
}

#[test]
fn no_build_still_plans_the_tag() {
    // `--no-build` is an ensure() argument (CI bake / Cloud install), not an env flag.
    // The plan is unchanged so stack-up still documents which preloaded tag it
    // expects; docker is simply not invoked.
    assert_eq!(
        EnsurePlan::from_env(&env_with(&[("DEV_DANGEROUS_LOCAL_CONTAINERS", "true")])),
        Some(EnsurePlan {
            tag: DEFAULT_LOCAL_TAG.to_owned(),
        })
    );
}
