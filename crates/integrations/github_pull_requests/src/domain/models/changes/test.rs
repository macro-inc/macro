use std::num::NonZeroU64;

use super::*;
use crate::domain::models::RepositorySlug;

fn pull_request(owner: &str) -> PullRequestRef {
    PullRequestRef {
        repository: RepositorySlug {
            owner: owner.to_string(),
            name: "App".to_string(),
        },
        number: NonZeroU64::new(7).unwrap(),
    }
}

#[test]
fn the_same_pull_request_and_commits_give_the_same_id_whatever_the_case() {
    assert_eq!(
        changeset_id(&pull_request("Macro"), "base", "head"),
        changeset_id(&pull_request("macro"), "base", "head"),
    );
    assert_ne!(
        changeset_id(&pull_request("macro"), "base", "head"),
        changeset_id(&pull_request("macro"), "base", "new-head"),
    );
}

#[test]
fn patch_keys_name_the_pull_request_and_both_commits() {
    assert_eq!(
        changeset_patch_key(&pull_request("Macro"), "base", "head"),
        "pull-requests/macro/app/7/base...head.patch"
    );
    assert_eq!(github_key_of(&pull_request("Macro")), "Macro/App/pull/7");
}
