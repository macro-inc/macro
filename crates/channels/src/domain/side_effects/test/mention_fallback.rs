use super::*;

fn member(channel_id: Uuid, user_id: &MacroUserIdStr<'static>) -> ChannelParticipant {
    ChannelParticipant {
        channel_id,
        user_id: user_id.as_ref().to_string(),
        role: ParticipantRole::Member,
        joined_at: Utc::now(),
        left_at: None,
    }
}

fn posted(
    channel_id: Uuid,
    thread_id: Option<Uuid>,
    sender: &MacroUserIdStr<'static>,
    participants: Vec<ChannelParticipant>,
    mentions: Vec<SimpleMention>,
) -> ChannelEvent {
    let now = Utc::now();
    ChannelEvent::MessagePosted {
        channel_id,
        metadata: ChannelMetadata {
            channel_type: ChannelType::Private,
            channel_name: "Project".to_string(),
            named: true,
        },
        participants,
        message: MutatedMessage {
            id: Uuid::new_v4(),
            channel_id,
            thread_id,
            sender_id: Sender::new_from_user(sender.clone()),
            triggered_by: None,
            triggered_via: None,
            content: "hello".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
        },
        mentions,
        has_attachments: false,
        notification_policy: PostMessageNotificationPolicy::Default,
        finalized_reply: false,
    }
}

#[tokio::test]
async fn a_message_names_the_members_it_mentions_as_fallbacks() {
    let channel_id = Uuid::new_v4();
    let sender = user("sender@example.com");
    let mentioned = user("mentioned@example.com");
    let other = user("other@example.com");
    let outsider = user("outsider@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        FakeRealtime::default(),
        notifications.clone(),
        FakeContacts::default(),
    );

    service
        .handle(posted(
            channel_id,
            None,
            &sender,
            vec![
                member(channel_id, &sender),
                member(channel_id, &mentioned),
                member(channel_id, &other),
            ],
            vec![
                SimpleMention::user(&mentioned),
                SimpleMention::user(&outsider),
                SimpleMention::user(&sender),
            ],
        ))
        .await;

    let effects = notifications.effects.lock().unwrap();
    let message = effects
        .iter()
        .find_map(|effect| match effect {
            ChannelNotificationEffect::ChannelMessage {
                recipient_ids,
                mention_fallback_ids,
                ..
            } => Some((recipient_ids, mention_fallback_ids)),
            _ => None,
        })
        .expect("expected a channel message notification");

    // The sender and non-members are never fallbacks.
    assert_eq!(message.0, &HashSet::from([other]));
    assert_eq!(message.1, &HashSet::from([mentioned]));
}

#[tokio::test]
async fn a_reply_names_the_thread_members_it_mentions_as_fallbacks() {
    let channel_id = Uuid::new_v4();
    let sender = user("sender@example.com");
    let follower = user("follower@example.com");
    let mentioned = user("mentioned@example.com");
    let elsewhere = user("elsewhere@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext {
            thread_context: ThreadNotificationContext {
                participants: vec![sender.clone(), follower.clone(), mentioned.clone()],
                connected_call_participants: vec![],
                parent_sender_id: None,
            },
            ..FakeContext::default()
        },
        FakeRealtime::default(),
        notifications.clone(),
        FakeContacts::default(),
    );

    service
        .handle(posted(
            channel_id,
            Some(Uuid::new_v4()),
            &sender,
            vec![
                member(channel_id, &sender),
                member(channel_id, &follower),
                member(channel_id, &mentioned),
                member(channel_id, &elsewhere),
            ],
            vec![
                SimpleMention::user(&mentioned),
                SimpleMention::user(&elsewhere),
            ],
        ))
        .await;

    let effects = notifications.effects.lock().unwrap();
    let reply = effects
        .iter()
        .find_map(|effect| match effect {
            ChannelNotificationEffect::Reply {
                recipient_ids,
                mention_fallback_ids,
                ..
            } => Some((recipient_ids, mention_fallback_ids)),
            _ => None,
        })
        .expect("expected a reply notification");

    // A member outside the thread hears about it only through the mention.
    assert_eq!(reply.0, &HashSet::from([follower]));
    assert_eq!(reply.1, &HashSet::from([mentioned]));
}
