use attention_feed::test_support::*;
use notification::domain::models::NotificationState;
use serde_json::{Value, json};

use super::*;

const CHANNEL: u128 = 0xC0;
const ROOT: u128 = 0x7A;
const DOC: u128 = 0xD0;
const SESSION: u128 = 0x5E;

fn group(entity_type: EntityType, id: u128) -> FeedKey {
    FeedKey::new(entity(entity_type, id))
}

fn channel_rows(notifications: &[FeedNotification]) -> Vec<InboxRow> {
    rows(
        &group(EntityType::Channel, CHANNEL),
        notifications,
        None,
        &viewer_id(),
        at(59),
    )
}

fn rows_of(group: &FeedKey, notifications: &[FeedNotification]) -> Vec<InboxRow> {
    rows(group, notifications, None, &viewer_id(), at(59))
}

/// `(row type, shown ids, hidden ids)` per row.
fn shape(rows: &[InboxRow]) -> Vec<(InboxRowType, Vec<Uuid>, Vec<Uuid>)> {
    rows.iter()
        .map(|row| (row.row_type, ids(&row.notifications), ids(&row.hidden)))
        .collect()
}

fn document_mention(
    id: u128,
    message: u128,
    thread: Option<u128>,
    owner: &str,
    minute: u32,
) -> FeedNotification {
    let mut content = json!({
        "documentName": "Plan",
        "owner": owner,
        "messageId": uuid(message),
        "messageContent": "see doc",
        "channelType": "public",
    });
    if let Some(thread) = thread {
        content["threadId"] = json!(uuid(thread));
    }
    notification(
        id,
        entity(EntityType::Channel, CHANNEL),
        "document_mention",
        content,
        minute,
        NotificationState::Unseen,
    )
}

#[test]
fn a_top_level_message_that_mentions_you_is_one_mention_row() {
    // The mention and the document chip in the same message are one row on
    // the message's thread.
    let listed = channel_rows(&[
        channel_mention(1, CHANNEL, ROOT, None, 1),
        document_mention(2, ROOT, None, "macro|other@example.com", 1),
    ]);
    assert_eq!(
        shape(&listed),
        vec![(InboxRowType::ChannelMention, vec![uuid(1)], vec![uuid(2)])]
    );
    assert_eq!(listed[0].thread_id, Some(uuid(ROOT).to_string()));
}

#[test]
fn replies_join_the_mention_row_which_keeps_its_id() {
    let mention = channel_mention(1, CHANNEL, ROOT, None, 1);
    let reply = channel_reply(2, CHANNEL, ROOT, 0x101, 2);

    let alone = channel_rows(std::slice::from_ref(&mention));
    let with_reply = channel_rows(&[mention.clone(), reply]);
    assert_eq!(
        shape(&with_reply),
        vec![(InboxRowType::ChannelMention, vec![uuid(2), uuid(1)], vec![])]
    );
    assert_eq!(alone[0].id, with_reply[0].id);
    assert_eq!(
        alone[0].id.id(),
        format!("channel:{}#thread:{}", uuid(CHANNEL), uuid(ROOT))
    );

    // Once the mention is done the replies are a thread row with the same id.
    let reply_only = channel_rows(&[channel_reply(2, CHANNEL, ROOT, 0x101, 2)]);
    assert_eq!(reply_only[0].row_type, InboxRowType::ChannelThread);
    assert_eq!(reply_only[0].id, alone[0].id);
}

#[test]
fn a_channel_splits_into_its_top_level_row_and_thread_rows() {
    let listed = channel_rows(&[
        channel_send(1, CHANNEL, 0x100, 1),
        channel_reaction(2, CHANNEL, 0x101, None, 2),
        channel_invite(3, CHANNEL, 3),
        // A plain chip in a top-level message rides with that message.
        channel_send(4, CHANNEL, 0x102, 4),
        document_mention(5, 0x102, None, "macro|other@example.com", 4),
        // Reactions inside a thread belong to the thread.
        channel_reaction(6, CHANNEL, 0x103, Some(ROOT), 5),
    ]);
    assert_eq!(
        shape(&listed),
        vec![
            (InboxRowType::ChannelThread, vec![uuid(6)], vec![]),
            (
                InboxRowType::ChannelMessages,
                vec![uuid(4), uuid(3), uuid(2), uuid(1)],
                vec![uuid(5)]
            ),
        ]
    );
    assert_eq!(
        listed[1].id.id(),
        format!("channel:{}#top_level", uuid(CHANNEL))
    );
    assert_eq!(listed[1].thread_id, None);
}

#[test]
fn every_channel_notification_has_one_home() {
    let notifications = vec![
        channel_send(1, CHANNEL, ROOT, 1),
        channel_reply(2, CHANNEL, ROOT, 0x101, 2),
        channel_mention(3, CHANNEL, 0x102, Some(ROOT), 3),
        document_mention(4, 0x102, Some(ROOT), USER, 3),
        channel_reaction(5, CHANNEL, 0x103, None, 4),
        channel_mention(6, CHANNEL, 0x104, None, 5),
        channel_send(7, CHANNEL, 0x105, 6),
    ];
    let listed = channel_rows(&notifications);
    let mut homed: Vec<Uuid> = listed
        .iter()
        .flat_map(|row| row.all_notifications().map(|n| n.notification_id))
        .collect();
    homed.sort();
    let mut all = ids(&notifications);
    all.sort();
    assert_eq!(homed, all);
}

#[test]
fn a_root_message_moves_into_its_active_thread() {
    assert_eq!(
        shape(&channel_rows(&[
            channel_send(1, CHANNEL, ROOT, 1),
            channel_reply(2, CHANNEL, ROOT, 0x101, 2),
        ])),
        vec![(InboxRowType::ChannelThread, vec![uuid(2), uuid(1)], vec![])]
    );
}

#[test]
fn a_mention_in_a_reply_is_a_thread_row() {
    assert_eq!(
        shape(&channel_rows(&[
            channel_mention(1, CHANNEL, 0x101, Some(ROOT), 1),
            document_mention(2, 0x101, Some(ROOT), USER, 1),
        ])),
        vec![(InboxRowType::ChannelThread, vec![uuid(1)], vec![uuid(2)])]
    );
}

#[test]
fn document_mentions_show_only_your_documents() {
    assert_eq!(
        shape(&channel_rows(&[
            document_mention(1, 0x100, None, USER, 1),
            document_mention(2, 0x101, None, "macro|other@example.com", 2),
        ])),
        vec![(InboxRowType::ChannelMessages, vec![uuid(1)], vec![uuid(2)])]
    );
}

#[test]
fn calls_alone_list_nothing() {
    let call = notification(
        1,
        entity(EntityType::Channel, CHANNEL),
        "call_started",
        json!({ "callId": uuid(0x99), "channelType": "public" }),
        1,
        NotificationState::Unseen,
    );
    assert!(channel_rows(&[call]).is_empty());
}

#[test]
fn discussions_split_into_mentions_threads_and_top_level_comments() {
    let doc = group(EntityType::Document, DOC);
    let listed = rows_of(
        &doc,
        &[
            // Thread A: a root comment that mentions you, then a reply.
            doc_comment_mention(1, DOC, 0xA0, 0xA0, 1),
            doc_reply(2, DOC, 0xA1, 0xA0, 2),
            // Thread B: a reply to a thread you are in.
            doc_reply(3, DOC, 0xB1, 0xB0, 3),
            // Threads C and D: lone root comments share the top-level row.
            doc_comment(4, DOC, 0xC0, 0xC0, 4),
            doc_comment(5, DOC, 0xD0, 0xD0, 5),
            // A mention in a reply of thread B shadows its comment.
            doc_comment(6, DOC, 0xB2, 0xB0, 6),
            doc_comment_mention(7, DOC, 0xB2, 0xB0, 6),
        ],
    );
    assert_eq!(
        shape(&listed),
        vec![
            (
                InboxRowType::DiscussionThread,
                vec![uuid(7), uuid(3)],
                vec![uuid(6)]
            ),
            (
                InboxRowType::DiscussionMessages,
                vec![uuid(5), uuid(4)],
                vec![]
            ),
            (
                InboxRowType::DiscussionMention,
                vec![uuid(2), uuid(1)],
                vec![]
            ),
        ]
    );
    assert_eq!(
        listed[0].id.id(),
        format!("document:{}#thread:{}", uuid(DOC), uuid(0xB0))
    );
    assert_eq!(listed[0].thread_id, Some(uuid(0xB0).to_string()));
    assert_eq!(
        listed[1].id.id(),
        format!("document:{}#top_level", uuid(DOC))
    );
}

fn project_discussion(
    id: u128,
    reason: &str,
    message: u128,
    thread: u128,
    minute: u32,
) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Initiative, 0x1A),
        "initiative_discussion",
        json!({
            "projectName": "Launch",
            "owner": USER,
            "reason": reason,
            "messageId": uuid(message),
            "threadId": uuid(thread),
            "text": "hello",
        }),
        minute,
        NotificationState::Unseen,
    )
}

#[test]
fn project_discussions_follow_their_reason() {
    assert_eq!(
        shape(&rows_of(
            &group(EntityType::Initiative, 0x1A),
            &[
                project_discussion(1, "mention", 0xA0, 0xA0, 1),
                project_discussion(2, "owner", 0xB0, 0xB0, 2),
                project_discussion(3, "reply", 0xC1, 0xC0, 3),
            ],
        )),
        vec![
            (InboxRowType::DiscussionThread, vec![uuid(3)], vec![]),
            (InboxRowType::DiscussionMessages, vec![uuid(2)], vec![]),
            (InboxRowType::DiscussionMention, vec![uuid(1)], vec![]),
        ]
    );
}

fn access_requested(id: u128, request: u128, minute: u32) -> FeedNotification {
    notification(
        id,
        entity(EntityType::Document, DOC),
        "entity_access_requested",
        json!({
            "requestId": uuid(request),
            "revision": 1,
            "entityName": "Plan",
            "accessLevel": "edit",
        }),
        minute,
        NotificationState::Unseen,
    )
}

#[test]
fn each_access_request_and_task_is_its_own_row() {
    let task = notification(
        3,
        entity(EntityType::Document, DOC),
        "task_assigned",
        json!({ "taskId": uuid(DOC), "taskName": "Ship", "assignedBy": "macro|other@example.com" }),
        3,
        NotificationState::Seen,
    );
    let listed = rows_of(
        &group(EntityType::Document, DOC),
        &[
            access_requested(1, 0xE1, 1),
            access_requested(2, 0xE2, 2),
            task,
        ],
    );
    assert_eq!(
        listed.iter().map(|row| row.row_type).collect::<Vec<_>>(),
        vec![
            InboxRowType::Task,
            InboxRowType::AccessRequested,
            InboxRowType::AccessRequested,
        ]
    );
    assert!(!listed[0].unseen, "a seen assignment is read");
    assert_eq!(
        listed[1].id.id(),
        format!("document:{}#access_requested:{}", uuid(DOC), uuid(0xE2))
    );
}

fn calendar_reminder(id: u128, ends_minute: u32) -> FeedNotification {
    notification(
        id,
        entity(EntityType::CalendarEvent, 0xCA),
        "calendar_event_reminder",
        json!({
            "eventId": uuid(0xCA),
            "occurrenceKey": format!("o{id}"),
            "title": "Standup",
            "startsAt": at(ends_minute - 1),
            "endsAt": at(ends_minute),
            "minutesBefore": 10,
        }),
        1,
        NotificationState::Unseen,
    )
}

#[test]
fn reminders_for_ended_events_are_hidden() {
    let event = group(EntityType::CalendarEvent, 0xCA);
    let upcoming = calendar_reminder(1, 30);
    let ended = calendar_reminder(2, 20);

    let listed = rows(
        &event,
        &[upcoming.clone(), ended.clone()],
        None,
        &viewer_id(),
        at(25),
    );
    assert_eq!(
        shape(&listed),
        vec![(InboxRowType::CalendarEvent, vec![uuid(1)], vec![uuid(2)])]
    );
    assert!(rows(&event, &[ended], None, &viewer_id(), at(25)).is_empty());
}

#[test]
fn email_rows_follow_the_mailbox_read_state() {
    let thread = group(EntityType::EmailThread, 0xE0);
    let email = new_email(1, 0xE0, 1, NotificationState::Unseen);
    let mailbox = |is_read| {
        Some(MailFacts {
            inbox_visible: true,
            is_read,
        })
    };
    let unread = rows(
        &thread,
        std::slice::from_ref(&email),
        mailbox(false),
        &viewer_id(),
        at(59),
    );
    let read = rows(&thread, &[email], mailbox(true), &viewer_id(), at(59));
    assert_eq!(unread[0].row_type, InboxRowType::Email);
    assert_eq!(
        unread[0].id.id(),
        format!("email_thread:{}#email", uuid(0xE0))
    );
    assert!(unread[0].unseen);
    assert!(
        !read[0].unseen,
        "an unseen new-email notification follows the read mailbox"
    );
}

fn session_ref() -> Value {
    json!({
        "sessionId": uuid(SESSION),
        "sessionName": "Inbox triage",
        "botId": uuid(0xB07),
        "botName": "Scout",
    })
}

fn agent_notification(id: u128, tag: &str, extra: Value, minute: u32) -> FeedNotification {
    let mut content = session_ref();
    for (key, value) in extra.as_object().unwrap() {
        content[key] = value.clone();
    }
    notification(
        id,
        entity(EntityType::AgentSession, SESSION),
        tag,
        content,
        minute,
        NotificationState::Unseen,
    )
}

fn settled(id: u128, minute: u32) -> FeedNotification {
    agent_notification(
        id,
        "agent_session_settled",
        json!({ "turn": id, "stopReason": "end_turn" }),
        minute,
    )
}

fn waiting(id: u128, minute: u32) -> FeedNotification {
    agent_notification(
        id,
        "agent_session_waiting_for_input",
        json!({ "turn": id, "question": "Which account?" }),
        minute,
    )
}

fn agent() -> Option<InboxActor> {
    Some(InboxActor::Agent {
        bot_id: uuid(0xB07),
        name: "Scout".to_string(),
    })
}

fn action(kind: InboxRowActionKind, target: Option<u128>, url: Option<&str>) -> InboxRowAction {
    InboxRowAction {
        kind,
        target_id: target.map(|target| uuid(target).to_string()),
        url: url.map(str::to_string),
    }
}

#[test]
fn an_agent_waiting_for_the_viewer_offers_an_answer() {
    let session = group(EntityType::AgentSession, SESSION);
    let listed = rows_of(&session, &[settled(1, 1), waiting(2, 2)]);
    assert_eq!(
        shape(&listed),
        vec![(InboxRowType::Agent, vec![uuid(2), uuid(1)], vec![])]
    );
    assert_eq!(
        listed[0].id.id(),
        format!("agent_session:{}#agent", uuid(SESSION))
    );
    assert_eq!(listed[0].actor, agent());
    assert_eq!(
        listed[0].actions,
        vec![action(InboxRowActionKind::Answer, None, None)]
    );

    // Once the agent finished again, there is nothing to answer.
    let finished = rows_of(&session, &[waiting(2, 2), settled(3, 3)]);
    assert_eq!(finished[0].actor, agent());
    assert!(finished[0].actions.is_empty());
}

#[test]
fn requests_offer_their_answers_on_the_request() {
    let listed = rows_of(
        &group(EntityType::Document, DOC),
        &[access_requested(1, 0xE1, 1)],
    );
    assert_eq!(
        listed[0].actions,
        vec![
            action(InboxRowActionKind::Approve, Some(0xE1), None),
            action(InboxRowActionKind::Deny, Some(0xE1), None),
        ]
    );

    let join = notification(
        2,
        entity(EntityType::CalendarEvent, 0xCA),
        "calendar_event_join_request",
        json!({ "requestId": uuid(0xF2), "eventId": uuid(0xCA), "title": "Standup" }),
        2,
        NotificationState::Unseen,
    );
    let listed = rows_of(&group(EntityType::CalendarEvent, 0xCA), &[join]);
    assert_eq!(listed[0].row_type, InboxRowType::CalendarJoinRequest);
    assert_eq!(
        listed[0].actions,
        vec![
            action(InboxRowActionKind::Accept, Some(0xF2), None),
            action(InboxRowActionKind::Decline, Some(0xF2), None),
        ]
    );
}

#[test]
fn rows_say_who_they_are_from() {
    let mut mention = channel_mention(1, CHANNEL, ROOT, None, 1);
    std::sync::Arc::make_mut(&mut mention).sender_id =
        Some(MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap());
    assert_eq!(
        channel_rows(&[mention])[0].actor,
        Some(InboxActor::User(
            MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap()
        ))
    );

    let event = group(EntityType::CalendarEvent, 0xCA);
    assert_eq!(
        rows(
            &event,
            &[calendar_reminder(1, 30)],
            None,
            &viewer_id(),
            at(25)
        )[0]
        .actor,
        Some(InboxActor::Macro)
    );

    // Mail from outside Macro has no actor.
    let thread = group(EntityType::EmailThread, 0xE0);
    assert_eq!(
        rows_of(&thread, &[new_email(1, 0xE0, 1, NotificationState::Unseen)])[0].actor,
        None
    );
}

#[test]
fn a_requested_review_offers_the_pull_request() {
    const URL: &str = "https://github.com/macro-inc/macro/pull/1";
    let requested = notification(
        1,
        entity(EntityType::ForeignEntity, 0xF0),
        "github_review_requested",
        json!({
            "foreignEntityId": uuid(0xF0),
            "githubKey": "macro-inc/macro#1",
            "owner": "macro-inc",
            "repo": "macro",
            "number": 1,
            "url": URL,
            "displayName": "macro-inc/macro#1",
            "title": "Fix the inbox",
        }),
        1,
        NotificationState::Unseen,
    );
    let listed = rows_of(&group(EntityType::ForeignEntity, 0xF0), &[requested]);
    assert_eq!(listed[0].row_type, InboxRowType::PullRequest);
    assert_eq!(
        listed[0].actions,
        vec![action(InboxRowActionKind::Review, None, Some(URL))]
    );
    assert_eq!(
        listed[0].actor, None,
        "GitHub users are not Macro principals"
    );
}
