//! Every change of the bots in a channel is announced to its members as a
//! `channel.updated` with the channel's name unchanged: each member's copy of
//! the channel lists its bots.

use super::*;
use crate::domain::ports::HarnessAgentDeletion;

/// The channel updates published so far, as (key, metadata), sorted by key.
fn channel_updates(broker: &RecordingEventBroker) -> Vec<(String, Value)> {
    let mut updates: Vec<(String, Value)> = broker
        .events()
        .into_iter()
        .filter(|event| event.topic == "macro.channels")
        .map(|event| {
            assert_eq!(event.payload["schema_version"], 1);
            assert_eq!(event.payload["event_type"], "channel.updated");
            (event.key, event.payload["metadata"].clone())
        })
        .collect();
    updates.sort_by(|a, b| a.0.cmp(&b.0));
    updates
}

/// The update of `channel_ids` by `actor`, each named "alarms" before and after.
fn unchanged(actor: &str, channel_ids: &[Uuid]) -> Vec<(String, Value)> {
    let mut updates: Vec<(String, Value)> = channel_ids
        .iter()
        .map(|channel_id| {
            (
                channel_id.to_string(),
                json!({
                    "channel_id": channel_id,
                    "actor": actor,
                    "previous_name": "alarms",
                    "channel_name": "alarms",
                }),
            )
        })
        .collect();
    updates.sort_by(|a, b| a.0.cmp(&b.0));
    updates
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn adding_or_removing_a_bot_updates_its_channel(pool: PgPool) -> anyhow::Result<()> {
    let broker = RecordingEventBroker::default();
    let service = recording_service(&pool, broker.clone());
    let channel_id = Uuid::new_v4();
    insert_channel_member(&pool, channel_id, USER_OWNER).await?;
    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("announced"))
        .await?;
    broker.clear();

    service
        .add_bot_to_channel(channel_member_receipt(USER_OWNER, channel_id), bot.id)
        .await?;
    assert_eq!(
        channel_updates(&broker),
        unchanged(USER_OWNER, &[channel_id])
    );

    broker.clear();
    service
        .remove_bot_from_channel(user_id(USER_OWNER), channel_id, bot.id)
        .await?;
    assert_eq!(
        channel_updates(&broker),
        unchanged(USER_OWNER, &[channel_id])
    );

    // Nothing changed, so nothing is announced.
    broker.clear();
    let again = service
        .remove_bot_from_channel(user_id(USER_OWNER), channel_id, bot.id)
        .await;
    assert!(matches!(again, Err(BotError::NotFound(_))));
    assert!(broker.events().is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_channel_without_a_name_is_announced_without_one(pool: PgPool) -> anyhow::Result<()> {
    let broker = RecordingEventBroker::default();
    let service = recording_service(&pool, broker.clone());
    let channel_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'direct_message', $2)",
    )
    .bind(channel_id)
    .bind(USER_OWNER)
    .execute(&pool)
    .await?;
    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("nameless"))
        .await?;
    broker.clear();

    service
        .add_bot_to_channel(channel_member_receipt(USER_OWNER, channel_id), bot.id)
        .await?;
    assert_eq!(
        channel_updates(&broker),
        vec![(
            channel_id.to_string(),
            json!({
                "channel_id": channel_id,
                "actor": USER_OWNER,
                "previous_name": null,
                "channel_name": null,
            }),
        )]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_channel_scoped_bot_updates_its_channel(pool: PgPool) -> anyhow::Result<()> {
    let broker = RecordingEventBroker::default();
    let service = recording_service(&pool, broker.clone());
    let channel_id = Uuid::new_v4();
    insert_channel(&pool, channel_id).await?;

    let created = service
        .create_channel_scoped_bot(
            user_id(USER_OWNER),
            channel_id,
            create_channel_scoped_req("scoped-announced"),
        )
        .await?;
    assert_eq!(
        channel_updates(&broker),
        unchanged(USER_OWNER, &[channel_id])
    );
    assert_no_token_material(&broker.events()[1].payload, Some(&created.bot_token));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_agent_updates_every_channel_its_selection_touches(pool: PgPool) -> anyhow::Result<()> {
    let broker = RecordingEventBroker::default();
    let service = recording_service(&pool, broker.clone());
    let [first, second, third] = [Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4()];
    for channel_id in [first, second, third] {
        insert_channel_member(&pool, channel_id, USER_OWNER).await?;
    }

    let mut create = create_agent_req("selected-announced", AgentChannelScope::Selected);
    create.channel_ids = vec![first, second];
    let agent = service.create_agent(user_id(USER_OWNER), create).await?;
    assert_eq!(
        channel_updates(&broker),
        unchanged(USER_OWNER, &[first, second])
    );

    // The channel left, the one kept (joined again) and the one joined.
    broker.clear();
    let mut update = update_agent_req("selected-announced", AgentChannelScope::Selected);
    update.channel_ids = vec![second, third];
    service
        .update_agent(user_id(USER_OWNER), agent.bot.id, update)
        .await?;
    assert_eq!(
        channel_updates(&broker),
        unchanged(USER_OWNER, &[first, second, third])
    );

    broker.clear();
    service
        .delete_bot(user_id(USER_OWNER), agent.bot.id)
        .await?;
    assert_eq!(
        channel_updates(&broker),
        unchanged(USER_OWNER, &[second, third])
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_global_agent_announces_no_channel(pool: PgPool) -> anyhow::Result<()> {
    let broker = RecordingEventBroker::default();
    let service = recording_service(&pool, broker.clone());
    let agent = service
        .create_agent(
            user_id(USER_OWNER),
            create_agent_req("global-agent", AgentChannelScope::All),
        )
        .await?;
    service
        .delete_bot(user_id(USER_OWNER), agent.bot.id)
        .await?;
    assert!(channel_updates(&broker).is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_harness_updates_its_agents_channels(pool: PgPool) -> anyhow::Result<()> {
    let broker = RecordingEventBroker::default();
    let service = recording_service(&pool, broker.clone());
    insert_user(&pool, USER_OWNER).await?;
    let harness = insert_harness(&pool, Some(USER_OWNER), None).await?;
    let [first, second] = [Uuid::new_v4(), Uuid::new_v4()];
    for channel_id in [first, second] {
        insert_channel_member(&pool, channel_id, USER_OWNER).await?;
    }
    for (handle, channel_ids) in [
        ("harness-one", vec![first]),
        ("harness-two", vec![first, second]),
    ] {
        let create = CreateAgentRequest {
            channel_scope: AgentChannelScope::Selected,
            channel_ids,
            ..macrod_agent_req(handle, Some(harness))
        };
        service.create_agent(user_id(USER_OWNER), create).await?;
    }
    broker.clear();

    let deleted = service
        .delete_harness_agents(user_id(USER_OWNER), harness)
        .await?;
    assert_eq!(deleted, 2);
    // Each channel once, however many of its agents went.
    assert_eq!(
        channel_updates(&broker),
        unchanged(USER_OWNER, &[first, second])
    );
    Ok(())
}
