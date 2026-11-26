use super::*;

/// A message `sender` posted in a direct message between `owner` and a bot.
fn posted_in_dm(
    channel_id: Uuid,
    owner: &MacroUserIdStr<'static>,
    sender: Sender,
    mentions: Vec<SimpleMention>,
) -> ChannelEvent {
    let now = Utc::now();
    let bot_principal = BotId::new_from_uuid(Uuid::from_u128(9))
        .into_storage_id()
        .to_string();
    ChannelEvent::MessagePosted {
        channel_id,
        metadata: ChannelMetadata {
            channel_type: ChannelType::DirectMessage,
            channel_name: "Agent".to_string(),
            named: false,
        },
        participants: [owner.as_ref(), bot_principal.as_str()]
            .into_iter()
            .map(|principal| ChannelParticipant {
                channel_id,
                user_id: principal.to_string(),
                role: ParticipantRole::Member,
                joined_at: now,
                left_at: None,
            })
            .collect(),
        message: MutatedMessage {
            id: Uuid::new_v4(),
            channel_id,
            thread_id: None,
            sender_id: sender,
            triggered_by: None,
            triggered_via: None,
            content: "find time with them".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
        },
        mentions,
        has_attachments: false,
        notification_policy: PostMessageNotificationPolicy::Default,
    }
}

fn mention_recipients(notifications: &FakeNotifications) -> Vec<HashSet<MacroUserIdStr<'static>>> {
    notifications
        .effects
        .lock()
        .unwrap()
        .iter()
        .filter_map(|effect| match effect {
            ChannelNotificationEffect::UserMention { recipient_ids, .. } => {
                Some(recipient_ids.clone())
            }
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn naming_someone_to_an_agent_in_its_dm_notifies_nobody() {
    let channel_id = Uuid::new_v4();
    let owner = user("owner@example.com");
    let named = user("named@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext {
            agent_dm: true,
            ..FakeContext::default()
        },
        FakeRealtime::default(),
        notifications.clone(),
        FakeContacts::default(),
    );

    service
        .handle(posted_in_dm(
            channel_id,
            &owner,
            Sender::new_from_user(owner.clone()),
            vec![SimpleMention::user(&named)],
        ))
        .await;

    assert!(
        mention_recipients(&notifications).is_empty(),
        "the person named is not told"
    );
}

#[tokio::test]
async fn an_agent_naming_people_in_its_dm_notifies_only_its_owner() {
    let channel_id = Uuid::new_v4();
    let owner = user("owner@example.com");
    let named = user("named@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext {
            agent_dm: true,
            ..FakeContext::default()
        },
        FakeRealtime::default(),
        notifications.clone(),
        FakeContacts::default(),
    );

    service
        .handle(posted_in_dm(
            channel_id,
            &owner,
            Sender::new_from_bot(BotId::new_from_uuid(Uuid::from_u128(9))),
            vec![SimpleMention::user(&owner), SimpleMention::user(&named)],
        ))
        .await;

    assert_eq!(
        mention_recipients(&notifications),
        vec![HashSet::from([owner])]
    );
}

#[tokio::test]
async fn naming_someone_in_a_dm_between_people_still_notifies_them() {
    let channel_id = Uuid::new_v4();
    let owner = user("owner@example.com");
    let named = user("named@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        FakeRealtime::default(),
        notifications.clone(),
        FakeContacts::default(),
    );

    service
        .handle(posted_in_dm(
            channel_id,
            &owner,
            Sender::new_from_user(owner.clone()),
            vec![SimpleMention::user(&named)],
        ))
        .await;

    assert_eq!(
        mention_recipients(&notifications),
        vec![HashSet::from([named])]
    );
}
