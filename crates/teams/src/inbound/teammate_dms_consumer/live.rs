use std::time::Duration;

use channels::{domain::service::ChannelServiceImpl, outbound::pg_channels_repo::PgChannelsRepo};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::{EventPublisher, KafkaEventPublisher, MacroEvent as _};
use macro_event_topics::MacroTeamsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::Row;
use uuid::Uuid;

use super::run_teammate_dms_consumer;
use crate::{
    domain::{
        events::{TeamJoinMethod, TeamMacroEvent, TeamMemberJoinedMetadata},
        model::TeamRole,
        teammate_dms::TeammateDmServiceImpl,
    },
    outbound::team_repo::TeamRepositoryImpl,
};

const TEAM_ID: &str = "11111111-1111-1111-1111-111111111111";

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

async fn dm_count(pool: &sqlx::PgPool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM comms_channels WHERE channel_type = 'direct_message'")
        .fetch_one(pool)
        .await
        .expect("count DMs")
}

async fn dm_participants(pool: &sqlx::PgPool) -> Vec<(Uuid, Vec<String>)> {
    let rows = sqlx::query(
        r#"
        SELECT
            c.id,
            array_agg(p.user_id ORDER BY p.user_id) AS participants
        FROM comms_channels c
        JOIN comms_channel_participants p ON p.channel_id = c.id
        WHERE c.channel_type = 'direct_message'
          AND p.left_at IS NULL
        GROUP BY c.id
        ORDER BY c.created_at
        "#,
    )
    .fetch_all(pool)
    .await
    .expect("query DM participants");

    rows.into_iter()
        .map(|row| (row.get("id"), row.get("participants")))
        .collect()
}

#[ignore = "needs local Kafka on KAFKA_BROKERS"]
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("teams"))
)]
async fn member_joined_event_creates_dm_through_kafka(pool: sqlx::PgPool) {
    let brokers = std::env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".to_string());
    let team_id = Uuid::parse_str(TEAM_ID).unwrap();
    let joiner = user("user2@user.com");
    let owner = user("user@user.com");
    let service = TeammateDmServiceImpl::new(
        TeamRepositoryImpl::new(pool.clone()),
        ChannelServiceImpl::new(PgChannelsRepo::new(pool.clone())),
    );

    assert_eq!(dm_count(&pool).await, 0);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let consumer = tokio::spawn(async move {
        run_teammate_dms_consumer(&brokers, service, async move {
            let _ = shutdown_rx.await;
        })
        .await
    });

    tokio::time::sleep(Duration::from_secs(2)).await;

    let event = TeamMacroEvent::member_joined(TeamMemberJoinedMetadata {
        team_id,
        member_id: joiner.clone(),
        role: TeamRole::Member,
        join_method: TeamJoinMethod::DomainAutoJoin,
    });
    let publisher = KafkaEventPublisher::new(
        &std::env::var("KAFKA_BROKERS").unwrap_or_else(|_| "localhost:9092".to_string()),
    )
    .expect("kafka publisher");
    publisher
        .publish::<MacroTeamsTopic>(event.key(), &serde_json::to_vec(event.event()).unwrap())
        .await
        .expect("publish team.member_joined");

    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    let mut pairs = Vec::new();
    while tokio::time::Instant::now() < deadline {
        pairs = dm_participants(&pool).await;
        if !pairs.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    let _ = shutdown_tx.send(());
    consumer
        .await
        .expect("consumer task")
        .expect("consumer run");

    println!(
        "after team.member_joined: dms={pairs:?} joiner={} owner={}",
        joiner.as_ref(),
        owner.as_ref()
    );
    assert_eq!(
        pairs.len(),
        1,
        "expected one DM after member_joined, got {pairs:?}"
    );
    assert_eq!(
        pairs[0].1,
        vec![joiner.as_ref().to_string(), owner.as_ref().to_string()]
    );
}
