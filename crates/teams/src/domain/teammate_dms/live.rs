use channels::{domain::service::ChannelServiceImpl, outbound::pg_channels_repo::PgChannelsRepo};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::Row;
use uuid::Uuid;

use super::*;
use crate::outbound::team_repo::TeamRepositoryImpl;

const TEAM_ID: &str = "11111111-1111-1111-1111-111111111111";

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

async fn dm_pairs(pool: &sqlx::PgPool) -> Vec<(Uuid, String, Vec<String>)> {
    let rows = sqlx::query(
        r#"
        SELECT
            c.id,
            c.owner_id,
            array_agg(p.user_id ORDER BY p.user_id) AS participants
        FROM comms_channels c
        JOIN comms_channel_participants p ON p.channel_id = c.id
        WHERE c.channel_type = 'direct_message'
          AND p.left_at IS NULL
        GROUP BY c.id, c.owner_id
        ORDER BY c.created_at
        "#,
    )
    .fetch_all(pool)
    .await
    .expect("query teammate DMs");

    rows.into_iter()
        .map(|row| (row.get("id"), row.get("owner_id"), row.get("participants")))
        .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn joined_member_creates_a_real_dm_in_postgres(pool: sqlx::PgPool) {
    let team_id = Uuid::parse_str(TEAM_ID).unwrap();
    let owner = user("user@user.com");
    let joiner = user("user2@user.com");
    let service = TeammateDmServiceImpl::new(
        TeamRepositoryImpl::new(pool.clone()),
        ChannelServiceImpl::new(PgChannelsRepo::new(pool.clone())),
    );

    let before = dm_pairs(&pool).await;
    println!("before DMs: {before:?}");
    assert!(
        before.is_empty(),
        "fixture team should start with no DMs, got {before:?}"
    );

    let summary = service
        .ensure_for_joined_member(&team_id, &joiner)
        .await
        .expect("ensure teammate DMs");
    let after = dm_pairs(&pool).await;
    println!(
        "after first ensure: created={} existing={} failed={} dms={after:?}",
        summary.created, summary.existing, summary.failed
    );

    assert_eq!(summary.created, 1);
    assert_eq!(summary.existing, 0);
    assert_eq!(summary.failed, 0);
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].1, joiner.as_ref());
    assert_eq!(
        after[0].2,
        vec![joiner.as_ref().to_string(), owner.as_ref().to_string()]
    );

    let again = service
        .ensure_for_joined_member(&team_id, &joiner)
        .await
        .expect("idempotent ensure");
    assert_eq!(again.created, 0);
    assert_eq!(again.existing, 1);
    assert_eq!(dm_pairs(&pool).await.len(), 1);
}
