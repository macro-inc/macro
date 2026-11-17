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
