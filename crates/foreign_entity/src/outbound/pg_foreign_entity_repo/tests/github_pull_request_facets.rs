use super::*;

use crate::domain::models::{
    GITHUB_PULL_REQUEST_SOURCE, GithubAuthorFacet, GithubPullRequestFacets, GithubRepositoryFacet,
};
use crate::domain::ports::GithubPullRequestFacetRepository;

const USER: &str = "macro|user@example.com";
const TEAM_ID: &str = "cccccccc-cccc-cccc-cccc-cccccccccccc";

async fn insert_pr_for(
    repo: &PgForeignEntityRepo,
    foreign_entity_id: &str,
    stored_for: &SourceId,
    metadata: serde_json::Value,
) -> ForeignEntity {
    repo.create_foreign_entity(
        Uuid::now_v7(),
        CreateForeignEntity {
            foreign_entity_id: foreign_entity_id.into(),
            foreign_entity_source: GITHUB_PULL_REQUEST_SOURCE.into(),
            metadata,
            stored_for_id: stored_for.id.clone(),
            stored_for_auth_entity: stored_for.auth_entity.clone(),
        },
    )
    .await
    .expect("pull request foreign entity should be inserted")
}

fn pr_metadata(
    repository_id: u64,
    repo: &str,
    author_id: u64,
    author_login: &str,
) -> serde_json::Value {
    json!({
        "repositoryId": repository_id,
        "owner": "macro-inc",
        "repo": repo,
        "authorId": author_id,
        "authorLogin": author_login,
    })
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn facets_count_each_pull_request_once_within_the_supplied_sources(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    let user = SourceId::user(USER);
    let team = SourceId::new(TEAM_ID, "team");
    let other_team = SourceId::new("dddddddd-dddd-dddd-dddd-dddddddddddd", "team");

    insert_pr_for(
        &repo,
        "macro-inc/macro/pull/1",
        &user,
        pr_metadata(100, "macro", 7, "ada"),
    )
    .await;
    // The same pull request stored for the team as well counts once.
    insert_pr_for(
        &repo,
        "macro-inc/macro/pull/1",
        &team,
        pr_metadata(100, "macro", 7, "ada"),
    )
    .await;
    insert_pr_for(
        &repo,
        "macro-inc/macro/pull/2",
        &team,
        pr_metadata(100, "macro", 42, "grace"),
    )
    .await;
    insert_pr_for(
        &repo,
        "macro-inc/docs/pull/3",
        &team,
        pr_metadata(200, "docs", 7, "ada"),
    )
    .await;
    // Synced before repository ids were stored: counted for its author, not for a repository.
    insert_pr_for(
        &repo,
        "macro-inc/legacy/pull/4",
        &user,
        json!({ "owner": "macro-inc", "repo": "legacy", "authorId": 42, "authorLogin": "grace" }),
    )
    .await;
    // Records outside the supplied sources and other sources are ignored.
    insert_pr_for(
        &repo,
        "macro-inc/secret/pull/5",
        &other_team,
        pr_metadata(300, "secret", 99, "eve"),
    )
    .await;
    insert_foreign_entity_for_source(&repo, "linear-issue", "linear_issue", USER, "user").await;

    let facets = repo
        .get_github_pull_request_facets(vec![user, team])
        .await
        .expect("facets should load");

    assert_eq!(
        facets,
        GithubPullRequestFacets {
            repositories: vec![
                GithubRepositoryFacet {
                    repository_id: "100".to_string(),
                    repository: "macro-inc/macro".to_string(),
                    count: 2,
                },
                GithubRepositoryFacet {
                    repository_id: "200".to_string(),
                    repository: "macro-inc/docs".to_string(),
                    count: 1,
                },
            ],
            authors: vec![
                GithubAuthorFacet {
                    github_user_id: "7".to_string(),
                    login: Some("ada".to_string()),
                    count: 2,
                },
                GithubAuthorFacet {
                    github_user_id: "42".to_string(),
                    login: Some("grace".to_string()),
                    count: 2,
                },
            ],
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn facets_label_repositories_and_authors_with_their_most_recently_synced_names(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool.clone());
    let user = SourceId::user(USER);
    let older = insert_pr_for(
        &repo,
        "macro-inc/old-name/pull/1",
        &user,
        pr_metadata(100, "old-name", 7, "old-login"),
    )
    .await;
    let newer = insert_pr_for(
        &repo,
        "macro-inc/macro/pull/2",
        &user,
        pr_metadata(100, "macro", 7, "new-login"),
    )
    .await;
    let now = Utc::now();
    // The newer names get the earlier creation time so only updated_at decides the winner.
    set_timestamps(
        &pool,
        &repo,
        &newer,
        now - chrono::Duration::minutes(2),
        now - chrono::Duration::minutes(1),
    )
    .await;
    set_timestamps(
        &pool,
        &repo,
        &older,
        now - chrono::Duration::minutes(1),
        now - chrono::Duration::minutes(2),
    )
    .await;

    let facets = repo
        .get_github_pull_request_facets(vec![user])
        .await
        .expect("facets should load");

    assert_eq!(
        facets,
        GithubPullRequestFacets {
            repositories: vec![GithubRepositoryFacet {
                repository_id: "100".to_string(),
                repository: "macro-inc/macro".to_string(),
                count: 2,
            }],
            authors: vec![GithubAuthorFacet {
                github_user_id: "7".to_string(),
                login: Some("new-login".to_string()),
                count: 2,
            }],
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn facets_without_sources_are_empty(pool: PgPool) {
    let repo = PgForeignEntityRepo::new(pool);
    insert_pr_for(
        &repo,
        "macro-inc/macro/pull/1",
        &SourceId::user(USER),
        pr_metadata(100, "macro", 7, "ada"),
    )
    .await;

    let facets = repo
        .get_github_pull_request_facets(Vec::new())
        .await
        .expect("facets should load");

    assert_eq!(facets, GithubPullRequestFacets::default());
}
