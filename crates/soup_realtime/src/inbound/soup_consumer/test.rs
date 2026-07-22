use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_soup::{document::SoupDocument, item::SoupItem};
use uuid::Uuid;

use super::*;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|recipient@example.com".to_string()).expect("valid user id")
}

fn timestamp(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(seconds, 0).expect("valid timestamp")
}

fn message() -> SoupRealtimeMessage {
    SoupRealtimeMessage::new(
        user(),
        SoupItem::Document(SoupDocument {
            id: Uuid::parse_str("00000000-0000-0000-0000-000000000001").expect("valid document id"),
            document_version_id: 9,
            owner_id: user(),
            name: "Realtime document".to_string(),
            file_type: Some("md".to_string()),
            sha: Some("sha".to_string()),
            project_id: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            created_at: timestamp(1),
            updated_at: timestamp(2),
            viewed_at: None,
            sub_type: None,
            deleted_at: None,
            extra: (),
        }),
    )
}

#[test]
fn assigns_only_the_soup_topic() {
    assert_eq!(assigned_topics(), ["macro.soup"]);
}

#[test]
fn decodes_current_schema_message() {
    let payload = serde_json::to_vec(&message()).expect("serializable message");

    let decoded = decode_message(&payload).expect("message decodes");

    assert_eq!(decoded.schema_version, SoupRealtimeMessage::SCHEMA_VERSION);
    assert_eq!(decoded.user_id.as_ref(), "macro|recipient@example.com");
    match decoded.item {
        SoupItem::Document(document) => assert_eq!(document.name, "Realtime document"),
        _ => panic!("expected document item"),
    }
}

#[test]
fn rejects_unsupported_schema_version() {
    let mut json = serde_json::to_value(message()).expect("serializable message");
    json["schema_version"] = serde_json::json!(SoupRealtimeMessage::SCHEMA_VERSION + 1);
    let payload = serde_json::to_vec(&json).expect("serializable JSON");

    decode_message(&payload).expect_err("unsupported schema is rejected");
}

#[test]
fn rejects_malformed_payload() {
    decode_message(b"not json").expect_err("malformed payload is rejected");
}
