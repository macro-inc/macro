use super::*;

fn pull_request(status: Option<&str>, name: Option<&str>) -> GithubPullRequest {
    let mut pull_request = GithubPullRequest::from_github_key("org/repo/pull/7").unwrap();
    pull_request.status = status.map(str::to_owned);
    pull_request.name = name.map(str::to_owned);
    pull_request
}

#[test]
fn maps_indexed_and_unindexed_pull_requests() {
    assert_eq!(
        task_pull_request(pull_request(Some("merged"), Some("Fix the thing"))),
        TaskPullRequest {
            url: "https://github.com/org/repo/pull/7".to_owned(),
            title: Some("Fix the thing".to_owned()),
            state: Some(PullRequestState::Merged),
        }
    );
    for (status, state) in [
        ("open", PullRequestState::Open),
        ("closed", PullRequestState::Closed),
    ] {
        assert_eq!(
            task_pull_request(pull_request(Some(status), None)).state,
            Some(state)
        );
    }
    assert_eq!(
        task_pull_request(pull_request(None, None)),
        TaskPullRequest {
            url: "https://github.com/org/repo/pull/7".to_owned(),
            title: None,
            state: None,
        }
    );
}

#[test]
fn hidden_and_missing_tasks_look_alike_and_other_documents_are_not_tasks() {
    assert!(matches!(
        access_error(AccessError::Unauthorized),
        SessionTaskError::TaskNotFound
    ));
    assert!(matches!(
        access_error(AccessError::NotFound("document")),
        SessionTaskError::TaskNotFound
    ));
    assert!(matches!(
        document_error(DocumentError::NotFound("task".to_owned())),
        SessionTaskError::TaskNotFound
    ));
    assert!(matches!(
        document_error(DocumentError::BadRequest(
            "document is not a task".to_owned()
        )),
        SessionTaskError::NotATask
    ));
    assert!(matches!(
        document_error(DocumentError::Internal(anyhow::anyhow!("database down"))),
        SessionTaskError::Unavailable(_)
    ));
}

const TASK: &str = "0199c0a8-7d3e-7c1a-9b5e-3f2a1c4d5e6f";
const OTHER_TASK: &str = "0199c0a8-7d3e-7c1a-9b5e-3f2a1c4d5e70";

async fn session_entries(pool: &PgPool, session: AgentSessionId) -> Vec<(String, String, String)> {
    sqlx::query!(
        r#"SELECT source_entity_type, entity_type, entity_id, user_id
        FROM comms_entity_mentions WHERE source_entity_id = $1"#,
        session.to_string(),
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.source_entity_type,
            format!("{}:{}", row.entity_type, row.entity_id),
            row.user_id.unwrap_or_default(),
        )
    })
    .collect()
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_session_is_listed_under_one_task_at_a_time(pool: PgPool) {
    let references = CommsSessionTaskReferences::new(pool.clone());
    let session = AgentSessionId::new();
    let other_session = AgentSessionId::new();
    let owner = MacroUserIdStr::try_from_email("owner@example.com").unwrap();

    references
        .replace(
            session,
            &owner,
            &TaskDocumentId::from_stored(TASK.to_owned()),
        )
        .await
        .unwrap();
    references
        .replace(
            other_session,
            &owner,
            &TaskDocumentId::from_stored(TASK.to_owned()),
        )
        .await
        .unwrap();
    assert_eq!(
        session_entries(&pool, session).await,
        [(
            "agent_session".to_owned(),
            format!("document:{TASK}"),
            owner.as_ref().to_owned()
        )]
    );

    for _ in 0..2 {
        references
            .replace(
                session,
                &owner,
                &TaskDocumentId::from_stored(OTHER_TASK.to_owned()),
            )
            .await
            .unwrap();
    }

    assert_eq!(
        session_entries(&pool, session).await,
        [(
            "agent_session".to_owned(),
            format!("document:{OTHER_TASK}"),
            owner.as_ref().to_owned()
        )]
    );
    assert_eq!(session_entries(&pool, other_session).await.len(), 1);
}
