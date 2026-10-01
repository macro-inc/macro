use super::*;

#[test]
fn fallback_attribution_uses_the_canonical_bot_not_a_fabricated_user() {
    let message = HistoricalMessage {
        id: Uuid::now_v7(),
        source: SourceMessageId {
            team_id: Uuid::now_v7().try_into().unwrap(),
            slack_channel_id: "C123".parse().unwrap(),
            ts: "1.000001".parse().unwrap(),
        },
        channel_id: Uuid::now_v7(),
        parent_id: None,
        orphaned_thread_ts: None,
        sender: HistoricalSender::SystemBot,
        imported_author: Some("Archive author".into()),
        content: "historical".into(),
        user_mentions: vec![],
        import_order: 0,
        reactions: vec![],
    };
    let stored = convert(message).unwrap();
    assert_eq!(
        stored.sender,
        ChannelSender::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID)
    );
    assert_eq!(stored.imported_author.as_deref(), Some("Archive author"));
}
