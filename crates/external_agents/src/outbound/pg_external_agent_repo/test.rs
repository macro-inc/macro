use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const AGENT: BotId = BotId::new_from_uuid(Uuid::from_u128(0x91000000_0000_0000_0000_000000000021));
const OTHER: BotId = BotId::new_from_uuid(Uuid::from_u128(0x91000000_0000_0000_0000_000000000022));
const DM: Uuid = Uuid::from_u128(0xD1);

fn event(id: u128, bot_id: BotId) -> ExternalAgentEvent {
    ExternalAgentEvent {
        id: Uuid::from_u128(id),
        bot_id,
        kind: crate::domain::models::ExternalAgentEventKind::DirectMessage,
        parent: MessageParent::Channel(DM),
        message_id: Uuid::from_u128(0x100 + id),
        message_thread_id: None,
        reply_thread_id: None,
        sender_id: "macro|owner@example.com".to_owned(),
        invoking_user: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        content: "what changed today?".to_owned(),
        message_created_at: DateTime::UNIX_EPOCH,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("external_agents"))
)]
async fn registrations_round_trip_and_move_between_push_and_poll(pool: PgPool) {
    let repo = PgExternalAgentRepo::new(pool);

    repo.register(AGENT, None).await.unwrap();
    repo.register(AGENT, Some("wh_outside")).await.unwrap();
    assert_eq!(
        repo.get(&[AGENT, OTHER]).await.unwrap(),
        vec![ExternalAgentRow {
            bot_id: AGENT,
            webhook_id: None,
        }],
        "registering again keeps the first registration",
    );

    repo.set_webhook(AGENT, Some("wh_outside")).await.unwrap();
    assert_eq!(
        repo.get(&[AGENT]).await.unwrap()[0].webhook_id.as_deref(),
        Some("wh_outside"),
    );
    assert!(matches!(
        repo.set_webhook(OTHER, None).await,
        Err(ExternalAgentError::NotFound)
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("external_agents"))
)]
async fn a_trigger_is_recorded_once_and_the_inbox_pages_in_order(pool: PgPool) {
    let repo = PgExternalAgentRepo::new(pool);
    repo.register(AGENT, None).await.unwrap();
    repo.register(OTHER, None).await.unwrap();
    let trigger = Uuid::now_v7();

    let first = repo.record(event(1, AGENT), trigger).await.unwrap();
    let replayed = repo.record(event(9, AGENT), trigger).await.unwrap();
    repo.record(event(2, AGENT), Uuid::now_v7()).await.unwrap();
    repo.record(event(3, OTHER), Uuid::now_v7()).await.unwrap();

    assert_eq!(first, event(1, AGENT));
    assert_eq!(
        replayed, first,
        "a replayed trigger returns the stored event"
    );
    assert_eq!(
        repo.events(AGENT, None, 10)
            .await
            .unwrap()
            .iter()
            .map(|event| event.id)
            .collect::<Vec<_>>(),
        vec![Uuid::from_u128(1), Uuid::from_u128(2)],
    );
    assert_eq!(
        repo.events(AGENT, Some(Uuid::from_u128(1)), 10)
            .await
            .unwrap()
            .iter()
            .map(|event| event.id)
            .collect::<Vec<_>>(),
        vec![Uuid::from_u128(2)],
    );
    assert_eq!(
        repo.event(AGENT, Uuid::from_u128(1)).await.unwrap(),
        Some(event(1, AGENT)),
    );
    assert_eq!(
        repo.event(AGENT, Uuid::from_u128(3)).await.unwrap(),
        None,
        "another agent's event is not this agent's",
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("external_agents"))
)]
async fn removing_an_agent_removes_its_inbox(pool: PgPool) {
    let repo = PgExternalAgentRepo::new(pool);
    repo.register(AGENT, None).await.unwrap();
    repo.record(event(1, AGENT), Uuid::now_v7()).await.unwrap();

    repo.remove(AGENT).await.unwrap();

    assert!(repo.get(&[AGENT]).await.unwrap().is_empty());
    assert!(repo.events(AGENT, None, 10).await.unwrap().is_empty());
}
