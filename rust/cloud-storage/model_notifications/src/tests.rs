use super::*;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

fn make_user_id(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).expect("valid test email")
}

fn create_base_notification(
    notification_event: NotificationEvent,
    entity_type: EntityType,
    entity_id: &str,
) -> UserNotification {
    UserNotification {
        id: Uuid::new_v4(),
        notification_entity: entity_type.with_entity_string(entity_id.to_string()),
        sent: false,
        done: false,
        sender_id: Some(make_user_id("sender@example.com")),
        temporal: NotificationTemporalData::default(),
        notification_event,
    }
}

#[test]
fn test_build_key_channel_mention_uses_message_id() {
    let notif = create_base_notification(
        NotificationEvent::ChannelMention(ChannelMentionMetadata {
            message_id: "msg_123".to_string(),
            message_content: "Hello @user".to_string(),
            thread_id: None,
            common: CommonChannelMetadata {
                channel_type: ChannelType::Public,
                channel_name: "general".to_string(),
            },
        }),
        EntityType::Channel,
        "channel_abc",
    );

    let key = notif.build_key().into_hashed();

    // Two notifications with the same message_id should produce the same collapse key
    let notif2 = create_base_notification(
        NotificationEvent::ChannelMention(ChannelMentionMetadata {
            message_id: "msg_123".to_string(),
            message_content: "Different content".to_string(),
            thread_id: Some("thread_1".to_string()),
            common: CommonChannelMetadata {
                channel_type: ChannelType::Private,
                channel_name: "different-channel".to_string(),
            },
        }),
        EntityType::Channel,
        "different_channel_id",
    );

    let key2 = notif2.build_key().into_hashed();
    assert_eq!(key.as_ref(), key2.as_ref());
}

#[test]
fn test_build_key_channel_mention_different_message_ids_produce_different_keys() {
    let notif1 = create_base_notification(
        NotificationEvent::ChannelMention(ChannelMentionMetadata {
            message_id: "msg_123".to_string(),
            message_content: "Hello".to_string(),
            thread_id: None,
            common: CommonChannelMetadata {
                channel_type: ChannelType::Public,
                channel_name: "general".to_string(),
            },
        }),
        EntityType::Channel,
        "channel_abc",
    );

    let notif2 = create_base_notification(
        NotificationEvent::ChannelMention(ChannelMentionMetadata {
            message_id: "msg_456".to_string(),
            message_content: "Hello".to_string(),
            thread_id: None,
            common: CommonChannelMetadata {
                channel_type: ChannelType::Public,
                channel_name: "general".to_string(),
            },
        }),
        EntityType::Channel,
        "channel_abc",
    );

    let key1 = notif1.build_key().into_hashed();
    let key2 = notif2.build_key().into_hashed();
    assert_ne!(key1.as_ref(), key2.as_ref());
}

#[test]
fn test_build_key_channel_message_send_uses_message_id() {
    let notif = create_base_notification(
        NotificationEvent::ChannelMessageSend(ChannelMessageSendMetadata {
            sender: make_user_id("sender@example.com"),
            message_content: "Hello world".to_string(),
            message_id: "msg_send_123".to_string(),
            common: CommonChannelMetadata {
                channel_type: ChannelType::Public,
                channel_name: "general".to_string(),
            },
        }),
        EntityType::Channel,
        "channel_abc",
    );

    let key = notif.build_key().into_hashed();

    // Same message_id should produce same key regardless of other fields
    let notif2 = create_base_notification(
        NotificationEvent::ChannelMessageSend(ChannelMessageSendMetadata {
            sender: make_user_id("other@example.com"),
            message_content: "Different message".to_string(),
            message_id: "msg_send_123".to_string(),
            common: CommonChannelMetadata {
                channel_type: ChannelType::Private,
                channel_name: "other-channel".to_string(),
            },
        }),
        EntityType::Channel,
        "different_channel",
    );

    let key2 = notif2.build_key().into_hashed();
    assert_eq!(key.as_ref(), key2.as_ref());
}

#[test]
fn test_build_key_channel_message_reply_uses_message_id() {
    let notif = create_base_notification(
        NotificationEvent::ChannelMessageReply(ChannelReplyMetadata {
            thread_id: "thread_abc".to_string(),
            message_id: "reply_msg_123".to_string(),
            user_id: make_user_id("replier@example.com"),
            message_content: "This is a reply".to_string(),
            common: CommonChannelMetadata {
                channel_type: ChannelType::Public,
                channel_name: "general".to_string(),
            },
        }),
        EntityType::Channel,
        "channel_abc",
    );

    let key = notif.build_key().into_hashed();

    // Same message_id should produce same key
    let notif2 = create_base_notification(
        NotificationEvent::ChannelMessageReply(ChannelReplyMetadata {
            thread_id: "different_thread".to_string(),
            message_id: "reply_msg_123".to_string(),
            user_id: make_user_id("other@example.com"),
            message_content: "Different reply".to_string(),
            common: CommonChannelMetadata {
                channel_type: ChannelType::Private,
                channel_name: "other".to_string(),
            },
        }),
        EntityType::Channel,
        "different_channel",
    );

    let key2 = notif2.build_key().into_hashed();
    assert_eq!(key.as_ref(), key2.as_ref());
}

#[test]
fn test_build_key_item_shared_user_uses_entity() {
    let notif = create_base_notification(
        NotificationEvent::ItemSharedUser(ItemSharedMetadata {
            user_ids: vec!["user1".to_string()],
            item_type: EntityType::Document,
            item_id: "doc_123".to_string(),
            item_name: Some("My Document".to_string()),
            shared_by: make_user_id("sharer@example.com"),
            permission_level: Some("read".to_string()),
        }),
        EntityType::Document,
        "doc_entity_123",
    );

    let key = notif.build_key().into_hashed();

    // Same entity_type + entity_id should produce same key
    let notif2 = create_base_notification(
        NotificationEvent::ItemSharedUser(ItemSharedMetadata {
            user_ids: vec!["user2".to_string(), "user3".to_string()],
            item_type: EntityType::Project,
            item_id: "different_item".to_string(),
            item_name: Some("Different Name".to_string()),
            shared_by: make_user_id("other@example.com"),
            permission_level: Some("write".to_string()),
        }),
        EntityType::Document,
        "doc_entity_123",
    );

    let key2 = notif2.build_key().into_hashed();
    assert_eq!(key.as_ref(), key2.as_ref());
}

#[test]
fn test_build_key_item_shared_user_different_entities_produce_different_keys() {
    let notif1 = create_base_notification(
        NotificationEvent::ItemSharedUser(ItemSharedMetadata {
            user_ids: vec!["user1".to_string()],
            item_type: EntityType::Document,
            item_id: "doc_123".to_string(),
            item_name: None,
            shared_by: make_user_id("sharer@example.com"),
            permission_level: None,
        }),
        EntityType::Document,
        "doc_entity_123",
    );

    let notif2 = create_base_notification(
        NotificationEvent::ItemSharedUser(ItemSharedMetadata {
            user_ids: vec!["user1".to_string()],
            item_type: EntityType::Document,
            item_id: "doc_123".to_string(),
            item_name: None,
            shared_by: make_user_id("sharer@example.com"),
            permission_level: None,
        }),
        EntityType::Document,
        "doc_entity_456", // Different entity_id
    );

    let key1 = notif1.build_key().into_hashed();
    let key2 = notif2.build_key().into_hashed();
    assert_ne!(key1.as_ref(), key2.as_ref());
}

#[test]
fn test_build_key_different_entity_types_produce_different_keys() {
    let notif1 = create_base_notification(
        NotificationEvent::ItemSharedUser(ItemSharedMetadata {
            user_ids: vec!["user1".to_string()],
            item_type: EntityType::Document,
            item_id: "item_123".to_string(),
            item_name: None,
            shared_by: make_user_id("sharer@example.com"),
            permission_level: None,
        }),
        EntityType::Document,
        "entity_123",
    );

    let notif2 = create_base_notification(
        NotificationEvent::ItemSharedUser(ItemSharedMetadata {
            user_ids: vec!["user1".to_string()],
            item_type: EntityType::Document,
            item_id: "item_123".to_string(),
            item_name: None,
            shared_by: make_user_id("sharer@example.com"),
            permission_level: None,
        }),
        EntityType::Project, // Different entity_type
        "entity_123",
    );

    let key1 = notif1.build_key().into_hashed();
    let key2 = notif2.build_key().into_hashed();
    assert_ne!(key1.as_ref(), key2.as_ref());
}

#[test]
fn test_build_key_document_mention_uses_entity() {
    let notif = create_base_notification(
        NotificationEvent::DocumentMention(DocumentMentionMetadata {
            document_name: "My Doc".to_string(),
            owner: make_user_id("owner@example.com"),
            file_type: Some("pdf".to_string()),
            metadata: None,
        }),
        EntityType::Document,
        "doc_mention_entity",
    );

    let key = notif.build_key().into_hashed();
    assert!(!key.as_ref().is_empty());
}

#[test]
fn test_build_key_channel_invite_uses_entity() {
    let notif = create_base_notification(
        NotificationEvent::ChannelInvite(ChannelInviteMetadata {
            invited_by: make_user_id("inviter@example.com"),
            common: CommonChannelMetadata {
                channel_type: ChannelType::Private,
                channel_name: "secret-channel".to_string(),
            },
        }),
        EntityType::Channel,
        "channel_invite_entity",
    );

    let key = notif.build_key().into_hashed();
    assert!(!key.as_ref().is_empty());
}

#[test]
fn test_build_key_new_email_uses_entity() {
    let notif = create_base_notification(
        NotificationEvent::NewEmail(NewEmailMetadata {
            sender: Some("sender@email.com".to_string()),
            to_email: "recipient@email.com".to_string(),
            thread_id: "thread_123".to_string(),
            subject: "Test Subject".to_string(),
            snippet: "Email snippet...".to_string(),
        }),
        EntityType::Email,
        "email_entity_123",
    );

    let key = notif.build_key().into_hashed();
    assert!(!key.as_ref().is_empty());
}

#[test]
fn test_build_key_invite_to_team_uses_entity() {
    let notif = create_base_notification(
        NotificationEvent::InviteToTeam(InviteToTeamMetadata {
            team_name: "Engineering".to_string(),
            team_id: "team_123".to_string(),
            invited_by: make_user_id("inviter@example.com"),
            role: Some("member".to_string()),
        }),
        EntityType::Team,
        "team_entity_123",
    );

    let key = notif.build_key().into_hashed();
    assert!(!key.as_ref().is_empty());
}

#[test]
fn test_build_key_reject_team_invite_uses_entity() {
    let notif = create_base_notification(
        NotificationEvent::RejectTeamInvite,
        EntityType::Team,
        "team_entity_123",
    );

    let key = notif.build_key().into_hashed();
    assert!(!key.as_ref().is_empty());
}

#[test]
fn test_build_key_task_assigned_uses_entity() {
    let notif = create_base_notification(
        NotificationEvent::TaskAssigned(TaskAssignedMetadata {
            task_id: "task_123".to_string(),
            task_name: Some("Complete feature".to_string()),
            assigned_by: make_user_id("manager@example.com"),
        }),
        EntityType::Document, // Tasks might be associated with documents
        "task_entity_123",
    );

    let key = notif.build_key().into_hashed();
    assert!(!key.as_ref().is_empty());
}

#[test]
fn test_build_key_item_shared_organization_uses_entity() {
    let notif = create_base_notification(
        NotificationEvent::ItemSharedOrganization(ItemSharedOrganizationMetadata {
            org_user_ids: vec!["user1".to_string(), "user2".to_string()],
            item_type: EntityType::Project,
            item_id: "project_123".to_string(),
            item_name: Some("Shared Project".to_string()),
            shared_by: make_user_id("sharer@example.com"),
            permission_level: Some("admin".to_string()),
        }),
        EntityType::Project,
        "project_entity_123",
    );

    let key = notif.build_key().into_hashed();
    assert!(!key.as_ref().is_empty());
}

#[test]
fn test_build_key_channel_message_document_uses_entity() {
    let notif = create_base_notification(
        NotificationEvent::ChannelMessageDocument(ChannelMessageDocumentMetadata(
            DocumentMentionMetadata {
                document_name: "Attached Doc".to_string(),
                owner: make_user_id("owner@example.com"),
                file_type: Some("docx".to_string()),
                metadata: None,
            },
        )),
        EntityType::Document,
        "doc_attachment_entity",
    );

    let key = notif.build_key().into_hashed();
    assert!(!key.as_ref().is_empty());
}

#[test]
fn test_build_key_produces_hex_string() {
    let notif = create_base_notification(
        NotificationEvent::ChannelMention(ChannelMentionMetadata {
            message_id: "msg_123".to_string(),
            message_content: "Hello".to_string(),
            thread_id: None,
            common: CommonChannelMetadata {
                channel_type: ChannelType::Public,
                channel_name: "general".to_string(),
            },
        }),
        EntityType::Channel,
        "channel_abc",
    );

    let key = notif.build_key().into_hashed();
    let key_str = key.as_ref();

    // Should be a valid hex string (only hex characters)
    assert!(key_str.chars().all(|c| c.is_ascii_hexdigit()));
    // Should be 16 hex chars (64-bit hash = 8 bytes = 16 hex chars)
    assert_eq!(key_str.len(), 16);
}

#[test]
fn test_build_key_is_deterministic() {
    let notif = create_base_notification(
        NotificationEvent::ChannelMention(ChannelMentionMetadata {
            message_id: "msg_deterministic".to_string(),
            message_content: "Test".to_string(),
            thread_id: None,
            common: CommonChannelMetadata {
                channel_type: ChannelType::Public,
                channel_name: "test".to_string(),
            },
        }),
        EntityType::Channel,
        "channel_test",
    );

    let key1 = notif.build_key().into_hashed();

    // Create an identical notification
    let notif2 = create_base_notification(
        NotificationEvent::ChannelMention(ChannelMentionMetadata {
            message_id: "msg_deterministic".to_string(),
            message_content: "Test".to_string(),
            thread_id: None,
            common: CommonChannelMetadata {
                channel_type: ChannelType::Public,
                channel_name: "test".to_string(),
            },
        }),
        EntityType::Channel,
        "channel_test",
    );

    let key2 = notif2.build_key().into_hashed();

    assert_eq!(key1.as_ref(), key2.as_ref());
}
