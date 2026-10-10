use channels::domain::models::{ChannelMetadata, ChannelType as ChannelKind};
use chrono::{TimeZone, Utc};
use document_sub_type::DocumentSubType;
use email::domain::models::{ContactInfo, ParsedLabel, ParsedMessage};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use messages::domain::models::{Message, MessageParent, MessageThread, ThreadState};
use model::document::DocumentBasic;
use model_owner::Owner;
use models_properties::{
    DataType, EntityType as PropertyEntityType, PropertyOwner,
    service::{property_option::PropertyOptionValue, property_value::PropertyValue},
    shared::EntityReference,
};
use properties::{EntityPropertyInfo, PropertyOptionInfo};
use serde_json::json;
use system_properties::SystemPropertyKey;
use trigger_context::{
    ChannelType, ContextMessage, ContextPerson, ContextThread, DiscussionContext,
    DiscussionSurface, EmailSnapshot, ReplyTarget, RoutineEvent, TaskSnapshot,
};

use super::super::{ChannelMessage, EventContent};
use super::routine_event;
use crate::domain::event_trigger::EventReference;

#[test]
fn a_task_status_change_carries_the_task_as_it_reads_now() {
    let event: EventReference = serde_json::from_value(json!({
        "event_id": "01928f3e-6a2b-7c3d-8e4f-0123456789cd",
        "event_name": "task.status_changed",
        "entity_id": "01928f3e-6a2b-7c3d-8e4f-000000007a5c",
        "message_id": null,
    }))
    .unwrap();
    let in_review = Uuid::parse_str("00000001-0000-0000-0002-000000000003").unwrap();
    let high = Uuid::parse_str("00000001-0000-0000-0003-000000000003").unwrap();
    let content = EventContent::Document {
        document: DocumentBasic {
            document_id: "01928f3e-6a2b-7c3d-8e4f-000000007a5c".into(),
            document_name: "Login page crashes on Safari".into(),
            owner: Owner::User(MacroUserIdStr::parse_from_str("macro|dana@example.com").unwrap()),
            file_type: Some("md".into()),
            sub_type: Some(DocumentSubType::Task),
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            project_id: None,
            deleted_at: None,
        },
        properties: vec![
            EntityPropertyInfo {
                property_definition_id: SystemPropertyKey::STATUS_UUID,
                owner: PropertyOwner::System,
                display_name: "Status".into(),
                data_type: DataType::SelectString,
                is_multi_select: false,
                is_system: true,
                value: Some(PropertyValue::SelectOption(vec![in_review])),
                options: vec![PropertyOptionInfo {
                    id: in_review,
                    display_order: 2,
                    value: PropertyOptionValue::String("In review".into()),
                }],
            },
            EntityPropertyInfo {
                property_definition_id: SystemPropertyKey::PRIORITY_UUID,
                owner: PropertyOwner::System,
                display_name: "Priority".into(),
                data_type: DataType::SelectString,
                is_multi_select: false,
                is_system: true,
                value: Some(PropertyValue::SelectOption(vec![high])),
                options: vec![PropertyOptionInfo {
                    id: high,
                    display_order: 2,
                    value: PropertyOptionValue::String("High".into()),
                }],
            },
            EntityPropertyInfo {
                property_definition_id: SystemPropertyKey::DUE_DATE_UUID,
                owner: PropertyOwner::System,
                display_name: "Due Date".into(),
                data_type: DataType::Date,
                is_multi_select: false,
                is_system: true,
                value: Some(PropertyValue::Date(
                    Utc.with_ymd_and_hms(2026, 10, 9, 0, 0, 0).unwrap(),
                )),
                options: Vec::new(),
            },
            EntityPropertyInfo {
                property_definition_id: SystemPropertyKey::ASSIGNEES_UUID,
                owner: PropertyOwner::System,
                display_name: "Assignees".into(),
                data_type: DataType::Entity,
                is_multi_select: true,
                is_system: true,
                value: Some(PropertyValue::EntityRef(vec![EntityReference {
                    entity_id: "macro|sam@example.com".into(),
                    entity_type: PropertyEntityType::User,
                    specific_message_id: None,
                }])),
                options: Vec::new(),
            },
            EntityPropertyInfo {
                property_definition_id: Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-0000000eff01")
                    .unwrap(),
                owner: PropertyOwner::System,
                display_name: "Estimate".into(),
                data_type: DataType::Number,
                is_multi_select: false,
                is_system: false,
                value: Some(PropertyValue::Num(3.0)),
                options: Vec::new(),
            },
        ],
        markdown: Some("Steps: open login on Safari 17.".into()),
    };

    assert_eq!(
        routine_event(&event, content).unwrap(),
        RoutineEvent::TaskStatusChanged {
            task: TaskSnapshot {
                id: "01928f3e-6a2b-7c3d-8e4f-000000007a5c".into(),
                title: "Login page crashes on Safari".into(),
                markdown: "Steps: open login on Safari 17.".into(),
                status: Some("In review".into()),
                priority: Some("High".into()),
                due: Some(Utc.with_ymd_and_hms(2026, 10, 9, 0, 0, 0).unwrap()),
                assignees: vec![ContextPerson {
                    id: "macro|sam@example.com".into(),
                    name: "sam@example.com".into(),
                    email: Some("sam@example.com".into()),
                }],
                project: None,
            },
        }
    );
}

#[test]
fn a_received_email_carries_its_headers_and_reply_free_body() {
    let event: EventReference = serde_json::from_value(json!({
        "event_id": "01928f3e-6a2b-7c3d-8e4f-0123456789cd",
        "event_name": "email.message_received",
        "entity_id": "01928f3e-6a2b-7c3d-8e4f-00000000e7a1",
        "message_id": "01928f3e-6a2b-7c3d-8e4f-00000000e3e5",
    }))
    .unwrap();
    let received_at = Utc.with_ymd_and_hms(2026, 10, 5, 9, 30, 0).unwrap();
    let content = EventContent::Email(Some(ParsedMessage {
        db_id: Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-00000000e3e5").unwrap(),
        link_id: Uuid::nil(),
        thread_db_id: Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-00000000e7a1").unwrap(),
        subject: Some("Invoice #42".into()),
        snippet: Some("Please find attached".into()),
        from: Some(ContactInfo {
            email: "billing@vendor.com".into(),
            name: Some("Vendor Billing".into()),
            photo_url: Some("https://example.com/p.png".into()),
        }),
        to: vec![
            ContactInfo {
                email: "dana@example.com".into(),
                name: None,
                photo_url: None,
            },
            ContactInfo {
                email: "ap@example.com".into(),
                name: Some("Accounts Payable".into()),
                photo_url: None,
            },
        ],
        cc: Vec::new(),
        bcc: vec![ContactInfo {
            email: "hidden@example.com".into(),
            name: None,
            photo_url: None,
        }],
        labels: vec![ParsedLabel {
            provider_id: "INBOX".into(),
            name: "Inbox".into(),
        }],
        body_parsed: Some("Your invoice for October is $420.".into()),
        body_text: Some("full text with quoted replies".into()),
        body_html_sanitized: None,
        body_macro: None,
        body_replyless: None,
        internal_date_ts: Some(received_at),
        sent_at: None,
        is_read: false,
        is_starred: false,
        is_sent: false,
        is_draft: false,
        has_attachments: true,
        created_at: received_at,
        updated_at: received_at,
    }));

    assert_eq!(
        routine_event(&event, content).unwrap(),
        RoutineEvent::EmailReceived {
            email: EmailSnapshot {
                thread_id: Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-00000000e7a1").unwrap(),
                subject: "Invoice #42".into(),
                from: "Vendor Billing <billing@vendor.com>".into(),
                to: vec![
                    "dana@example.com".into(),
                    "Accounts Payable <ap@example.com>".into(),
                ],
                received_at,
                body: "Your invoice for October is $420.".into(),
            },
        }
    );
}

#[test]
fn a_channel_reply_carries_its_thread_through_the_message() {
    let channel_id = Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-0000000c4a77").unwrap();
    let root_id = Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-000000000001").unwrap();
    let answer_id = Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-000000000002").unwrap();
    let deleted_id = Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-000000000003").unwrap();
    let prompt_id = Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-000000000004").unwrap();
    let later_id = Uuid::parse_str("01928f3e-6a2b-7c3d-8e4f-000000000005").unwrap();
    let event: EventReference = serde_json::from_value(json!({
        "event_id": "01928f3e-6a2b-7c3d-8e4f-0123456789cd",
        "event_name": "channel.message_posted",
        "entity_id": channel_id,
        "message_id": prompt_id,
    }))
    .unwrap();
    let at = |minute| Utc.with_ymd_and_hms(2026, 10, 8, 14, minute, 0).unwrap();
    let prompt = Message {
        id: prompt_id,
        parent: MessageParent::Channel(channel_id),
        thread_id: Some(root_id),
        sender_id: "macro|ana@example.com".to_owned().try_into().unwrap(),
        imported_author: None,
        bot_profile: None,
        mentions: Vec::new(),
        triggered_by: None,
        content: "Still broken on Safari 17, can someone look?".into(),
        created_at: at(4),
        updated_at: at(4),
        edited_at: None,
        deleted_at: None,
        attachments: Vec::new(),
        reactions: Vec::new(),
    };
    let content = EventContent::Channel {
        channel: ChannelMetadata {
            channel_type: ChannelKind::Public,
            channel_name: "eng".into(),
        },
        message: Some(ChannelMessage {
            message: prompt.clone(),
            thread: Some(MessageThread {
                state: ThreadState {
                    root_id,
                    user_id: "macro|ana@example.com".into(),
                    resolved: false,
                    anchor: None,
                    created_at: at(1),
                    updated_at: at(5),
                    deleted_at: None,
                },
                root: Message {
                    id: root_id,
                    parent: MessageParent::Channel(channel_id),
                    thread_id: None,
                    sender_id: "macro|ana@example.com".to_owned().try_into().unwrap(),
                    imported_author: None,
                    bot_profile: None,
                    mentions: Vec::new(),
                    triggered_by: None,
                    content: "Login crashes on Safari".into(),
                    created_at: at(1),
                    updated_at: at(1),
                    edited_at: None,
                    deleted_at: None,
                    attachments: Vec::new(),
                    reactions: Vec::new(),
                },
                replies: vec![
                    Message {
                        id: answer_id,
                        parent: MessageParent::Channel(channel_id),
                        thread_id: Some(root_id),
                        sender_id: "macro|sam@example.com".to_owned().try_into().unwrap(),
                        imported_author: None,
                        bot_profile: None,
                        mentions: Vec::new(),
                        triggered_by: None,
                        content: "Fixed in #812".into(),
                        created_at: at(2),
                        updated_at: at(2),
                        edited_at: None,
                        deleted_at: None,
                        attachments: Vec::new(),
                        reactions: Vec::new(),
                    },
                    Message {
                        id: deleted_id,
                        parent: MessageParent::Channel(channel_id),
                        thread_id: Some(root_id),
                        sender_id: "macro|sam@example.com".to_owned().try_into().unwrap(),
                        imported_author: None,
                        bot_profile: None,
                        mentions: Vec::new(),
                        triggered_by: None,
                        content: "oops".into(),
                        created_at: at(3),
                        updated_at: at(3),
                        edited_at: None,
                        deleted_at: Some(at(3)),
                        attachments: Vec::new(),
                        reactions: Vec::new(),
                    },
                    prompt,
                    Message {
                        id: later_id,
                        parent: MessageParent::Channel(channel_id),
                        thread_id: Some(root_id),
                        sender_id: "macro|sam@example.com".to_owned().try_into().unwrap(),
                        imported_author: None,
                        bot_profile: None,
                        mentions: Vec::new(),
                        triggered_by: None,
                        content: "Looking".into(),
                        created_at: at(5),
                        updated_at: at(5),
                        edited_at: None,
                        deleted_at: None,
                        attachments: Vec::new(),
                        reactions: Vec::new(),
                    },
                ],
            }),
        }),
    };

    let ana = ContextPerson {
        id: "macro|ana@example.com".into(),
        name: "ana@example.com".into(),
        email: Some("ana@example.com".into()),
    };
    assert_eq!(
        routine_event(&event, content).unwrap(),
        RoutineEvent::ChannelMessagePosted {
            discussion: DiscussionContext {
                surface: DiscussionSurface::Channel {
                    id: channel_id,
                    name: Some("eng".into()),
                    channel_type: ChannelType::Public,
                },
                prompt_message_id: prompt_id,
                sender: ana.clone(),
                reply_target: ReplyTarget::Thread { root_id },
                thread: Some(ContextThread {
                    root_id,
                    messages: vec![
                        ContextMessage {
                            id: root_id,
                            author: ana.clone(),
                            content: "Login crashes on Safari".into(),
                            posted_at: at(1),
                        },
                        ContextMessage {
                            id: answer_id,
                            author: ContextPerson {
                                id: "macro|sam@example.com".into(),
                                name: "sam@example.com".into(),
                                email: Some("sam@example.com".into()),
                            },
                            content: "Fixed in #812".into(),
                            posted_at: at(2),
                        },
                        ContextMessage {
                            id: prompt_id,
                            author: ana,
                            content: "Still broken on Safari 17, can someone look?".into(),
                            posted_at: at(4),
                        },
                    ],
                    messages_omitted: false,
                }),
                channel: Vec::new(),
            },
        }
    );
}
