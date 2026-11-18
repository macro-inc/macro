use super::*;
use channels::domain::models::ChannelType;
use comms_db_client::messages::get_channel_message::ChannelMessageInfo;

#[test]
fn imported_author_is_indexed_separately_from_content_and_identity() {
    let message_id = Uuid::now_v7();
    let thread_id = Uuid::now_v7();
    for (author, thread) in [(Some("unique-archive-bot"), None), (None, Some(thread_id))] {
        let args = channel_message_upsert_args(ChannelMessageForSearch {
            message: ChannelMessageInfo {
                channel_id: Uuid::now_v7(),
                name: Some("Archive".into()),
                channel_type: ChannelType::Private,
                org_id: None,
                message_id,
                thread_id: thread,
                sender_id: "macro|system@macro.com".into(),
                imported_author: author.map(str::to_owned),
                content: " Historical content ".into(),
                created_at: chrono::DateTime::from_timestamp_millis(1_600_000_000_123).unwrap(),
                updated_at: chrono::DateTime::from_timestamp_millis(1_600_000_000_456).unwrap(),
                deleted_at: None,
            },
            mentions: vec!["user|macro|reader@example.com".into()],
        })
        .unwrap();
        assert_eq!(args.imported_author.as_deref(), author);
        assert_eq!(args.sender_id, "macro|system@macro.com");
        assert_eq!(args.content, "Historical content");
        assert_eq!(args.thread_id, thread.unwrap_or(message_id).to_string());
        assert_eq!(args.mentions, ["user|macro|reader@example.com"]);
        let json = serde_json::to_value(args).unwrap();
        assert_eq!(json["created_at_millis"], 1_600_000_000_123_i64);
        assert_eq!(json["updated_at_millis"], 1_600_000_000_456_i64);
    }
}

fn indexed_content(content: &str) -> String {
    channel_message_upsert_args(ChannelMessageForSearch {
        message: ChannelMessageInfo {
            channel_id: Uuid::now_v7(),
            name: Some("Support".into()),
            channel_type: ChannelType::Private,
            org_id: None,
            message_id: Uuid::now_v7(),
            thread_id: None,
            sender_id: "macro|sender@example.com".into(),
            imported_author: None,
            content: content.into(),
            created_at: chrono::DateTime::from_timestamp_millis(1_600_000_000_123).unwrap(),
            updated_at: chrono::DateTime::from_timestamp_millis(1_600_000_000_456).unwrap(),
            deleted_at: None,
        },
        mentions: vec![],
    })
    .unwrap()
    .content
}

/// The shape the editor writes: the paste is its own block, its JSON escapes
/// `<` and `>`.
#[test]
fn a_long_paste_is_indexed_as_its_content() {
    assert_eq!(
        indexed_content(
            "Seeing this in <m-link>{\"url\":\"https://example.com/run\",\"text\":\"the nightly run\"}</m-link>:\n\n<m-paste>{\"content\":\"invoice total overflow at \\u003cline 42\\u003e\\nretrying\",\"origin\":\"pasted\"}</m-paste>\n\nAny idea?"
        ),
        "Seeing this in the nightly run:\n\ninvoice total overflow at <line 42>\nretrying\n\nAny idea?"
    );
}

/// Text that is not markup keeps its stretch as written; the paste after it
/// is still its content.
#[test]
fn a_paste_after_text_that_does_not_parse_is_still_its_content() {
    assert_eq!(
        indexed_content(
            "when a < b\n\n<m-paste>{\"content\":\"pasted body\",\"origin\":\"pasted\"}</m-paste>\n\nthen"
        ),
        "when a < b\n\npasted body\n\nthen"
    );
}

#[test]
fn a_message_without_a_paste_that_does_not_parse_is_indexed_as_written() {
    let content =
        "see <m-link>{\"url\":\"https://example.com\",\"text\":\"docs\"}</m-link> when a < b";
    assert_eq!(indexed_content(content), content);
}
