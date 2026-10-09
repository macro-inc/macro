use super::*;
use crate::domain::test_support::*;
use notification::domain::models::NotificationState;

const CHANNEL: u128 = 0xC0;
const THREAD: u128 = 0x7A;
const OTHER_THREAD: u128 = 0x7B;
const DOC: u128 = 0xD0;

fn kinds(stacks: &[WorkFeedStack]) -> Vec<WorkFeedStackKind> {
    stacks.iter().map(|stack| stack.kind).collect()
}

#[test]
fn thread_activity_leaves_the_channel_item() {
    let notifications = vec![
        channel_send(1, CHANNEL, THREAD, 1),
        channel_reply(2, CHANNEL, THREAD, 0x101, 2),
        channel_mention(3, CHANNEL, 0x102, Some(OTHER_THREAD), 3),
        channel_reaction(4, CHANNEL, 0x103, None, 4),
        channel_send(5, CHANNEL, 0x104, 5),
        channel_invite(6, CHANNEL, 6),
    ];

    // The channel keeps its plain new message and its channel-level invite;
    // the thread's root send moved into the now-active thread.
    assert_eq!(ids(&scope_channel(&notifications)), vec![uuid(5), uuid(6)]);
    assert_eq!(
        ids(&scope_channel_thread(
            &notifications,
            &uuid(THREAD).to_string()
        )),
        vec![uuid(1), uuid(2)]
    );
    assert_eq!(
        ids(&scope_channel_thread(
            &notifications,
            &uuid(OTHER_THREAD).to_string()
        )),
        vec![uuid(3)]
    );
    // A reaction to a root message belongs to that message's thread item.
    assert_eq!(
        ids(&scope_channel_thread(
            &notifications,
            &uuid(0x103).to_string()
        )),
        vec![uuid(4)]
    );
}

#[test]
fn a_root_mention_owns_its_future_thread() {
    let mention = channel_mention(1, CHANNEL, THREAD, None, 1);
    let reply = channel_reply(2, CHANNEL, THREAD, 0x101, 2);

    assert!(scope_channel(std::slice::from_ref(&mention)).is_empty());
    let alone = scope_channel_thread(std::slice::from_ref(&mention), &uuid(THREAD).to_string());
    assert_eq!(
        kinds(&stack(&alone)),
        vec![WorkFeedStackKind::ChannelMention]
    );

    // Its first reply joins the same item and turns it into a thread stack.
    let both = scope_channel_thread(&[mention, reply], &uuid(THREAD).to_string());
    let stacks = stack(&both);
    assert_eq!(kinds(&stacks), vec![WorkFeedStackKind::ChannelThread]);
    assert_eq!(stacks[0].thread_id, Some(uuid(THREAD).to_string()));
    assert_eq!(ids(&stacks[0].notifications), vec![uuid(2), uuid(1)]);
}

#[test]
fn a_mention_shadows_the_message_it_was_sent_in() {
    let notifications = vec![
        channel_send(1, CHANNEL, 0x100, 1),
        channel_mention(2, CHANNEL, 0x100, None, 1),
    ];
    let stacks = stack(&notifications);
    assert_eq!(kinds(&stacks), vec![WorkFeedStackKind::ChannelMention]);
    assert_eq!(ids(&stacks[0].notifications), vec![uuid(2)]);
}

#[test]
fn channel_stacks_group_sends_threads_and_reactions() {
    let notifications = vec![
        channel_send(1, CHANNEL, 0x100, 1),
        channel_send(2, CHANNEL, 0x101, 3),
        channel_reply(3, CHANNEL, THREAD, 0x102, 2),
        channel_mention(4, CHANNEL, 0x103, Some(THREAD), 4),
        channel_reaction(5, CHANNEL, 0x104, None, 5),
        channel_reaction(6, CHANNEL, 0x105, None, 0),
    ];
    let stacks = stack(&notifications);

    // Newest stack first: reactions (T5), the thread (T4), new sends (T3).
    assert_eq!(
        kinds(&stacks),
        vec![
            WorkFeedStackKind::ChannelReactions,
            WorkFeedStackKind::ChannelThread,
            WorkFeedStackKind::ChannelMessages,
        ]
    );
    assert_eq!(ids(&stacks[0].notifications), vec![uuid(5), uuid(6)]);
    assert_eq!(ids(&stacks[1].notifications), vec![uuid(4), uuid(3)]);
    assert_eq!(ids(&stacks[2].notifications), vec![uuid(2), uuid(1)]);
}

#[test]
fn document_comments_stack_by_thread() {
    let notifications = vec![
        // Thread A: a root comment and a reply -> one thread stack.
        doc_comment(1, DOC, 0xA0, 0xA0, 1),
        doc_reply(2, DOC, 0xA1, 0xA0, 2),
        // Thread B: a lone root comment; thread C: another.
        doc_comment(3, DOC, 0xB0, 0xB0, 3),
        doc_comment(4, DOC, 0xC0, 0xC0, 4),
        // Thread D: a mention shadows the comment it was made in.
        doc_comment(5, DOC, 0xD1, 0xD0, 5),
        doc_comment_mention(6, DOC, 0xD1, 0xD0, 6),
    ];
    let stacks = stack(&notifications);

    assert_eq!(
        kinds(&stacks),
        vec![
            WorkFeedStackKind::CommentMention,
            WorkFeedStackKind::Comments,
            WorkFeedStackKind::CommentThread,
        ]
    );
    assert_eq!(ids(&stacks[0].notifications), vec![uuid(6)]);
    assert_eq!(ids(&stacks[1].notifications), vec![uuid(4), uuid(3)]);
    assert_eq!(ids(&stacks[2].notifications), vec![uuid(2), uuid(1)]);
    assert_eq!(stacks[2].thread_id, Some(uuid(0xA0).to_string()));
}

#[test]
fn other_events_stand_alone_newest_first() {
    let document = entity(EntityType::Document, DOC);
    let notifications = vec![reminder(1, document.clone(), 1), reminder(2, document, 3)];
    let stacks = stack(&notifications);
    assert_eq!(
        kinds(&stacks),
        vec![WorkFeedStackKind::Event, WorkFeedStackKind::Event]
    );
    assert_eq!(stacks[0].latest().notification_id, uuid(2));
}

#[test]
fn stack_unseen_follows_its_notifications() {
    let seen = with_state(&channel_send(1, CHANNEL, 0x100, 1), NotificationState::Seen);
    let unseen_invite = channel_invite(2, CHANNEL, 2);
    let stacks = stack(&[seen, unseen_invite]);
    // Seen messages and invites (never unread) leave every stack seen.
    assert!(stacks.iter().all(|stack| !stack.is_unseen()));
}
