//! DB tests for the project-scoped candidate branch of the dynamic email
//! query: a (non-negated) `ProjectId` filter widens results to every thread
//! in that project when the caller's entity_access sources grant access to
//! the project itself.
//!
//! Fixtures: user1 (link aaaa) is the caller. user2 (link bbbb) owns the
//! shared project `cccccccc` (user-source grant to user1), the team project
//! `dddd0000` (team-source grant via user1's team), and the private project
//! `eeee0000` (no grants).

use super::*;

const USER1: &str = "macro|user1@test.com";
const SHARED_PROJECT: &str = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const TEAM_PROJECT: &str = "dddd0000-0000-0000-0000-00000000dddd";
const PRIVATE_PROJECT: &str = "eeee0000-0000-0000-0000-00000000eeee";

const OWN_IN_SHARED: &str = "20000301-0000-0000-0000-000000000301";
const OWN_IN_PRIVATE: &str = "20000302-0000-0000-0000-000000000302";
const USER2_IN_SHARED: &str = "20000102-0000-0000-0000-000000000102";
const USER2_IN_TEAM: &str = "20000105-0000-0000-0000-000000000105";
const USER2_IN_PRIVATE: &str = "20000106-0000-0000-0000-000000000106";
const USER2_ARCHIVED_IN_SHARED: &str = "20000107-0000-0000-0000-000000000107";
const USER2_DIRECT_SHARE: &str = "20000101-0000-0000-0000-000000000101";

fn user1_link() -> Uuid {
    Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap()
}

fn project_filter(project_id: &str) -> Arc<Expr<EmailLiteral>> {
    Arc::new(Expr::Literal(EmailLiteral::ProjectId(
        project_id.to_string(),
    )))
}

async fn run_query(
    pool: &Pool<Postgres>,
    view: PreviewViewStandardLabel,
    filter: Arc<Expr<EmailLiteral>>,
    user_id: &str,
) -> anyhow::Result<Vec<String>> {
    let results = dynamic::dynamic_email_thread_cursor(
        pool,
        &[user1_link()],
        50,
        &PreviewView::StandardLabel(view),
        Query::new(None, SimpleSortMethod::UpdatedAt, filter),
        user_id,
        None,
    )
    .await?;
    Ok(results.iter().map(|r| r.id.to_string()).collect())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_project_scope")
    )
)]
async fn project_access_widens_to_other_users_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let ids = run_query(
        &pool,
        PreviewViewStandardLabel::All,
        project_filter(SHARED_PROJECT),
        USER1,
    )
    .await?;

    // Own thread + user2's threads in the project, newest first (All-view
    // sort key is latest_non_spam_message_ts).
    assert_eq!(
        ids,
        vec![
            USER2_ARCHIVED_IN_SHARED.to_string(),
            OWN_IN_SHARED.to_string(),
            USER2_IN_SHARED.to_string(),
        ],
        "project access should surface every thread in the project"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_project_scope")
    )
)]
async fn widened_rows_carry_owning_link_metadata(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let results = dynamic::dynamic_email_thread_cursor(
        &pool,
        &[user1_link()],
        50,
        &PreviewView::StandardLabel(PreviewViewStandardLabel::All),
        Query::new(
            None,
            SimpleSortMethod::UpdatedAt,
            project_filter(SHARED_PROJECT),
        ),
        USER1,
        None,
    )
    .await?;

    let user2_row = results
        .iter()
        .find(|r| r.id.to_string() == USER2_IN_SHARED)
        .expect("user2's project thread should be returned");
    assert_eq!(
        user2_row.owner_id, "macro|user2@test.com",
        "widened thread must report its real owner"
    );
    assert_eq!(
        user2_row.link_id.to_string(),
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "widened thread must report its owning link"
    );
    assert_eq!(
        user2_row.project_id.as_deref(),
        Some(SHARED_PROJECT),
        "widened thread must carry its project id"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_project_scope")
    )
)]
async fn team_sourced_project_grant_widens(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let ids = run_query(
        &pool,
        PreviewViewStandardLabel::All,
        project_filter(TEAM_PROJECT),
        USER1,
    )
    .await?;

    assert_eq!(
        ids,
        vec![USER2_IN_TEAM.to_string()],
        "a team-source grant on the project should widen like a user grant"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_project_scope")
    )
)]
async fn no_project_access_returns_only_own_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let ids = run_query(
        &pool,
        PreviewViewStandardLabel::All,
        project_filter(PRIVATE_PROJECT),
        USER1,
    )
    .await?;

    // user1 has a thread of their own filed into the private project; the
    // owned branch keeps returning it, but no widening happens.
    assert_eq!(
        ids,
        vec![OWN_IN_PRIVATE.to_string()],
        "without project access only the caller's own threads may match"
    );
    assert!(
        !ids.contains(&USER2_IN_PRIVATE.to_string()),
        "another user's thread in an inaccessible project must stay hidden"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_project_scope")
    )
)]
async fn view_filters_apply_to_widened_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let ids = run_query(
        &pool,
        PreviewViewStandardLabel::Inbox,
        project_filter(SHARED_PROJECT),
        USER1,
    )
    .await?;

    // Thread 107 is in the project and accessible, but archived/outbound-only
    // — the Inbox view filter must still exclude it.
    assert_eq!(
        ids,
        vec![OWN_IN_SHARED.to_string(), USER2_IN_SHARED.to_string()],
        "inbox view constraints must apply to project-widened threads too"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_project_scope")
    )
)]
async fn negated_project_filter_does_not_widen(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let filter = Arc::new(Expr::is_not(Expr::Literal(EmailLiteral::ProjectId(
        SHARED_PROJECT.to_string(),
    ))));
    let ids = run_query(&pool, PreviewViewStandardLabel::All, filter, USER1).await?;

    assert!(
        !ids.contains(&USER2_IN_SHARED.to_string())
            && !ids.contains(&USER2_ARCHIVED_IN_SHARED.to_string()),
        "a negated project filter must not pull in other users' threads"
    );
    assert!(
        ids.contains(&OWN_IN_PRIVATE.to_string()),
        "own threads outside the negated project should still match"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_project_scope")
    )
)]
async fn shared_include_and_project_scope_do_not_duplicate(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Thread 102 qualifies through BOTH the shared branch (denormalized
    // thread-level row) and the project branch — it must come back once.
    let filter = Arc::new(Expr::and(
        Expr::Literal(EmailLiteral::ProjectId(SHARED_PROJECT.to_string())),
        Expr::Literal(EmailLiteral::Shared(
            item_filters::SharedEmailFilter::Include,
        )),
    ));
    let ids = run_query(&pool, PreviewViewStandardLabel::All, filter, USER1).await?;

    assert_eq!(
        ids.iter().filter(|id| *id == USER2_IN_SHARED).count(),
        1,
        "shared + project branches must dedupe: {ids:?}"
    );
    assert!(
        !ids.contains(&USER2_DIRECT_SHARE.to_string()),
        "directly-shared thread outside the project must be excluded by the project filter"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_project_scope")
    )
)]
async fn unparseable_user_id_skips_widening(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // An empty/invalid user id yields no entity_access sources, so the
    // project branch matches nothing and only owned threads return.
    let ids = run_query(
        &pool,
        PreviewViewStandardLabel::All,
        project_filter(SHARED_PROJECT),
        "",
    )
    .await?;

    assert_eq!(
        ids,
        vec![OWN_IN_SHARED.to_string()],
        "no resolvable sources → owned threads only"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_project_scope")
    )
)]
async fn shared_only_with_project_scope_excludes_owned_threads(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Shared=Only means "not my own threads": the project widening must keep
    // teammates' threads but never return the caller's own.
    let filter = Arc::new(Expr::and(
        Expr::Literal(EmailLiteral::ProjectId(SHARED_PROJECT.to_string())),
        Expr::Literal(EmailLiteral::Shared(item_filters::SharedEmailFilter::Only)),
    ));
    let ids = run_query(&pool, PreviewViewStandardLabel::All, filter, USER1).await?;

    assert_eq!(
        ids,
        vec![
            USER2_ARCHIVED_IN_SHARED.to_string(),
            USER2_IN_SHARED.to_string(),
        ],
        "Shared=Only + project scope must return only other users' project threads"
    );
    assert!(
        !ids.contains(&OWN_IN_SHARED.to_string()),
        "the caller's own project thread must be excluded under Shared=Only"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query", "email_shared_threads", "email_project_scope")
    )
)]
async fn multi_project_filter_widens_every_accessible_project(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let filter = Arc::new(Expr::or(
        Expr::Literal(EmailLiteral::ProjectId(SHARED_PROJECT.to_string())),
        Expr::Literal(EmailLiteral::ProjectId(TEAM_PROJECT.to_string())),
    ));
    let ids = run_query(&pool, PreviewViewStandardLabel::All, filter, USER1).await?;

    assert_eq!(
        ids,
        vec![
            USER2_ARCHIVED_IN_SHARED.to_string(), // 2024-03-07
            USER2_IN_TEAM.to_string(),            // 2024-03-05
            OWN_IN_SHARED.to_string(),            // 2024-03-01
            USER2_IN_SHARED.to_string(),          // 2024-02-02
        ],
        "an OR of project ids must widen every project the caller can access"
    );

    Ok(())
}
