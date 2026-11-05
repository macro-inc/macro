use super::*;

#[test]
fn reject_path_injection_and_invalid_provider_identifiers() {
    for raw in [
        "",
        "../other",
        "inbox/other",
        "inbox?key=value",
        "inbox#fragment",
        "with space",
        "inbox%2Fother",
        "\n",
        "inbøx",
    ] {
        assert!(MailboxId::parse(raw.to_owned()).is_err());
        assert!(MailMessageId::parse(raw.to_owned()).is_err());
        assert!(MailThreadId::parse(raw.to_owned()).is_err());
    }
    assert!(MailboxId::parse("a".repeat(256)).is_err());
}

#[test]
fn serde_validates_and_keeps_provider_wire_ids() {
    let id: MailboxId = serde_json::from_str("\"inbox_01-A\"").expect("valid provider id");
    assert_eq!(id.as_str(), "inbox_01-A");
    assert_eq!(
        serde_json::to_string(&id).expect("serialize"),
        "\"inbox_01-A\""
    );
    assert!(serde_json::from_str::<MailboxId>("\"../other\"").is_err());
    assert!(serde_json::from_str::<MailMessageId>("\"../other\"").is_err());
    assert!(serde_json::from_str::<MailThreadId>("\"../other\"").is_err());
}

#[cfg(feature = "inbound")]
#[test]
fn email_schema_keeps_inline_string_identifiers() {
    use crate::domain::models::{EmailMessage, SentEmail};
    use utoipa::PartialSchema;

    let message = serde_json::to_value(EmailMessage::schema()).expect("schema");
    assert_eq!(message["properties"]["messageId"]["type"], "string");
    assert_eq!(message["properties"]["threadId"]["type"], "string");
    let sent = serde_json::to_value(SentEmail::schema()).expect("schema");
    assert_eq!(sent["properties"]["messageId"]["type"], "string");
}
