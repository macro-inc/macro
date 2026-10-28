use super::*;

fn candidate(id: u128, key: &str) -> PullRequestIndexRecord {
    let parts: Vec<_> = key.split('/').collect();
    PullRequestIndexRecord {
        id: Uuid::from_u128(id),
        source: GITHUB_PULL_REQUEST_FOREIGN_ENTITY_SOURCE.into(),
        github_key: key.into(),
        updated_at: DateTime::from_timestamp(id as i64, 0).unwrap(),
        metadata: serde_json::json!({
            "githubKey": key, "repositoryId": 99, "owner": parts[0], "repo": parts[1],
            "number": parts[3].parse::<u64>().unwrap(),
            "url": format!("https://github.com/{key}"), "displayName": "PR", "status": "open"
        }),
    }
}

fn repository() -> GithubRepositoryIdentity {
    GithubRepositoryIdentity {
        id: 99,
        owner: "macro".into(),
        name: "app".into(),
    }
}

async fn index(rows: &StubPullRequestRows) -> crate::domain::models::PullRequestIndexSummary {
    service(&StubForeignEntityService::default(), rows)
        .index_repositories(&[repository()])
        .await
        .unwrap()
}

#[tokio::test]
async fn missing_row_recovers_all_verified_sources_and_case_variants() {
    let rows = StubPullRequestRows::default();
    let mut rich = candidate(1, GITHUB_KEY);
    rich.metadata["draft"] = true.into();
    rich.metadata["labels"] = serde_json::json!([{"name":"bug"}]);
    rich.metadata["reviews"] = serde_json::json!([{
        "id": 1, "reviewerGithubUserId": "42", "state": "approved",
        "submittedAt": "2026-01-01T00:00:00Z"
    }]);
    rich.metadata["base"] = serde_json::json!({"name":"main", "sha":"base-sha"});
    rich.metadata["head"] = serde_json::json!({"name":"feature", "sha":"head-sha"});
    let mut sparse = candidate(2, "Macro/App/pull/7");
    sparse.metadata["status"] = "closed".into();
    rows.stored.lock().unwrap().extend([sparse, rich]);
    let summary = index(&rows).await;
    assert_eq!(summary.inserted, 1);
    assert!(!summary.has_failures());
    let result = rows.rows();
    assert_eq!(result.len(), 1);
    assert!(result[0].draft);
    assert_eq!(result[0].labels.len(), 1);
    assert_eq!(
        result[0].review_decision,
        Some(GithubPullRequestReviewDecision::Approved)
    );
    assert_eq!(result[0].status, Some(GithubPullRequestStatus::Closed));
    assert_eq!(
        result[0].head.as_ref().unwrap().sha.as_deref(),
        Some("head-sha")
    );
}

#[tokio::test]
async fn explicit_empty_fields_clear_and_refs_replace_as_pairs() {
    let rows = StubPullRequestRows::default();
    let mut rich = candidate(1, GITHUB_KEY);
    rich.metadata["assignees"] = serde_json::json!([{"githubUserId":"42"}]);
    rich.metadata["labels"] = serde_json::json!([{"name":"bug"}]);
    rich.metadata["requestedReviewerGithubUserIds"] = serde_json::json!(["42"]);
    rich.metadata["base"] = serde_json::json!({"name":"main", "sha":"old-base"});
    rich.metadata["head"] = serde_json::json!({"name":"old-feature", "sha":"old-head"});
    let mut update = candidate(2, GITHUB_KEY);
    for field in ["assignees", "labels", "requestedReviewerGithubUserIds"] {
        update.metadata[field] = serde_json::json!([]);
    }
    update.metadata["base"] = serde_json::json!({"name":"new-base"});
    update.metadata["head"] = serde_json::json!({"sha":"new-head"});
    rows.stored.lock().unwrap().extend([rich, update]);
    assert_eq!(index(&rows).await.inserted, 1);
    let row = &rows.rows()[0];
    assert!(
        row.assignees.is_empty()
            && row.labels.is_empty()
            && row.requested_reviewer_github_user_ids.is_empty()
    );
    assert_eq!(row.base.as_ref().unwrap().name.as_deref(), Some("new-base"));
    assert_eq!(row.base.as_ref().unwrap().sha, None);
    assert_eq!(row.head.as_ref().unwrap().name, None);
    assert_eq!(row.head.as_ref().unwrap().sha.as_deref(), Some("new-head"));
}

#[tokio::test]
async fn legacy_and_reused_repository_names_never_supply_identity() {
    let rows = StubPullRequestRows::default();
    let mut legacy = candidate(1, GITHUB_KEY);
    legacy
        .metadata
        .as_object_mut()
        .unwrap()
        .remove("repositoryId");
    legacy.metadata["labels"] = serde_json::json!([{"name":"unverified"}]);
    let mut reused = candidate(2, GITHUB_KEY);
    reused.metadata["repositoryId"] = 100.into();
    rows.stored.lock().unwrap().extend([legacy, reused]);
    let result = index(&rows).await;
    assert_eq!(result.unverified_records, 1);
    assert_eq!(result.identity_conflicts, 1);
    assert!(result.has_failures());
    assert!(rows.rows().is_empty());
    rows.stored.lock().unwrap().push(candidate(3, GITHUB_KEY));
    assert_eq!(index(&rows).await.inserted, 1);
    assert!(rows.rows()[0].labels.is_empty());
}

#[tokio::test]
async fn malformed_keys_sources_and_numeric_ids_are_rejected() {
    let rows = StubPullRequestRows::default();
    let mut records = Vec::new();
    for (field, value) in [
        ("repositoryId", serde_json::json!(0)),
        ("repositoryId", serde_json::json!(u64::MAX)),
        ("number", serde_json::json!(0)),
        ("number", serde_json::json!(u64::MAX)),
        ("owner", serde_json::json!("other")),
        ("repo", serde_json::json!("other")),
        ("githubKey", serde_json::json!("macro/app/pull/8")),
    ] {
        let mut record = candidate(1, GITHUB_KEY);
        record.metadata[field] = value;
        records.push(record);
    }
    let mut wrong_source = candidate(2, GITHUB_KEY);
    wrong_source.source = "linear_issue".into();
    records.push(wrong_source);
    let mut wrong_key = candidate(3, "macro/app/pull/8");
    wrong_key.metadata = candidate(3, GITHUB_KEY).metadata;
    records.push(wrong_key);
    rows.stored.lock().unwrap().extend(records);
    let result = index(&rows).await;
    assert_eq!(result.invalid_records, 9);
    assert!(rows.rows().is_empty());
}

#[tokio::test]
async fn retries_leave_existing_typed_values_untouched() {
    let rows = StubPullRequestRows::default();
    rows.stored.lock().unwrap().push(candidate(1, GITHUB_KEY));
    assert_eq!(index(&rows).await.inserted, 1);
    let before = rows.rows();
    rows.stored.lock().unwrap()[0].metadata["status"] = "closed".into();
    let result = index(&rows).await;
    assert_eq!(result.inserted, 0);
    assert_eq!(result.already_present, 1);
    assert_eq!(rows.rows(), before);
}

#[tokio::test]
async fn existing_unverified_or_conflicting_rows_are_not_reassigned() {
    for id in [None, Some(100)] {
        let rows = StubPullRequestRows::default();
        let mut existing =
            GithubPullRequestRow::from_metadata(&candidate(1, GITHUB_KEY).metadata).unwrap();
        existing.repository_id = id;
        rows.rows.lock().unwrap().push(existing.clone());
        rows.stored.lock().unwrap().push(candidate(2, GITHUB_KEY));
        assert_eq!(index(&rows).await.identity_conflicts, 1);
        assert_eq!(rows.rows(), vec![existing]);
    }
}

#[tokio::test]
async fn tied_source_times_use_record_id_not_input_order() {
    let rows = StubPullRequestRows::default();
    let mut older = candidate(1, GITHUB_KEY);
    older.metadata["name"] = "earlier-id".into();
    let mut newer = candidate(2, GITHUB_KEY);
    newer.updated_at = older.updated_at;
    newer.metadata["name"] = "later-id".into();
    rows.stored.lock().unwrap().extend([newer, older]);
    assert_eq!(index(&rows).await.inserted, 1);
    assert_eq!(rows.rows()[0].title.as_deref(), Some("later-id"));
}

#[tokio::test]
async fn failures_do_not_stop_independent_records_or_repositories() {
    let rows = StubPullRequestRows::default();
    rows.index_write_failures.lock().unwrap().push(7);
    rows.index_read_failures
        .lock()
        .unwrap()
        .push("macro/broken/pull/".into());
    rows.stored
        .lock()
        .unwrap()
        .extend([candidate(1, GITHUB_KEY), candidate(2, "macro/app/pull/8")]);
    let result = service(&StubForeignEntityService::default(), &rows)
        .index_repositories(&[
            GithubRepositoryIdentity {
                id: 99,
                owner: "macro".into(),
                name: "broken".into(),
            },
            repository(),
            GithubRepositoryIdentity {
                id: u64::MAX,
                ..repository()
            },
            GithubRepositoryIdentity {
                id: 0,
                ..repository()
            },
        ])
        .await
        .unwrap();
    assert_eq!(result.inserted, 1);
    assert_eq!(result.failures, 4);
    assert_eq!(rows.rows()[0].number, 8);
}

#[tokio::test]
async fn invalid_installation_repository_names_are_rejected_before_scanning() {
    let rows = StubPullRequestRows::default();
    let invalid = [("", "app"), ("macro/other", "app"), ("macro", "app/pull/7")]
        .into_iter()
        .map(|(owner, name)| GithubRepositoryIdentity {
            id: 99,
            owner: owner.into(),
            name: name.into(),
        })
        .collect::<Vec<_>>();
    let result = service(&StubForeignEntityService::default(), &rows)
        .index_repositories(&invalid)
        .await
        .unwrap();
    assert_eq!(result.failures, 3);
    assert_eq!(result.inserted, 0);
    assert!(rows.rows().is_empty());
}
