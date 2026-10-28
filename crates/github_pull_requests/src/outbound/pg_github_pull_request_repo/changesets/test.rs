use git_patch::FileChangeKind;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;

fn changeset(head_sha: &str) -> GithubPullRequestChangeset {
    let pull_request = PullRequestRef {
        repository: RepositorySlug {
            owner: "macro".to_string(),
            name: "app".to_string(),
        },
        number: NonZeroU64::new(7).unwrap(),
    };
    GithubPullRequestChangeset {
        id: crate::domain::models::changeset_id(&pull_request, "base-sha", head_sha),
        github_key: "macro/app/pull/7".to_string(),
        range: ChangesetRange {
            repository: Some(pull_request.repository.https_url()),
            base: GitRef {
                name: Some("main".to_string()),
                sha: Some("base-sha".to_string()),
            },
            head: GitRef {
                name: Some("feature".to_string()),
                sha: Some(head_sha.to_string()),
            },
        },
        pull_request,
        files: vec![ChangedFile {
            path: "a.rs".to_string(),
            previous_path: None,
            kind: FileChangeKind::Modified,
            additions: 1,
            deletions: 1,
            binary: false,
            patch_omitted: false,
        }],
        additions: 1,
        deletions: 1,
        patch_bytes: 42,
        truncated: false,
        patch_key: Some(format!(
            "pull-requests/macro/app/7/base-sha...{head_sha}.patch"
        )),
        captured_at: chrono::DateTime::parse_from_rfc3339("2026-09-27T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_changeset_reads_back_as_stored_and_is_stored_once(pool: PgPool) {
    let repo = PgGithubPullRequestRepo::new(pool);
    let stored = changeset("head-1");

    repo.insert_changeset(&stored).await.unwrap();
    repo.insert_changeset(&GithubPullRequestChangeset {
        truncated: true,
        ..stored.clone()
    })
    .await
    .unwrap();

    assert_eq!(repo.get_changeset(stored.id).await.unwrap(), Some(stored));
    assert_eq!(
        repo.get_changeset(changeset("head-2").id).await.unwrap(),
        None
    );
}
