use models_email::service::{label::LabelInfo, message::ParsedSearchMessage};

use super::*;

fn message(label: Option<&str>, content: Option<&str>) -> ParsedSearchMessage {
    ParsedSearchMessage {
        db_id: Uuid::new_v4(),
        link_id: Uuid::new_v4(),
        thread_db_id: Uuid::new_v4(),
        subject: None,
        from: None,
        reply_to: None,
        to: Vec::new(),
        cc: Vec::new(),
        bcc: Vec::new(),
        labels: label
            .map(|provider_id| {
                vec![LabelInfo {
                    provider_id: provider_id.to_string(),
                    name: provider_id.to_string(),
                }]
            })
            .unwrap_or_default(),
        body_parsed_linkless: content.map(str::to_string),
        internal_date_ts: None,
    }
}

#[test]
fn classifies_mixed_thread_messages() {
    let messages = [
        message(Some(system_labels::SPAM), Some("spam")),
        message(Some(system_labels::TRASH), None),
        message(Some(system_labels::INBOX), None),
        message(Some(system_labels::INBOX), Some("ordinary")),
    ];

    let dispositions: Vec<_> = messages.iter().map(classify_thread_message).collect();

    assert_eq!(
        dispositions,
        vec![
            ThreadMessageDisposition::Delete,
            ThreadMessageDisposition::Delete,
            ThreadMessageDisposition::SkipMissingContent,
            ThreadMessageDisposition::Upsert,
        ]
    );
}

#[test]
fn indexes_a_message_without_a_from_contact() {
    let message = message(Some(system_labels::INBOX), None);
    let now = EpochMillis::new(0).expect("epoch is a valid timestamp");

    let args = upsert_args(message, "body".into(), "owner", Vec::new(), now);

    assert_eq!(args.sender, "");
    assert_eq!(args.content, "body");
}
