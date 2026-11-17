use super::*;
use crate::outbound::pg_access_repo::queries::{
    source_list_oracle,
    test_viewers::{assert_matrix_agrees, matrix_viewers, user_in_channel, user_in_team},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::{BTreeSet, HashSet};

const VIEWER: &str = "macro|viewer@corp.test";
const OTHER: &str = "macro|other@corp.test";

fn user(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).unwrap()
}

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
}

/// The viewer is in one channel and one team; threads in another inbox are
/// shared with the viewer, that channel and that team.
async fn fixture(pool: &PgPool) -> Fixture {
    let own_link = insert_link(pool, VIEWER, "viewer@corp.test").await;
    let other_link = insert_link(pool, OTHER, "other@corp.test").await;
    let channel = Uuid::now_v7();
    user_in_channel(pool, VIEWER, channel).await.unwrap();
    let team = Uuid::now_v7();
    user_in_team(pool, VIEWER, team).await.unwrap();

    let direct = insert_thread(pool, other_link).await;
    grant(pool, direct, "email_thread", VIEWER, "view").await;
    let via_channel = insert_thread(pool, other_link).await;
    grant(
        pool,
        via_channel,
        "email_thread",
        &channel.to_string(),
        "comment",
    )
    .await;
    let via_team = insert_thread(pool, other_link).await;
    grant(pool, via_team, "email_thread", &team.to_string(), "view").await;

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
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn threads_granted_to_any_source_outside_own_inboxes(pool: PgPool) -> anyhow::Result<()> {
    let fixture = fixture(&pool).await;

    let shared = shared_email_threads(&pool, &user(VIEWER), &[fixture.own_link], &[], 100).await?;

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
        &user(VIEWER),
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

    let shared = shared_email_threads(&pool, &user(VIEWER), &[fixture.own_link], &[], 2).await?;

    assert_eq!(shared.len(), 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_caller_without_grants_shares_nothing(pool: PgPool) -> anyhow::Result<()> {
    fixture(&pool).await;

    let shared =
        shared_email_threads(&pool, &user("macro|stranger@corp.test"), &[], &[], 100).await?;

    assert!(shared.is_empty());
    Ok(())
}

/// Every user of the viewer matrix gets the threads the source-list form
/// returned for their `get_user_source_ids`, with and without their own
/// inboxes and requested threads left out.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "viewer_matrix_thread")
    )
)]
async fn shared_email_threads_match_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let viewers = matrix_viewers(&pool).await?;
    // Email search runs for signed-in users only.
    let users: Vec<_> = viewers
        .iter()
        .filter(|viewer| viewer.user_id().is_some())
        .cloned()
        .collect();
    // The inbox holding every granted thread.
    let granted_inbox = sqlx::query_scalar!(
        r#"SELECT id FROM email_links WHERE macro_id = 'macro|matrix-other@example.com'"#
    )
    .fetch_all(&pool)
    .await?;
    let threads = sqlx::query_scalar!(r#"SELECT id FROM email_threads ORDER BY id"#)
        .fetch_all(&pool)
        .await?;
    let cases: [(&str, &[Uuid], &[Uuid]); 3] = [
        ("every share", &[], &[]),
        ("outside the granted inbox", &granted_inbox, &[]),
        (
            "among the first half of the threads",
            &[],
            &threads[..threads.len() / 2],
        ),
    ];
    let labels: Vec<_> = cases.iter().map(|(label, _, _)| *label).collect();

    assert_matrix_agrees(&users, &labels, async |viewer, label| {
        let (_, own_links, requested) = cases
            .iter()
            .find(|(case, _, _)| case == label)
            .ok_or_else(|| anyhow::anyhow!("no case {label}"))?;
        let user_id = viewer
            .user_id()
            .ok_or_else(|| anyhow::anyhow!("{} is not a user", viewer.label))?;
        let old = source_list_oracle::shared_email_threads(
            &pool,
            &viewer.sources,
            own_links,
            requested,
            1000,
        )
        .await?;
        let new = shared_email_threads(&pool, &user_id, own_links, requested, 1000).await?;
        Ok((
            old.into_iter()
                .map(|thread| (thread.thread_id, thread.link_id))
                .collect::<BTreeSet<_>>(),
            new.into_iter()
                .map(|thread| (thread.thread_id, thread.link_id))
                .collect::<BTreeSet<_>>(),
        ))
    })
    .await
}
