use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::collections::HashSet;

const VIEWER: &str = "macro|viewer@corp.test";
const OTHER: &str = "macro|other@corp.test";

async fn insert_link(pool: &PgPool, macro_id: &str, address: &str) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        id,
        macro_id,
        address,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_thread(pool: &PgPool, link_id: Uuid) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) VALUES ($1, $2)",
        id,
        link_id
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn grant(pool: &PgPool, entity_id: Uuid, entity_type: &str, source_id: &str, level: &str) {
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, $2, $3, 'user', $4::text::"AccessLevel")"#,
        entity_id,
        entity_type,
        source_id,
        level,
    )
    .execute(pool)
    .await
    .unwrap();
}

struct Fixture {
    own_link: Uuid,
    other_link: Uuid,
    direct: Uuid,
    via_channel: Uuid,
    via_team: Uuid,
    channel: String,
    team: String,
}

async fn fixture(pool: &PgPool) -> Fixture {
    let own_link = insert_link(pool, VIEWER, "viewer@corp.test").await;
    let other_link = insert_link(pool, OTHER, "other@corp.test").await;
    let channel = Uuid::now_v7().to_string();
    let team = Uuid::now_v7().to_string();

    let direct = insert_thread(pool, other_link).await;
    grant(pool, direct, "email_thread", VIEWER, "view").await;
    let via_channel = insert_thread(pool, other_link).await;
    grant(pool, via_channel, "email_thread", &channel, "comment").await;
    let via_team = insert_thread(pool, other_link).await;
    grant(pool, via_team, "email_thread", &team, "view").await;

    // The viewer's own thread carries an owner grant to them.
    let own = insert_thread(pool, own_link).await;
    grant(pool, own, "email_thread", VIEWER, "owner").await;
    // Shared with someone else, and a document shared with the viewer.
    let elsewhere = insert_thread(pool, other_link).await;
    grant(pool, elsewhere, "email_thread", OTHER, "owner").await;
    grant(pool, Uuid::now_v7(), "document", VIEWER, "view").await;

    Fixture {
        own_link,
        other_link,
        direct,
        via_channel,
        via_team,
        channel,
        team,
    }
}

fn sources(fixture: &Fixture) -> SourceIds {
    SourceIds(vec![
        VIEWER.to_string(),
        fixture.channel.clone(),
        fixture.team.clone(),
    ])
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn threads_granted_to_any_source_outside_own_inboxes(pool: PgPool) -> anyhow::Result<()> {
    let fixture = fixture(&pool).await;

    let shared =
        shared_email_threads(&pool, &sources(&fixture), &[fixture.own_link], &[], 100).await?;

    let got: HashSet<SharedEmailThread> = shared.into_iter().collect();
    let want: HashSet<SharedEmailThread> = [fixture.direct, fixture.via_channel, fixture.via_team]
        .into_iter()
        .map(|thread_id| SharedEmailThread {
            thread_id,
            link_id: fixture.other_link,
        })
        .collect();
    assert_eq!(got, want);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn requested_threads_narrow_the_shares(pool: PgPool) -> anyhow::Result<()> {
    let fixture = fixture(&pool).await;

    let shared = shared_email_threads(
        &pool,
        &sources(&fixture),
        &[fixture.own_link],
        &[fixture.via_channel, Uuid::now_v7()],
        100,
    )
    .await?;

    assert_eq!(
        shared,
        vec![SharedEmailThread {
            thread_id: fixture.via_channel,
            link_id: fixture.other_link,
        }]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_limit_bounds_the_shares(pool: PgPool) -> anyhow::Result<()> {
    let fixture = fixture(&pool).await;

    let shared =
        shared_email_threads(&pool, &sources(&fixture), &[fixture.own_link], &[], 2).await?;

    assert_eq!(shared.len(), 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn no_sources_share_nothing(pool: PgPool) -> anyhow::Result<()> {
    fixture(&pool).await;

    let shared = shared_email_threads(&pool, &SourceIds(vec![]), &[], &[], 100).await?;

    assert!(shared.is_empty());
    Ok(())
}

const THIRD: &str = "macro|third@corp.test";

async fn insert_user(pool: &PgPool, user_id: &str) {
    let macro_user_id = Uuid::now_v7();
    let email = user_id.trim_start_matches("macro|");
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $2)",
        macro_user_id,
        user_id,
        email,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_project(pool: &PgPool, owner_id: &str) -> String {
    let id = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Folder', $2)"#,
        id,
        owner_id,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_thread_in(pool: &PgPool, link_id: Uuid, project_id: &str) -> Uuid {
    let id = insert_thread(pool, link_id).await;
    sqlx::query!(
        "UPDATE email_threads SET project_id = $2 WHERE id = $1",
        id,
        project_id
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn revoke(pool: &PgPool, entity_id: &str, source_id: &str) {
    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id::text = $1 AND source_id = $2",
        entity_id,
        source_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

struct Folder {
    project: String,
    other_project: String,
    viewer_link: Uuid,
    third_link: Uuid,
    own_in_folder: Uuid,
    teammate_in_folder: Uuid,
    teammate_shared_elsewhere: Uuid,
    channel: String,
}

/// A folder owned by OTHER and shared with a channel the viewer is in.
/// It holds one of the viewer's threads and one of OTHER's. A second,
/// unshared folder holds a thread of OTHER's that a thread grant shares with
/// the viewer. THIRD has an inbox but no grant.
async fn folder(pool: &PgPool) -> Folder {
    insert_user(pool, OTHER).await;
    let viewer_link = insert_link(pool, VIEWER, "viewer@corp.test").await;
    let other_link = insert_link(pool, OTHER, "other@corp.test").await;
    let third_link = insert_link(pool, THIRD, "third@corp.test").await;
    let project = insert_project(pool, OTHER).await;
    let other_project = insert_project(pool, OTHER).await;
    let channel = Uuid::now_v7().to_string();
    grant(pool, project.parse().unwrap(), "project", &channel, "view").await;

    let own_in_folder = insert_thread_in(pool, viewer_link, &project).await;
    let teammate_in_folder = insert_thread_in(pool, other_link, &project).await;
    insert_thread(pool, other_link).await;
    let teammate_shared_elsewhere = insert_thread_in(pool, other_link, &other_project).await;
    grant(
        pool,
        teammate_shared_elsewhere,
        "email_thread",
        VIEWER,
        "view",
    )
    .await;

    Folder {
        project,
        other_project,
        viewer_link,
        third_link,
        own_in_folder,
        teammate_in_folder,
        teammate_shared_elsewhere,
        channel,
    }
}

fn ids(threads: Vec<SharedEmailThread>) -> HashSet<Uuid> {
    threads.into_iter().map(|thread| thread.thread_id).collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teammate_with_the_folder_grant_reaches_every_thread_in_it(
    pool: PgPool,
) -> anyhow::Result<()> {
    let f = folder(&pool).await;
    let sources = SourceIds(vec![VIEWER.to_string(), f.channel.clone()]);

    let threads = project_email_threads(
        &pool,
        &sources,
        &[f.viewer_link],
        &[f.project.clone()],
        &[],
        true,
        false,
        100,
    )
    .await?;
    assert_eq!(
        ids(threads),
        HashSet::from([f.own_in_folder, f.teammate_in_folder])
    );

    let shared = project_shared_email_threads(
        &pool,
        &sources,
        &[f.viewer_link],
        &[
            f.own_in_folder,
            f.teammate_in_folder,
            f.teammate_shared_elsewhere,
        ],
    )
    .await?;
    assert_eq!(ids(shared), HashSet::from([f.teammate_in_folder]));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_viewer_without_the_folder_grant_reaches_none_of_its_threads(
    pool: PgPool,
) -> anyhow::Result<()> {
    let f = folder(&pool).await;
    let sources = SourceIds(vec![THIRD.to_string()]);

    let threads = project_email_threads(
        &pool,
        &sources,
        &[f.third_link],
        &[f.project.clone()],
        &[],
        true,
        true,
        100,
    )
    .await?;
    assert!(threads.is_empty());
    let shared = project_shared_email_threads(
        &pool,
        &sources,
        &[f.third_link],
        &[f.own_in_folder, f.teammate_in_folder],
    )
    .await?;
    assert!(shared.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_revoked_folder_grant_reaches_nothing_beyond_the_viewers_own_threads(
    pool: PgPool,
) -> anyhow::Result<()> {
    let f = folder(&pool).await;
    let sources = SourceIds(vec![VIEWER.to_string(), f.channel.clone()]);
    revoke(&pool, &f.project, &f.channel).await;

    let threads = project_email_threads(
        &pool,
        &sources,
        &[f.viewer_link],
        &[f.project.clone()],
        &[],
        true,
        false,
        100,
    )
    .await?;
    assert_eq!(ids(threads), HashSet::from([f.own_in_folder]));
    let shared =
        project_shared_email_threads(&pool, &sources, &[f.viewer_link], &[f.teammate_in_folder])
            .await?;
    assert!(shared.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn shared_only_leaves_out_own_threads_and_thread_shares_add_granted_threads(
    pool: PgPool,
) -> anyhow::Result<()> {
    let f = folder(&pool).await;
    let sources = SourceIds(vec![VIEWER.to_string(), f.channel.clone()]);
    let both = [f.project.clone(), f.other_project.clone()];

    let only = project_email_threads(
        &pool,
        &sources,
        &[f.viewer_link],
        &both,
        &[],
        false,
        true,
        100,
    )
    .await?;
    assert_eq!(
        ids(only),
        HashSet::from([f.teammate_in_folder, f.teammate_shared_elsewhere])
    );
    let exclude = project_email_threads(
        &pool,
        &sources,
        &[f.viewer_link],
        &both,
        &[],
        true,
        false,
        100,
    )
    .await?;
    assert_eq!(
        ids(exclude),
        HashSet::from([f.own_in_folder, f.teammate_in_folder])
    );
    let capped =
        project_email_threads(&pool, &sources, &[f.viewer_link], &both, &[], true, true, 1).await?;
    assert_eq!(capped.len(), 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn requested_threads_are_kept_however_full_their_folder(pool: PgPool) -> anyhow::Result<()> {
    let f = folder(&pool).await;
    let sources = SourceIds(vec![VIEWER.to_string(), f.channel.clone()]);
    let project = [f.project.clone()];

    for requested in [f.own_in_folder, f.teammate_in_folder] {
        let threads = project_email_threads(
            &pool,
            &sources,
            &[f.viewer_link],
            &project,
            &[requested],
            true,
            false,
            1,
        )
        .await?;
        assert_eq!(ids(threads), HashSet::from([requested]));
    }
    let elsewhere = project_email_threads(
        &pool,
        &sources,
        &[f.viewer_link],
        &project,
        &[f.teammate_shared_elsewhere],
        true,
        true,
        100,
    )
    .await?;
    assert!(elsewhere.is_empty());
    Ok(())
}
