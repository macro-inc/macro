use super::*;
use crate::domain::topics::{TopicRepository, TopicService};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const TEAM_A: Uuid = Uuid::from_u128(0x11111111_1111_1111_1111_111111111111);
const ACTIVE: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c11);
const LEFT: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c12);
const MANUAL: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c13);
const USER: &str = "macro|left-user@test.com";

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn topic_reads_only_include_active_participant_channels(pool: PgPool) {
    let repo = PgTopicsRepo::new(pool);
    let service = TopicService::new(repo.clone());
    let topic = service.create(USER, "Engineering", None).await.unwrap();
    assert_eq!(repo.topic_team(topic).await.unwrap(), Some(TEAM_A));
    for channel in [ACTIVE, LEFT, MANUAL] {
        service.add_channel(USER, topic, channel).await.unwrap();
    }
    let topics = service.list(USER).await.unwrap();
    assert_eq!(topics.len(), 1);
    assert_eq!(topics[0].channel_count, 3);
    let ids: std::collections::HashSet<_> = topics[0].channel_ids.iter().copied().collect();
    assert_eq!(ids, [ACTIVE, MANUAL].into_iter().collect());
    service.delete(USER, topic).await.unwrap();
    assert!(service.list(USER).await.unwrap().is_empty());
}
