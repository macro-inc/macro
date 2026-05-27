use super::*;

fn uid(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(value).unwrap().into_owned()
}

#[test]
fn channel_reply_title_uses_reply_sender_from_metadata() {
    let notification = ChannelReplyMetadata {
        thread_id: Uuid::nil().to_string(),
        message_id: Uuid::nil().to_string(),
        user_id: uid("macro|reply.sender@macro.com"),
        message_content: "hello".to_string(),
        has_attachments: false,
        thread_parent_sender_id: None,
        common: CommonChannelMetadata {
            channel_type: ChannelType::Team,
            channel_name: "AI Team".to_string(),
        },
        sender_profile_picture_url: None,
    };

    let title = notification
        .format_title(Some(uid("macro|wrong.sender@macro.com")))
        .unwrap();

    assert_eq!(title, "Reply from reply.sender");
}
