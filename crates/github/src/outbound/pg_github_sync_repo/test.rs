use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::models::{
    GithubAppInstallationSource, GithubKey, MacroTaskId, ResolvedTeamTaskReference,
    TeamTaskReference,
};
use crate::domain::ports::GithubSyncRepo;
use crate::outbound::pg_github_sync_repo::PgGithubSyncRepo;

// ---------------------------------------------------------------------------
// get_task_ids
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_get_task_ids(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "my-repo", 1);
    let task_ids = repo.get_task_ids(key).await.unwrap();

    assert_eq!(task_ids.len(), 2);
    let shorts: Vec<&str> = task_ids.iter().map(|t| t.short_uuid.as_str()).collect();
    assert!(shorts.contains(&"s61deeZUHehUjkNT8rxB3S"));
    assert!(shorts.contains(&"bMv3eymKvu18qsQyrpt1VH"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_get_task_ids_different_pr(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "other-repo", 42);
    let task_ids = repo.get_task_ids(key).await.unwrap();

    assert_eq!(task_ids.len(), 1);
    assert_eq!(task_ids[0].short_uuid, "xdyzHm2ZVGr6UAkaeBCUxZ");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_task_ids_empty(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("no-org", "no-repo", 999);
    let task_ids = repo.get_task_ids(key).await.unwrap();

    assert!(task_ids.is_empty());
}

// ---------------------------------------------------------------------------
// upsert_task_ids
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_upsert_task_ids_inserts_new(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("org", "repo", 10);
    let tasks = vec![
        MacroTaskId::from_short_uuid("xoyQ8nrV6PNZFmpsWYMdyC").unwrap(),
        MacroTaskId::from_short_uuid("2ZbZ7wJQfEMWyBSycKYTYr").unwrap(),
    ];

    repo.upsert_task_ids(key.clone(), &tasks).await.unwrap();

    let fetched = repo.get_task_ids(key).await.unwrap();
    assert_eq!(fetched.len(), 2);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_upsert_task_ids_ignores_duplicates(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "my-repo", 1);
    let tasks = vec![
        MacroTaskId::from_short_uuid("s61deeZUHehUjkNT8rxB3S").unwrap(), // already exists
        MacroTaskId::from_short_uuid("xoyQ8nrV6PNZFmpsWYMdyC").unwrap(),
    ];

    repo.upsert_task_ids(key.clone(), &tasks).await.unwrap();

    let fetched = repo.get_task_ids(key).await.unwrap();
    assert_eq!(fetched.len(), 3); // s61dee.., bMv3e.. (existing) + xoyQ8..
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_team_task_test_data"))
)]
async fn test_upsert_task_ids_records_owning_team(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool.clone());

    // 0d0dc589-f301-43f1-8b11-4ab448ca4bb4 is team task ENG-123 of team
    // dddddddd-...; the second task id has no team_task row.
    let team_task =
        MacroTaskId::from_uuid(&Uuid::parse_str("0d0dc589-f301-43f1-8b11-4ab448ca4bb4").unwrap());
    let teamless_task = MacroTaskId::from_short_uuid("xoyQ8nrV6PNZFmpsWYMdyC").unwrap();

    let key = GithubKey::new("org", "repo", 10);
    repo.upsert_task_ids(key.clone(), &[team_task.clone(), teamless_task.clone()])
        .await
        .unwrap();

    let rows = sqlx::query!(
        r#"SELECT task_id, team_id FROM github_pr_tasks WHERE github_key = $1"#,
        key.as_ref()
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 2);
    let expected_team = Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap();
    for row in rows {
        if row.task_id == team_task.short_uuid {
            assert_eq!(row.team_id, Some(expected_team));
        } else {
            assert_eq!(row.task_id, teamless_task.short_uuid);
            assert_eq!(row.team_id, None);
        }
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_team_task_test_data"))
)]
async fn test_upsert_task_ids_backfills_team_on_existing_rows(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool.clone());

    let team_task =
        MacroTaskId::from_uuid(&Uuid::parse_str("0d0dc589-f301-43f1-8b11-4ab448ca4bb4").unwrap());
    let key = GithubKey::new("org", "repo", 10);

    // Simulate a legacy row written before team_id existed.
    sqlx::query!(
        r#"INSERT INTO github_pr_tasks (id, github_key, task_id) VALUES ($1, $2, $3)"#,
        macro_uuid::generate_uuid_v7(),
        key.as_ref(),
        &team_task.short_uuid
    )
    .execute(&pool)
    .await
    .unwrap();

    repo.upsert_task_ids(key.clone(), std::slice::from_ref(&team_task))
        .await
        .unwrap();

    let rows = sqlx::query!(
        r#"SELECT team_id FROM github_pr_tasks WHERE github_key = $1 AND task_id = $2"#,
        key.as_ref(),
        &team_task.short_uuid
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].team_id,
        Some(Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap())
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_upsert_task_ids_empty_list(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("org", "repo", 1);
    repo.upsert_task_ids(key.clone(), &[]).await.unwrap();

    let fetched = repo.get_task_ids(key).await.unwrap();
    assert!(fetched.is_empty());
}

// ---------------------------------------------------------------------------
// filter_duplicate_tasks
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_filter_duplicate_tasks_removes_existing(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "my-repo", 1);
    let candidates = vec![
        MacroTaskId::from_short_uuid("s61deeZUHehUjkNT8rxB3S").unwrap(), // exists
        MacroTaskId::from_short_uuid("bMv3eymKvu18qsQyrpt1VH").unwrap(), // exists
        MacroTaskId::from_short_uuid("xoyQ8nrV6PNZFmpsWYMdyC").unwrap(),
    ];

    let new_only = repo.filter_duplicate_tasks(key, &candidates).await.unwrap();

    assert_eq!(new_only.len(), 1);
    assert_eq!(new_only[0].short_uuid, "xoyQ8nrV6PNZFmpsWYMdyC");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_filter_duplicate_tasks_all_new(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "my-repo", 1);
    let candidates = vec![
        MacroTaskId::from_short_uuid("xoyQ8nrV6PNZFmpsWYMdyC").unwrap(),
        MacroTaskId::from_short_uuid("2ZbZ7wJQfEMWyBSycKYTYr").unwrap(),
    ];

    let new_only = repo.filter_duplicate_tasks(key, &candidates).await.unwrap();

    assert_eq!(new_only.len(), 2);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_filter_duplicate_tasks_all_existing(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("my-org", "my-repo", 1);
    let candidates = vec![
        MacroTaskId::from_short_uuid("s61deeZUHehUjkNT8rxB3S").unwrap(),
        MacroTaskId::from_short_uuid("bMv3eymKvu18qsQyrpt1VH").unwrap(),
    ];

    let new_only = repo.filter_duplicate_tasks(key, &candidates).await.unwrap();

    assert!(new_only.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_filter_duplicate_tasks_empty_input(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let key = GithubKey::new("org", "repo", 1);
    let new_only = repo.filter_duplicate_tasks(key, &[]).await.unwrap();

    assert!(new_only.is_empty());
}

// ---------------------------------------------------------------------------
// resolve_team_task_references
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_team_task_test_data"))
)]
async fn test_resolve_team_task_references(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let refs = vec![
        TeamTaskReference::new("eng", 123).unwrap(),
        TeamTaskReference::new("platform_api", 7).unwrap(),
    ];

    let resolutions = repo
        .resolve_team_task_references("12345", &refs)
        .await
        .unwrap();

    let expected_known = ResolvedTeamTaskReference {
        reference: TeamTaskReference::new("eng", 123).unwrap(),
        team_id: Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap(),
        task_id: MacroTaskId::from_uuid(
            &Uuid::parse_str("0d0dc589-f301-43f1-8b11-4ab448ca4bb4").unwrap(),
        ),
    };
    let expected_platform = ResolvedTeamTaskReference {
        reference: TeamTaskReference::new("platform_api", 7).unwrap(),
        team_id: Uuid::parse_str("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee").unwrap(),
        task_id: MacroTaskId::from_uuid(
            &Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap(),
        ),
    };

    assert_eq!(resolutions.len(), 2);
    assert!(resolutions.contains(&expected_known));
    assert!(resolutions.contains(&expected_platform));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_team_task_test_data"))
)]
async fn test_resolve_team_task_references_returns_all_teams_sharing_a_slug(pool: Pool<Postgres>) {
    // Give the installation a second team whose slug is also ENG, with its
    // own task 123. The resolver reports both matches (with their teams) so
    // the service can detect the ambiguity.
    sqlx::query!(
        r#"
        WITH new_macro_user AS (
            INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES ('99999999-9999-9999-9999-999999999999'::uuid, 'owner3', 'owner3@test.com', 'cus_test3')
        ), new_user AS (
            INSERT INTO "User" (id, email, macro_user_id)
            VALUES ('macro|owner3@user.com', 'owner3@test.com', '99999999-9999-9999-9999-999999999999'::uuid)
            RETURNING id
        ), new_team AS (
            INSERT INTO team (id, name, owner_id, slug)
            SELECT 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, 'Other Eng', new_user.id, 'ENG' FROM new_user
            RETURNING id
        ), new_doc AS (
            INSERT INTO "Document" (id, name, "fileType", owner)
            VALUES ('22222222-2222-2222-2222-222222222222', 'Other Task', 'md', 'macro|owner2@user.com')
            RETURNING id
        ), new_task AS (
            INSERT INTO team_task (team_id, document_id, task_num)
            SELECT new_team.id, new_doc.id, 123 FROM new_team, new_doc
        )
        INSERT INTO github_app_installation (id, source_id, source_type)
        SELECT '12345', new_team.id::text, 'team'::github_app_installation_source_type FROM new_team
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let repo = PgGithubSyncRepo::new(pool);
    let refs = vec![TeamTaskReference::new("eng", 123).unwrap()];

    let resolutions = repo
        .resolve_team_task_references("12345", &refs)
        .await
        .unwrap();

    assert_eq!(resolutions.len(), 2);
    let team_ids: Vec<Uuid> = resolutions.iter().map(|r| r.team_id).collect();
    assert!(team_ids.contains(&Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap()));
    assert!(team_ids.contains(&Uuid::parse_str("ffffffff-ffff-ffff-ffff-ffffffffffff").unwrap()));
    for resolution in &resolutions {
        assert_eq!(
            resolution.reference,
            TeamTaskReference::new("eng", 123).unwrap()
        );
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_team_task_test_data"))
)]
async fn test_resolve_team_task_references_requires_team_source(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);
    let refs = vec![TeamTaskReference::new("eng", 123).unwrap()];

    let task_ids = repo
        .resolve_team_task_references("99999", &refs)
        .await
        .unwrap();

    assert!(task_ids.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_team_task_test_data"))
)]
async fn test_resolve_team_task_references_ignores_user_source(pool: Pool<Postgres>) {
    sqlx::query(
        r#"
        INSERT INTO github_app_installation (id, source_id, source_type)
        VALUES ($1, $2, 'user'::github_app_installation_source_type)
        "#,
    )
    .bind("user-installation")
    .bind("dddddddd-dddd-dddd-dddd-dddddddddddd")
    .execute(&pool)
    .await
    .unwrap();

    let repo = PgGithubSyncRepo::new(pool);
    let refs = vec![TeamTaskReference::new("eng", 123).unwrap()];

    let task_ids = repo
        .resolve_team_task_references("user-installation", &refs)
        .await
        .unwrap();

    assert!(task_ids.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_sync_test_data"))
)]
async fn test_filter_duplicate_tasks_different_key_not_filtered(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    // s61dee.. exists for my-org/my-repo/pull/1, but not for this key
    let key = GithubKey::new("my-org", "other-repo", 42);
    let candidates = vec![MacroTaskId::from_short_uuid("s61deeZUHehUjkNT8rxB3S").unwrap()];

    let new_only = repo.filter_duplicate_tasks(key, &candidates).await.unwrap();

    assert_eq!(new_only.len(), 1);
    assert_eq!(new_only[0].short_uuid, "s61deeZUHehUjkNT8rxB3S");
}

// ---------------------------------------------------------------------------
// get_installation_sources
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_team_task_test_data"))
)]
async fn test_get_installation_sources_returns_sources(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let sources = repo.get_installation_sources("12345").await.unwrap();

    assert_eq!(
        sources,
        vec![
            GithubAppInstallationSource::Team(
                "dddddddd-dddd-dddd-dddd-dddddddddddd".parse().unwrap()
            ),
            GithubAppInstallationSource::Team(
                "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee".parse().unwrap()
            ),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_installation_sources_empty(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let sources = repo.get_installation_sources("missing").await.unwrap();

    assert!(sources.is_empty());
}

// ---------------------------------------------------------------------------
// get_macro_ids_by_github_user_ids
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_get_macro_ids_by_github_user_ids_found(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let links = repo
        .get_macro_ids_by_github_user_ids(&["12345".to_string()])
        .await
        .unwrap();

    assert_eq!(
        links.get("12345"),
        Some(&vec!["macro|user@user.com".to_string()])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_macro_ids_by_github_user_ids_not_found(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let links = repo
        .get_macro_ids_by_github_user_ids(&["99999".to_string()])
        .await
        .unwrap();

    assert!(!links.contains_key("99999"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_get_macro_ids_by_github_user_ids_fans_out_to_multiple_users(pool: Pool<Postgres>) {
    // A second link sharing github_user_id '12345' (github_user_id is not unique;
    // multiple Macro users may share one GitHub account).
    sqlx::query(
        r#"
        INSERT INTO public.github_links (id, macro_id, fusionauth_user_id, github_username, github_user_id)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind("macro|user2@user.com")
    .bind(
        "cccccccc-cccc-cccc-cccc-cccccccccccc"
            .parse::<Uuid>()
            .unwrap(),
    )
    .bind("testuser2")
    .bind("12345")
    .execute(&pool)
    .await
    .unwrap();

    let repo = PgGithubSyncRepo::new(pool);

    let links = repo
        .get_macro_ids_by_github_user_ids(&["12345".to_string()])
        .await
        .unwrap();

    let mut macro_ids = links.get("12345").cloned().unwrap_or_default();
    macro_ids.sort();
    assert_eq!(
        macro_ids,
        vec![
            "macro|user2@user.com".to_string(),
            "macro|user@user.com".to_string(),
        ]
    );
}

// ---------------------------------------------------------------------------
// get_macro_ids_by_github_logins
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_get_macro_ids_by_github_logins_matches_case_insensitively(pool: Pool<Postgres>) {
    // A second link sharing the 'testuser' login (github_username is not unique).
    sqlx::query!(
        r#"
        INSERT INTO github_links (id, macro_id, fusionauth_user_id, github_username, github_user_id)
        VALUES ('11111111-2222-3333-4444-555555555555'::uuid, 'macro|user2@user.com', 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'TestUser', '54321')
        "#
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgGithubSyncRepo::new(pool);

    let links = repo
        .get_macro_ids_by_github_logins(&[
            "TESTUSER".to_string(),
            "solo".to_string(),
            "unlinked".to_string(),
        ])
        .await
        .unwrap();

    assert_eq!(links.len(), 2);
    let mut testuser_ids = links.get("testuser").cloned().unwrap_or_default();
    testuser_ids.sort();
    assert_eq!(
        testuser_ids,
        vec![
            "macro|user2@user.com".to_string(),
            "macro|user@user.com".to_string()
        ]
    );
    assert_eq!(
        links.get("solo"),
        Some(&vec!["macro|solo@user.com".to_string()])
    );
    assert!(!links.contains_key("unlinked"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_macro_ids_by_github_logins_empty_input(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let links = repo.get_macro_ids_by_github_logins(&[]).await.unwrap();

    assert!(links.is_empty());
}

// ---------------------------------------------------------------------------
// get_user_team_ids
// ---------------------------------------------------------------------------

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_get_user_team_ids(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let team_ids = repo.get_user_team_ids("macro|user@user.com").await.unwrap();
    assert_eq!(team_ids.len(), 1);
    assert_eq!(
        team_ids[0],
        "dddddddd-dddd-dddd-dddd-dddddddddddd"
            .parse::<Uuid>()
            .unwrap()
    );

    let team_ids2 = repo
        .get_user_team_ids("macro|user2@user.com")
        .await
        .unwrap();
    assert_eq!(team_ids2.len(), 1);
    assert_eq!(
        team_ids2[0],
        "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
            .parse::<Uuid>()
            .unwrap()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_get_user_team_ids_no_teams(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let team_ids = repo.get_user_team_ids("macro|solo@user.com").await.unwrap();

    assert!(team_ids.is_empty());
}

// ---------------------------------------------------------------------------
// get_team_member_ids
// ---------------------------------------------------------------------------

async fn insert_user_account(
    pool: &Pool<Postgres>,
    user_id: &str,
    macro_user_id: Uuid,
    username: &str,
    email: &str,
    stripe_customer_id: &str,
) {
    sqlx::query(
        r#"
        INSERT INTO public.macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(macro_user_id)
    .bind(username)
    .bind(email)
    .bind(stripe_customer_id)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO public."User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(user_id)
    .bind(email)
    .bind(macro_user_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_team_member(pool: &Pool<Postgres>, team_id: Uuid, user_id: &str) {
    sqlx::query(
        r#"
        INSERT INTO public.team_user (user_id, team_id, team_role)
        VALUES ($1, $2, 'member')
        "#,
    )
    .bind(user_id)
    .bind(team_id)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_get_team_member_ids(pool: Pool<Postgres>) {
    let team_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
        .parse::<Uuid>()
        .unwrap();

    insert_user_account(
        &pool,
        "macro|zeta@user.com",
        "11111111-1111-1111-1111-111111111111".parse().unwrap(),
        "zeta",
        "zeta@test.com",
        "cus_zeta",
    )
    .await;
    insert_user_account(
        &pool,
        "macro|alpha@user.com",
        "22222222-2222-2222-2222-222222222222".parse().unwrap(),
        "alpha",
        "alpha@test.com",
        "cus_alpha",
    )
    .await;
    insert_user_account(
        &pool,
        "github-user-without-macro-prefix",
        "33333333-3333-3333-3333-333333333333".parse().unwrap(),
        "invalid",
        "invalid@test.com",
        "cus_invalid",
    )
    .await;
    insert_team_member(&pool, team_id, "macro|zeta@user.com").await;
    insert_team_member(&pool, team_id, "macro|alpha@user.com").await;
    insert_team_member(&pool, team_id, "github-user-without-macro-prefix").await;

    let empty_team_id = "44444444-4444-4444-4444-444444444444"
        .parse::<Uuid>()
        .unwrap();
    sqlx::query(
        r#"
        INSERT INTO public.team (id, name, owner_id)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(empty_team_id)
    .bind("Empty Team")
    .bind("macro|solo@user.com")
    .execute(&pool)
    .await
    .unwrap();

    let repo = PgGithubSyncRepo::new(pool);

    let member_ids = repo.get_team_member_ids(team_id).await.unwrap();
    let member_ids: Vec<String> = member_ids.into_iter().map(String::from).collect();
    assert_eq!(
        member_ids,
        vec![
            "macro|alpha@user.com".to_string(),
            "macro|user@user.com".to_string(),
            "macro|zeta@user.com".to_string(),
        ]
    );

    let empty_member_ids = repo.get_team_member_ids(empty_team_id).await.unwrap();
    assert!(empty_member_ids.is_empty());
}

// ---------------------------------------------------------------------------
// upsert_installation_sources
// ---------------------------------------------------------------------------

async fn get_installation_sources(
    pool: &Pool<Postgres>,
    installation_id: &str,
) -> Vec<(String, String, String)> {
    sqlx::query_as(
        r#"
        SELECT id, source_id, source_type::text
        FROM github_app_installation
        WHERE id = $1
        ORDER BY source_type, source_id
        "#,
    )
    .bind(installation_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_upsert_installation_sources_inserts_team_sources(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool.clone());

    let sources = vec![
        GithubAppInstallationSource::Team("dddddddd-dddd-dddd-dddd-dddddddddddd".parse().unwrap()),
        GithubAppInstallationSource::Team("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee".parse().unwrap()),
    ];

    repo.upsert_installation_sources("123456", &sources)
        .await
        .unwrap();

    let rows = get_installation_sources(&pool, "123456").await;

    assert_eq!(
        rows,
        vec![
            (
                "123456".to_string(),
                "dddddddd-dddd-dddd-dddd-dddddddddddd".to_string(),
                "team".to_string(),
            ),
            (
                "123456".to_string(),
                "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee".to_string(),
                "team".to_string(),
            ),
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_upsert_installation_sources_idempotent_team_source(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool.clone());

    let sources = vec![GithubAppInstallationSource::Team(
        "dddddddd-dddd-dddd-dddd-dddddddddddd".parse().unwrap(),
    )];

    repo.upsert_installation_sources("123456", &sources)
        .await
        .unwrap();
    repo.upsert_installation_sources("123456", &sources)
        .await
        .unwrap();

    let rows = get_installation_sources(&pool, "123456").await;

    assert_eq!(
        rows,
        vec![(
            "123456".to_string(),
            "dddddddd-dddd-dddd-dddd-dddddddddddd".to_string(),
            "team".to_string(),
        )]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn test_upsert_installation_sources_idempotent_user_source(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool.clone());

    let sources = vec![GithubAppInstallationSource::User(
        "macro|solo@user.com".to_string(),
    )];

    repo.upsert_installation_sources("654321", &sources)
        .await
        .unwrap();
    repo.upsert_installation_sources("654321", &sources)
        .await
        .unwrap();

    let rows = get_installation_sources(&pool, "654321").await;

    assert_eq!(
        rows,
        vec![(
            "654321".to_string(),
            "macro|solo@user.com".to_string(),
            "user".to_string(),
        )]
    );
}

// ---------------------------------------------------------------------------
// installation installer
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_upsert_installation_installer_records_installer(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    repo.upsert_installation_installer("11111", "12345")
        .await
        .unwrap();
    repo.upsert_installation_installer("22222", "12345")
        .await
        .unwrap();

    let installation_ids = repo
        .get_installation_ids_by_installer("12345")
        .await
        .unwrap();

    assert_eq!(installation_ids, vec!["11111", "22222"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_upsert_installation_installer_replaces_installer(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    repo.upsert_installation_installer("11111", "12345")
        .await
        .unwrap();
    repo.upsert_installation_installer("11111", "67890")
        .await
        .unwrap();

    assert!(
        repo.get_installation_ids_by_installer("12345")
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        repo.get_installation_ids_by_installer("67890")
            .await
            .unwrap(),
        vec!["11111"]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_get_installation_ids_by_installer_empty(pool: Pool<Postgres>) {
    let repo = PgGithubSyncRepo::new(pool);

    let installation_ids = repo
        .get_installation_ids_by_installer("missing")
        .await
        .unwrap();

    assert!(installation_ids.is_empty());
}
