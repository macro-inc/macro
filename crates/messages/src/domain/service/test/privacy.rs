use super::*;

struct AgentSettings {
    ephemeral: bool,
}
impl EphemeralAgentReader for AgentSettings {
    fn ephemeral_agents<'a>(
        &'a self,
        bots: &'a [bot_id::BotId],
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<Vec<String>, MessageError>> + Send + 'a>>
    {
        Box::pin(async move {
            if !self.ephemeral {
                return Ok(vec![]);
            }
            Ok(bots
                .iter()
                .map(|bot| bot.into_storage_id().to_string())
                .collect())
        })
    }
}

#[tokio::test]
async fn ordinary_mentions_keep_the_existing_shared_audience() {
    let repo = fixture();
    let service = MessageService::new(repo.clone(), Events::default())
        .with_ephemeral_agents(AgentSettings { ephemeral: false });
    for thread_id in [None, Some(repo.message.id)] {
        for mentions in [
            vec![],
            vec![SimpleMention {
                entity_type: "user".into(),
                entity_id: "macro|coworker@example.com".into(),
            }],
            vec![SimpleMention {
                entity_type: "bot".into(),
                entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
            }],
        ] {
            let mut input = post_input();
            input.thread_id = thread_id;
            input.mentions = mentions;
            let message = service
                .post(
                    access("macro|author@example.com", "doc", AccessLevel::Comment),
                    input,
                )
                .await
                .unwrap();
            assert!(message.visibility.is_public());
            assert_eq!(message.thread_id, thread_id);
        }
    }
}

#[test]
fn clients_cannot_request_manual_message_privacy() {
    let mut body = serde_json::to_value(post_input()).unwrap();
    body["ephemeral"] = serde_json::json!(true);
    assert!(serde_json::from_value::<PostMessage>(body).is_err());
}

#[tokio::test]
async fn ephemeral_mention_selects_a_private_audience_before_delivery() {
    let repo = fixture();
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone())
        .with_ephemeral_agents(AgentSettings { ephemeral: true });
    let mut input = post_input();
    input.mentions = vec![SimpleMention {
        entity_type: "bot".into(),
        entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
    }];
    let message = service
        .post(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            input,
        )
        .await
        .unwrap();
    assert!(!message.visibility.is_public());
    assert!(message.visibility.permits("macro|author@example.com"));
    assert!(
        message
            .visibility
            .permits(bot_id::MACRO_AI_BOT_ID.into_storage_id().as_ref())
    );
    assert!(!message.visibility.permits("macro|coworker@example.com"));
    assert_eq!(
        events.0.lock().unwrap()[0].visibility(),
        &message.visibility
    );
    assert_eq!(
        repo.creates.lock().unwrap()[0].visibility,
        message.visibility
    );
}

#[tokio::test]
async fn parent_owner_cannot_read_write_react_to_or_delete_another_users_private_thread() {
    let mut repo = fixture();
    repo.message.visibility = MessageVisibility::Private {
        user_id: "macro|author@example.com".into(),
        bot_ids: vec![],
    };
    repo.state.visibility = repo.message.visibility.clone();
    repo.state.anchor = None;
    let root = repo.message.id;
    let service = MessageService::new(repo.clone(), Events::default());
    let other = access("macro|coworker@example.com", "doc", AccessLevel::Owner);
    assert!(matches!(
        service
            .get(other.clone().try_into_requirement().unwrap(), root)
            .await,
        Err(MessageError::NotFound)
    ));
    assert!(matches!(
        service
            .get_thread(other.clone().try_into_requirement().unwrap(), root)
            .await,
        Err(MessageError::NotFound)
    ));
    assert!(matches!(
        service.delete(other.clone(), root, None).await,
        Err(MessageError::NotFound)
    ));
    assert!(matches!(
        service
            .react(other.clone(), root, "👍".into(), true, None)
            .await,
        Err(MessageError::NotFound)
    ));
    let mut reply = post_input();
    reply.thread_id = Some(root);
    assert!(matches!(
        service.post(other.clone(), reply).await,
        Err(MessageError::NotFound)
    ));
    assert!(
        service
            .timeline(
                other.try_into_requirement().unwrap(),
                MessageTimelineQuery::default()
            )
            .await
            .unwrap()
            .items
            .is_empty()
    );
    assert!(repo.creates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn replies_inherit_privacy_and_ephemeral_mentions_fork_public_threads() {
    let mut repo = fixture();
    repo.state.anchor = None;
    repo.state.visibility = MessageVisibility::Private {
        user_id: "macro|author@example.com".into(),
        bot_ids: vec![],
    };
    let service = MessageService::new(repo.clone(), Events::default());
    let mut reply = post_input();
    reply.thread_id = Some(repo.message.id);
    let result = service
        .post(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            reply.clone(),
        )
        .await
        .unwrap();
    assert_eq!(result.visibility, repo.state.visibility);
    assert_eq!(result.thread_id, Some(repo.message.id));

    repo.state.visibility = MessageVisibility::Public;
    let service = MessageService::new(repo.clone(), Events::default())
        .with_ephemeral_agents(AgentSettings { ephemeral: true });
    reply.mentions = vec![SimpleMention {
        entity_type: "bot".into(),
        entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
    }];
    let result = service
        .post(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            reply,
        )
        .await
        .unwrap();
    assert!(!result.visibility.is_public());
    assert!(result.thread_id.is_none());
}

#[tokio::test]
async fn an_edit_cannot_introduce_an_ephemeral_agent_into_a_public_thread() {
    let repo = fixture();
    let service = MessageService::new(repo.clone(), Events::default())
        .with_ephemeral_agents(AgentSettings { ephemeral: true });
    let result = service
        .patch(
            access("macro|author@example.com", "doc", AccessLevel::Comment),
            repo.message.id,
            MessagePatch {
                mentions: Some(vec![SimpleMention {
                    entity_type: "bot".into(),
                    entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
                }]),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(
        result,
        Err(MessageError::Invalid(
            "mention this agent in a new private thread"
        ))
    ));
}

#[tokio::test]
async fn ephemeral_agent_call_chat_is_rejected_before_creating_the_canonical_thread() {
    let repo = fixture();
    let service = MessageService::new(repo.clone(), Events::default())
        .with_ephemeral_agents(AgentSettings { ephemeral: true });
    let call_id = Uuid::from_u128(10);
    for thread_id in [None, Some(call_id)] {
        let mut input = post_input();
        input.thread_id = thread_id;
        input.mentions = vec![SimpleMention {
            entity_type: "bot".into(),
            entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
        }];
        let result = service
            .post(
                call_receipt("macro|author@example.com", call_id, AccessLevel::Comment).unwrap(),
                input,
            )
            .await;
        assert!(matches!(result, Err(MessageError::Invalid(_))));
    }
    assert!(repo.creates.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invited_agents_reply_privately_only_for_the_initiating_user() {
    let mut repo = fixture();
    repo.message.visibility = MessageVisibility::Private {
        user_id: "macro|author@example.com".into(),
        bot_ids: vec![bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string()],
    };
    repo.state.visibility = repo.message.visibility.clone();
    repo.state.anchor = None;
    let service = MessageService::new(repo.clone(), Events::default());
    let mut reply = post_input();
    reply.thread_id = Some(repo.message.id);
    reply.content = "A private agent answer".into();
    let answer = service.post(bot_receipt(), reply.clone()).await.unwrap();
    assert_eq!(answer.visibility, repo.message.visibility);
    assert_eq!(answer.thread_id, Some(repo.message.id));
    assert_eq!(
        answer.sender_id.as_bot().unwrap().bot_id(),
        bot_id::MACRO_AI_BOT_ID
    );
    for (bot, acting_user) in [
        (bot_id::MACRO_AI_BOT_ID, "macro|coworker@example.com"),
        (bot_id::MACRO_NEW_BOT_ID, "macro|author@example.com"),
    ] {
        let receipt = EntityAccessReceipt::try_new_bot(
            bot.into_storage_id(),
            entity_access::domain::models::BotReceiptScope::User {
                acting_user: acting_user.to_owned().try_into().unwrap(),
            },
            access(acting_user, "doc", AccessLevel::Comment)
                .entity()
                .clone(),
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Comment,
            },
        )
        .unwrap();
        assert!(matches!(
            service.post(receipt, reply.clone()).await,
            Err(MessageError::NotFound)
        ));
    }
    assert_eq!(repo.creates.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn private_event_replays_require_the_original_acting_user() {
    let mut repo = fixture();
    repo.message.id = Uuid::now_v7();
    repo.message.sender_id = actor_from_receipt(&bot_receipt(), &repo.message.parent).unwrap();
    repo.message.visibility = MessageVisibility::Private {
        user_id: "macro|author@example.com".into(),
        bot_ids: vec![bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string()],
    };
    let id = repo.message.id;
    let events = Events::default();
    let service = MessageService::new(repo.clone(), events.clone());
    let mut input = post_input();
    input.thread_id = repo.message.thread_id;
    let replay = service
        .post_from_event(bot_receipt(), id, input.clone())
        .await
        .unwrap();
    assert_eq!(replay.content, repo.message.content);
    let other = EntityAccessReceipt::try_new_bot(
        bot_id::MACRO_AI_BOT_ID.into_storage_id(),
        entity_access::domain::models::BotReceiptScope::User {
            acting_user: "macro|coworker@example.com".to_owned().try_into().unwrap(),
        },
        access("macro|coworker@example.com", "doc", AccessLevel::Comment)
            .entity()
            .clone(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Comment,
        },
    )
    .unwrap();
    assert!(matches!(
        service.post_from_event(other, id, input).await,
        Err(MessageError::NotFound)
    ));
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[test]
fn private_audiences_reject_channel_and_team_scoped_bots() {
    use entity_access::domain::models::BotReceiptScope;
    let visibility = MessageVisibility::Private {
        user_id: "macro|author@example.com".into(),
        bot_ids: vec![bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string()],
    };
    for scope in [
        BotReceiptScope::Channel {
            channel_id: Uuid::now_v7(),
        },
        BotReceiptScope::Team {
            team_id: Uuid::now_v7(),
        },
    ] {
        let receipt = EntityAccessReceipt::<MessageWrite>::try_new_bot(
            bot_id::MACRO_AI_BOT_ID.into_storage_id(),
            scope,
            access("macro|author@example.com", "doc", AccessLevel::Comment)
                .entity()
                .clone(),
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Comment,
            },
        )
        .unwrap();
        assert!(!super::super::privacy::can_view(
            receipt.auth(),
            &visibility
        ));
        assert!(super::super::privacy::principal(receipt.auth()).is_none());
    }
}
