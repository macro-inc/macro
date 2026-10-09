use chrono::{TimeZone, Utc};
use document_sub_type::DocumentSubType;
use email::domain::models::ParsedLabel;
use messages::domain::models::{BotSenderProfile, MessageParent};
use model_owner::Owner;
use models_properties::{DataType, PropertyOwner};
use properties::PropertyOptionInfo;

use super::*;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()
}

fn event(name: &str, message_id: Option<Uuid>) -> EventReference {
    serde_json::from_value(json!({
        "event_id": macro_uuid::generate_uuid_v7(),
        "event_name": name,
        "entity_id": macro_uuid::generate_uuid_v7(),
        "message_id": message_id,
    }))
    .unwrap()
}

fn email() -> ParsedMessage {
    let at = Utc.with_ymd_and_hms(2026, 10, 5, 9, 30, 0).unwrap();
    ParsedMessage {
        db_id: Uuid::nil(),
        link_id: Uuid::nil(),
        thread_db_id: Uuid::nil(),
        subject: Some("Invoice #42".into()),
        snippet: Some("Please find attached".into()),
        from: Some(ContactInfo {
            email: "billing@vendor.com".into(),
            name: Some("Vendor Billing".into()),
            photo_url: Some("https://example.com/p.png".into()),
        }),
        to: vec![ContactInfo {
            email: "owner@example.com".into(),
            name: None,
            photo_url: None,
        }],
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
        internal_date_ts: Some(at),
        sent_at: None,
        is_read: false,
        is_starred: false,
        is_sent: false,
        is_draft: false,
        has_attachments: true,
        created_at: at,
        updated_at: at,
    }
}

#[test]
fn emails_carry_headers_and_the_reply_free_body_but_not_bcc() {
    assert_eq!(
        email_json(&email()),
        json!({
            "subject": "Invoice #42",
            "from": {"name": "Vendor Billing", "email": "billing@vendor.com"},
            "to": [{"name": null, "email": "owner@example.com"}],
            "cc": [],
            "received_at": "2026-10-05T09:30:00Z",
            "labels": ["Inbox"],
            "has_attachments": true,
            "body": "Your invoice for October is $420.",
        })
    );
    let mut snippet_only = email();
    snippet_only.body_parsed = None;
    snippet_only.body_text = None;
    assert_eq!(email_json(&snippet_only)["body"], "Please find attached");
}

#[test]
fn envelope_names_the_event_and_the_owner() {
    let event = event("email.message_received", Some(Uuid::nil()));
    let value = envelope(&owner(), &event, json!({"email": {"subject": "Hi"}}));
    assert_eq!(value["event"], "email.message_received");
    assert_eq!(value["routine_owner"], "owner@example.com");
    assert_eq!(value["email"], json!({"subject": "Hi"}));
    assert_eq!(
        value["occurred_at"],
        serde_json::to_value(event.published_at()).unwrap()
    );
}

#[test]
fn long_text_is_cut_on_a_character_boundary() {
    assert_eq!(truncate("short"), "short");
    let long = "é".repeat(MAX_TEXT_CHARS + 10);
    let cut = truncate(&long);
    assert_eq!(cut.chars().count(), MAX_TEXT_CHARS + 1);
    assert!(cut.ends_with('…'));
}

fn message(content: &str) -> Message {
    let at = Utc.with_ymd_and_hms(2026, 10, 5, 9, 30, 0).unwrap();
    Message {
        id: Uuid::nil(),
        parent: MessageParent::Channel(Uuid::nil()),
        thread_id: None,
        sender_id: "macro|sender@example.com".to_owned().try_into().unwrap(),
        imported_author: None,
        bot_profile: None,
        mentions: Vec::new(),
        triggered_by: None,
        content: content.into(),
        created_at: at,
        updated_at: at,
        edited_at: None,
        deleted_at: None,
        attachments: Vec::new(),
        reactions: Vec::new(),
    }
}

#[test]
fn channel_messages_are_plain_text_from_their_sender() {
    let value = message_json(&message("Can someone review the Q3 plan?"));
    assert_eq!(value["sender"], "sender@example.com");
    assert_eq!(value["text"], "Can someone review the Q3 plan?");
    assert_eq!(value["edited"], false);

    let mut bot = message("Deploy finished");
    bot.bot_profile = Some(BotSenderProfile {
        name: "CI".into(),
        avatar_url: None,
    });
    assert_eq!(message_json(&bot)["sender"], "CI");
}

fn task() -> DocumentBasic {
    DocumentBasic {
        document_id: Uuid::nil().to_string(),
        document_name: "Login page crashes on Safari".into(),
        owner: Owner::User(owner()),
        file_type: Some("md".into()),
        sub_type: Some(DocumentSubType::Task),
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        project_id: None,
        deleted_at: None,
    }
}

fn select(name: &str, options: &[&str], selected: usize) -> EntityPropertyInfo {
    let options: Vec<_> = options
        .iter()
        .enumerate()
        .map(|(index, label)| PropertyOptionInfo {
            id: macro_uuid::generate_uuid_v7(),
            display_order: index as i32,
            value: PropertyOptionValue::String((*label).into()),
        })
        .collect();
    let value = options
        .get(selected)
        .map(|option| PropertyValue::SelectOption(vec![option.id]));
    EntityPropertyInfo {
        property_definition_id: macro_uuid::generate_uuid_v7(),
        owner: PropertyOwner::System,
        display_name: name.into(),
        data_type: DataType::SelectString,
        is_multi_select: false,
        is_system: true,
        value,
        options,
    }
}

#[test]
fn tasks_show_option_labels_and_skip_unset_properties() {
    let mut unset = select("Assignee", &["A"], 0);
    unset.value = None;
    let mut due = select("Due", &[], 0);
    due.data_type = DataType::Date;
    due.value = Some(PropertyValue::Date(
        Utc.with_ymd_and_hms(2026, 10, 9, 0, 0, 0).unwrap(),
    ));
    let properties = [
        select("Status", &["Todo", "In progress", "Done"], 1),
        select("Priority", &["Low", "High"], 1),
        unset,
        due,
    ];

    assert_eq!(
        document_json(
            &task(),
            &properties,
            Some("Steps: open login on Safari 17.")
        ),
        json!({
            "kind": "task",
            "name": "Login page crashes on Safari",
            "file_type": "md",
            "deleted": false,
            "properties": {
                "Status": ["In progress"],
                "Priority": ["High"],
                "Due": "2026-10-09T00:00:00Z",
            },
            "content": "Steps: open login on Safari 17.",
        })
    );
}

#[test]
fn deleted_documents_say_so_without_content() {
    let mut document = task();
    document.sub_type = None;
    document.deleted_at = Some(Utc::now());
    let value = document_json(&document, &[], None);
    assert_eq!(value["kind"], "document");
    assert_eq!(value["deleted"], true);
    assert_eq!(value["content"], Value::Null);
}
