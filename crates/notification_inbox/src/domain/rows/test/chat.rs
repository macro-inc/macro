use super::*;

fn seen(mut notification: FeedNotification) -> FeedNotification {
    std::sync::Arc::make_mut(&mut notification).state = NotificationState::Seen;
    notification
}

/// Of the rows of `notifications`, how many are unread and how many of those
/// Chat shows.
fn unread_and_in_chat(notifications: &[FeedNotification]) -> (usize, usize) {
    let listed = channel_rows(notifications);
    (
        listed.iter().filter(|row| row.unseen).count(),
        listed
            .iter()
            .filter(|row| unread_in_chat(row, &viewer_id()))
            .count(),
    )
}

#[test]
fn chat_shows_top_level_messages_and_every_mention() {
    let cases = [
        ("a message", channel_send(1, CHANNEL, 0x100, 1)),
        (
            "a mention in a message",
            channel_mention(1, CHANNEL, ROOT, None, 1),
        ),
        (
            "a mention in a reply",
            channel_mention(1, CHANNEL, 0x101, Some(ROOT), 1),
        ),
        (
            "a message linking the viewer's document",
            document_mention(1, 0x100, None, USER, 1),
        ),
    ];
    for (name, notification) in cases {
        assert_eq!(
            unread_and_in_chat(&[notification.clone()]),
            (1, 1),
            "{name}"
        );
        assert_eq!(unread_and_in_chat(&[seen(notification)]), (0, 0), "{name}");
    }
}

#[test]
fn chat_shows_no_reply_reaction_ping_or_invite() {
    let channel = || entity(EntityType::Channel, CHANNEL);
    let unread = [
        ("a reply", channel_reply(1, CHANNEL, ROOT, 0x101, 1)),
        (
            "a reaction to a message",
            channel_reaction(1, CHANNEL, 0x100, None, 1),
        ),
        (
            "a reaction in a thread",
            channel_reaction(1, CHANNEL, 0x101, Some(ROOT), 1),
        ),
        (
            "a reply linking the viewer's document",
            document_mention(1, 0x101, Some(ROOT), USER, 1),
        ),
        ("a ping on the channel", ping(1, channel(), None, 1)),
        (
            "a ping about a message",
            ping(1, channel(), Some(json!({ "messageId": uuid(0x100) })), 1),
        ),
    ];
    for (name, notification) in unread {
        assert_eq!(unread_and_in_chat(&[notification]), (1, 0), "{name}");
    }

    assert_eq!(
        unread_and_in_chat(&[channel_invite(1, CHANNEL, 1)]),
        (0, 0),
        "an invite is listed, but never unread"
    );
}

#[test]
fn chat_shows_a_thread_only_while_its_message_or_mention_is_unseen() {
    // The message stacks on its thread's row with the reply, so the row's
    // kind alone cannot say whether Chat shows it.
    let message = channel_send(1, CHANNEL, ROOT, 1);
    let reply = channel_reply(2, CHANNEL, ROOT, 0x101, 2);
    assert_eq!(
        unread_and_in_chat(&[message.clone(), reply.clone()]),
        (1, 1)
    );
    assert_eq!(unread_and_in_chat(&[seen(message), reply.clone()]), (1, 0));

    let mention = channel_mention(3, CHANNEL, 0x102, Some(ROOT), 3);
    assert_eq!(
        unread_and_in_chat(&[reply.clone(), mention.clone()]),
        (1, 1)
    );
    assert_eq!(unread_and_in_chat(&[reply, seen(mention)]), (1, 0));
}

#[test]
fn chat_shows_nothing_filed_outside_a_channel() {
    let document = group(EntityType::Document, DOC);
    let listed = rows_of(&document, &[doc_comment(1, DOC, 0x200, 0x200, 1)]);
    assert!(listed[0].unseen);
    assert!(!unread_in_chat(&listed[0], &viewer_id()));
}
