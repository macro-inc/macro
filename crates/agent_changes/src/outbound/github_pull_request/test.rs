use super::*;

#[test]
fn metadata_uses_the_prs_actual_base_and_head_including_a_fork() {
    let metadata: PullRequestMetadata = serde_json::from_value(serde_json::json!({
        "base": { "ref": "release/v2", "sha": "base-sha", "repo": { "full_name": "upstream/repo" } },
        "head": { "ref": "fix", "sha": "head-sha", "repo": { "full_name": "contributor/repo" } }
    })).unwrap();
    let base: GitRef = metadata.base.into();
    let head: GitRef = metadata.head.into();
    assert_eq!(base.name.as_deref(), Some("release/v2"));
    assert_eq!(base.sha.as_deref(), Some("base-sha"));
    assert_eq!(head.name.as_deref(), Some("fix"));
    assert_eq!(head.sha.as_deref(), Some("head-sha"));
}

#[test]
fn inaccessible_or_oversized_diffs_map_to_unavailable_states() {
    assert!(matches!(
        status_error(StatusCode::NOT_FOUND, ""),
        CompareError::NotFound
    ));
    assert!(matches!(
        status_error(StatusCode::FORBIDDEN, ""),
        CompareError::Unavailable
    ));
    assert!(matches!(
        status_error(StatusCode::UNAUTHORIZED, ""),
        CompareError::Unavailable
    ));
    assert!(matches!(
        status_error(StatusCode::NOT_ACCEPTABLE, ""),
        CompareError::TooLarge
    ));
    assert!(matches!(
        status_error(StatusCode::BAD_GATEWAY, ""),
        CompareError::Other(_)
    ));
}
