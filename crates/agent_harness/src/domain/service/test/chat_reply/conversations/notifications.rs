use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_running_quiet_batch_leaves_the_next_conversation_message_queued(pool: sqlx::PgPool) {
    use crate::domain::conversation_turns::{ConversationTurnState, ConversationTurnStore};
    use agent_runtime_protocol::domain::notification::NotificationEvent;
    use agent_session::domain::agent_conversation::AgentConversationRepo;
    use agent_session::domain::notifications::{
        NotificationStore, PendingNotification, ProduceNotification,
    };
    use channels::domain::agent_dm::AgentDmRepo;
    let journal =
        Arc::new(crate::outbound::conversation_turns::PgConversationTurnStore::new(pool.clone()));
    let outbox = Arc::new(agent_session::outbound::notifications::PgNotificationStore(
        pool.clone(),
    ));
    let ((service, _, containers, _, _), mut signals) = harness_with_journal_and_policy(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        KindDefaultPolicies,
        HarnessDefaultCodingAgents,
        PromptMentionsMock::new(),
        EgressProvisionerMock::new(),
        Some(journal.clone()),
        None,
        Some(outbox.clone()),
    );
    let mut command = direct_command();
    let channel = channels::outbound::pg_channels_repo::PgChannelsRepo::new(pool.clone())
        .ensure(mention_origin(&command).sender.clone(), command.bot_id)
        .await
        .unwrap()
        .dm
        .channel_id;
    let session = crate::testing::postgres_sessions(pool.clone())
        .current_or_create(conversation(channel, &command))
        .await
        .unwrap();
    mention_origin_mut(&mut command).parent = MessageParent::Channel(channel);
    sqlx::query!("INSERT INTO agent_session (id, owner_id, bot_id, model, harness, workspace) VALUES ($1,'macro|asker@example.com',$2,'test','macrod','/workspace')", session.as_uuid(), command.bot_id.as_uuid()).execute(&pool).await.unwrap();
    outbox
        .enqueue(
            PendingNotification::new(ProduceNotification {
                session_id: session,
                subject_id: "quiet".into(),
                event: NotificationEvent::AppConnected {
                    app: "Calendar".into(),
                },
                dedupe_key: None,
                wake: false,
            })
            .unwrap(),
        )
        .await
        .unwrap();
    let container = open_direct(&service, &containers, session, command.clone()).await;
    service.inner.notification_batches.remove(&session);
    service.inner.busy.clear(session);
    sqlx::query!("UPDATE agent_session_notification SET lease_until = now() - interval '1 second' WHERE session_id = $1", session.as_uuid()).execute(&pool).await.unwrap();
    let next_source = macro_uuid::generate_uuid_v7();
    mention_origin_mut(&mut command).message_id = next_source;
    service
        .execute(
            session,
            HarnessCommand::ConversationMessage(command.clone()),
        )
        .await
        .unwrap();
    let waiting = journal
        .get(next_source, command.bot_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(waiting.state, ConversationTurnState::Queued);
    assert_eq!(prompts(&container.agent()).len(), 1);
    container.agent().completes_prompt().await;
    signals.settled(session).await;
    container.agent().wait_for_requests(4).await;
    assert_eq!(prompts(&container.agent()).len(), 2);
    assert_eq!(
        journal
            .get(next_source, command.bot_id)
            .await
            .unwrap()
            .unwrap()
            .state,
        ConversationTurnState::Running
    );
}
