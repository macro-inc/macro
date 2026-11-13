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
        thread_is_signal: false,
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

/// Thread d205 holds one promotions message from a sender the owner marked
/// important, so the inbox shows it as Signal. Search filters Signal and
/// Noise on the indexed document alone, which carries the labels but not the
/// owner's sender rules.
#[sqlx::test(
    migrations = "../../crates/macro_db_client/migrations",
    fixtures(
        path = "../../../../../../crates/email_db_client/fixtures",
        scripts("sync_thread_signal_flag")
    )
)]
async fn a_thread_the_inbox_shows_as_signal_is_indexed_as_signal(pool: PgPool) {
    let thread = Uuid::parse_str("00000000-0000-0000-0000-00000000d205").unwrap();
    let message_id = Uuid::parse_str("00000000-0000-0000-0000-00000000d506").unwrap();
    let mut connection = pool.acquire().await.unwrap();
    email_db_client::threads::update::recompute_signal(&mut connection, thread)
        .await
        .unwrap();
    let inbox_signal: bool =
        sqlx::query_scalar("SELECT is_signal FROM email_threads WHERE id = $1")
            .bind(thread)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        inbox_signal,
        "the fixture thread should be Signal in the inbox"
    );
    let message = email_db_client::messages::get_parsed_search::get_parsed_search_message_by_id(
        &pool,
        &message_id,
    )
    .await
    .unwrap()
    .unwrap();

    let document = serde_json::to_value(upsert_args(
        message,
        "body".into(),
        "owner",
        Vec::new(),
        EpochMillis::new(0).unwrap(),
    ))
    .unwrap();

    assert_eq!(
        document.get("is_signal"),
        Some(&serde_json::Value::Bool(true)),
        "{document}"
    );
}
