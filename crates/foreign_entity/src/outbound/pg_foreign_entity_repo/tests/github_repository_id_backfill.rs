use super::*;

use crate::domain::models::{GITHUB_PULL_REQUEST_SOURCE, GithubRepositoryIdentity};
use crate::domain::ports::GithubRepositoryIdBackfillRepository;

const USER: &str = "macro|user@example.com";

async fn insert_record(
    repo: &PgForeignEntityRepo,
    foreign_entity_id: &str,
    foreign_entity_source: &str,
    metadata: serde_json::Value,
) -> ForeignEntity {
    repo.create_foreign_entity(
        Uuid::now_v7(),
        CreateForeignEntity {
            foreign_entity_id: foreign_entity_id.into(),
            foreign_entity_source: foreign_entity_source.into(),
            metadata,
            stored_for_id: USER.into(),
            stored_for_auth_entity: "user".into(),
        },
    )
    .await
    .expect("foreign entity should be inserted")
}

async fn reload(repo: &PgForeignEntityRepo, entity: &ForeignEntity) -> ForeignEntity {
    repo.get_foreign_entity_by_id(entity.id)
        .await
        .expect("lookup should succeed")
        .expect("record should exist")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_repository_ids_are_filled_by_case_insensitive_name(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let missing = insert_record(
        &repo,
        "macro-inc/macro/pull/1",
        GITHUB_PULL_REQUEST_SOURCE,
        json!({ "owner": "Macro-Inc", "repo": "Macro", "status": "open" }),
    )
    .await;
    let already_set = insert_record(
        &repo,
        "macro-inc/macro/pull/2",
        GITHUB_PULL_REQUEST_SOURCE,
        json!({ "owner": "macro-inc", "repo": "macro", "repositoryId": 999 }),
    )
    .await;
    let other_repository = insert_record(
        &repo,
        "macro-inc/unlisted/pull/3",
        GITHUB_PULL_REQUEST_SOURCE,
        json!({ "owner": "macro-inc", "repo": "unlisted" }),
    )
    .await;
    let other_source = insert_record(
        &repo,
        "linear-issue",
        "linear_issue",
        json!({ "owner": "macro-inc", "repo": "macro" }),
    )
    .await;

    let updated = repo
        .set_missing_github_repository_ids(&[GithubRepositoryIdentity {
            id: 100,
            owner: "macro-inc".to_string(),
            name: "macro".to_string(),
        }])
        .await
        .expect("backfill should succeed");

    assert_eq!(updated, 1);
    let filled = reload(&repo, &missing).await;
    assert_eq!(filled.metadata.get("repositoryId"), Some(&json!(100)));
    assert_eq!(filled.metadata.get("status"), Some(&json!("open")));
    assert_eq!(
        filled.updated_at, missing.updated_at,
        "the backfill must not reorder lists sorted by updated_at"
    );
    assert_eq!(
        reload(&repo, &already_set)
            .await
            .metadata
            .get("repositoryId"),
        Some(&json!(999))
    );
    assert_eq!(
        reload(&repo, &other_repository)
            .await
            .metadata
            .get("repositoryId"),
        None
    );
    assert_eq!(
        reload(&repo, &other_source)
            .await
            .metadata
            .get("repositoryId"),
        None
    );

    let rerun = repo
        .set_missing_github_repository_ids(&[GithubRepositoryIdentity {
            id: 100,
            owner: "macro-inc".to_string(),
            name: "macro".to_string(),
        }])
        .await
        .expect("a rerun should succeed");
    assert_eq!(rerun, 0);
}
