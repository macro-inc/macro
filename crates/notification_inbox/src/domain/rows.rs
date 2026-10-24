//! Inbox rows: how one group's notifications are cut into rows.
//!
//! A group is the viewer's pending notifications filed under one entity. A
//! channel's group holds its top level and every thread, so each channel
//! notification has exactly one home: the channel's top-level row or one
//! thread row. Every other notification lives in its entity's slot (a
//! discussion thread, the email thread, the task, one access request, ...).
//! Within its home a notification is shown or hidden:
//!
//! - **One message, one row.** A channel message or discussion comment that
//!   produced several notifications for the viewer is shown once, by the
//!   highest of mention, reply, plain message or comment, then document
//!   mention. The others are hidden in that row, so completing the row
//!   acknowledges them too.
//! - **Noise is hidden in its natural row:** calls starting, successful
//!   pull request checks, reminders for events that have ended, and document
//!   mentions of documents the viewer does not own.
//!
//! A row is listed only while it shows something. Team invites and inbox
//! reconnection notices have no row at all. Each row also says who it is
//! from and what the viewer can do from it.

use std::collections::{HashMap, HashSet};

use attention_feed::domain::models::{
    FeedKey, FeedNotification, MailFacts, counts_as_unseen, sort_newest_first,
};
use chrono::{DateTime, Days, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::{
    AgentSessionNotificationRef, CalendarEventReminderMetadata, CrmDiscussionReason,
    GithubPrCheckRunState, InitiativeDiscussionReason, NotifEvent,
};
use uuid::Uuid;

use super::models::{
    InboxActor, InboxRow, InboxRowAction, InboxRowActionKind, InboxRowId, InboxRowType,
};

#[cfg(test)]
mod test;

/// A row slot within one group.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Slot {
    /// A channel's or an entity's top-level discussion activity.
    TopLevel,
    /// One channel thread or discussion thread, by its root.
    Thread(String),
    Email,
    Agent,
    Task,
    PullRequest,
    CalendarEvent,
    CalendarJoinRequest(Uuid),
    AccessRequested(Uuid),
    AccessGranted(Uuid),
}

impl Slot {
    /// The slot's part of a row id.
    fn id(&self) -> String {
        match self {
            Self::TopLevel => "top_level".to_string(),
            Self::Thread(root) => format!("thread:{root}"),
            Self::Email => "email".to_string(),
            Self::Agent => "agent".to_string(),
            Self::Task => "task".to_string(),
            Self::PullRequest => "pull_request".to_string(),
            Self::CalendarEvent => "calendar_event".to_string(),
            Self::CalendarJoinRequest(id) => format!("calendar_join_request:{id}"),
            Self::AccessRequested(id) => format!("access_requested:{id}"),
            Self::AccessGranted(id) => format!("access_granted:{id}"),
        }
    }
}

/// A notification placed in its home slot.
#[derive(Debug, Clone)]
struct Placed {
    notification: FeedNotification,
    slot: Slot,
    shown: bool,
    /// A mention of the root message or comment of the row's thread.
    root_mention: bool,
}

/// What a notification says about a channel message or discussion comment,
/// for one-message-one-row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum MessageRole {
    Mention,
    Reply,
    Message,
    DocumentMention,
}

/// A channel notification, normalized.
struct ChannelView<'a> {
    notification: &'a FeedNotification,
    kind: ChannelKind<'a>,
}

enum ChannelKind<'a> {
    /// A message-shaped notification: a mention, reply, plain send or
    /// document mention of one message.
    Message {
        role: MessageRole,
        message_id: &'a str,
        thread_id: Option<&'a str>,
        /// For a document mention: the viewer owns the document.
        own_document: bool,
    },
    /// A reaction to one of the viewer's messages.
    Reaction { thread_id: Option<&'a str> },
    /// An invite to the channel.
    Invite,
    /// Anything else filed under the channel, such as a call starting.
    Quiet,
}

fn channel_view<'a>(
    notification: &'a FeedNotification,
    viewer: &MacroUserIdStr<'static>,
) -> ChannelView<'a> {
    let message = |role, message_id: &'a str, thread_id: Option<&'a str>| ChannelKind::Message {
        role,
        message_id,
        thread_id: thread_id.filter(|thread| !thread.is_empty()),
        own_document: false,
    };
    let kind = match &notification.notification_metadata {
        NotifEvent::ChannelMention(mention) => message(
            MessageRole::Mention,
            &mention.message_id,
            mention.thread_id.as_deref(),
        ),
        NotifEvent::ChannelMessageReply(reply) => message(
            MessageRole::Reply,
            &reply.message_id,
            Some(reply.thread_id.as_str()),
        ),
        NotifEvent::ChannelMessageSend(send) => {
            message(MessageRole::Message, &send.message_id, None)
        }
        NotifEvent::DocumentMention(mention) => ChannelKind::Message {
            role: MessageRole::DocumentMention,
            message_id: &mention.channel.message_id,
            thread_id: mention
                .channel
                .thread_id
                .as_deref()
                .filter(|thread| !thread.is_empty()),
            own_document: mention.owner == viewer.clone().into(),
        },
        NotifEvent::ChannelMessageReaction(reaction) => ChannelKind::Reaction {
            thread_id: reaction
                .thread_id
                .as_deref()
                .filter(|thread| !thread.is_empty()),
        },
        NotifEvent::ChannelInvite(_) => ChannelKind::Invite,
        _ => ChannelKind::Quiet,
    };
    ChannelView { notification, kind }
}

/// The notification that speaks for one message.
#[derive(Debug, Clone, Copy)]
struct Speaker<'a> {
    role: MessageRole,
    notification_id: Uuid,
    thread_id: Option<&'a str>,
}

/// Place a channel's notifications on its top level and its threads.
fn place_channel(
    notifications: &[FeedNotification],
    viewer: &MacroUserIdStr<'static>,
) -> Vec<Placed> {
    let views: Vec<ChannelView<'_>> = notifications
        .iter()
        .map(|notification| channel_view(notification, viewer))
        .collect();

    // Threads with replies or mentions in their replies absorb their root.
    let active: HashSet<&str> = views
        .iter()
        .filter_map(|view| match view.kind {
            ChannelKind::Message {
                role: MessageRole::Reply | MessageRole::Mention,
                thread_id: Some(thread),
                ..
            } => Some(thread),
            _ => None,
        })
        .collect();

    // The notification that speaks for each message, with the thread it
    // names.
    let mut speakers: HashMap<&str, Speaker<'_>> = HashMap::new();
    for view in &views {
        if let ChannelKind::Message {
            role,
            message_id,
            thread_id,
            ..
        } = view.kind
        {
            let candidate = Speaker {
                role,
                notification_id: view.notification.notification_id,
                thread_id,
            };
            speakers
                .entry(message_id)
                .and_modify(|speaker| {
                    if role < speaker.role {
                        *speaker = candidate;
                    }
                })
                .or_insert(candidate);
        }
    }

    let thread = |root: &str| Slot::Thread(root.to_string());
    views
        .iter()
        .map(|view| {
            let (slot, shown, root_mention) = match view.kind {
                ChannelKind::Message {
                    message_id,
                    own_document,
                    ..
                } => {
                    let speaker = speakers[message_id];
                    let slot = match (speaker.role, speaker.thread_id) {
                        (_, Some(root)) => thread(root),
                        (MessageRole::Mention, None) => thread(message_id),
                        (_, None) if active.contains(message_id) => thread(message_id),
                        (_, None) => Slot::TopLevel,
                    };
                    let speaks = speaker.notification_id == view.notification.notification_id;
                    let shown =
                        speaks && (speaker.role != MessageRole::DocumentMention || own_document);
                    let root_mention = speaks
                        && speaker.role == MessageRole::Mention
                        && speaker.thread_id.is_none();
                    (slot, shown, root_mention)
                }
                ChannelKind::Reaction {
                    thread_id: Some(root),
                } => (thread(root), true, false),
                ChannelKind::Reaction { thread_id: None } | ChannelKind::Invite => {
                    (Slot::TopLevel, true, false)
                }
                ChannelKind::Quiet => (Slot::TopLevel, false, false),
            };
            Placed {
                notification: view.notification.clone(),
                slot,
                shown,
                root_mention,
            }
        })
        .collect()
}

/// A discussion notification, normalized: its comment, thread root and
/// role.
struct DiscussionView<'a> {
    notification: &'a FeedNotification,
    role: MessageRole,
    comment_id: String,
    thread_id: String,
}

fn discussion_view(notification: &FeedNotification) -> Option<DiscussionView<'_>> {
    let comment_role = |comment: &str, thread: &str| {
        if comment == thread {
            MessageRole::Message
        } else {
            MessageRole::Reply
        }
    };
    let (role, comment_id, thread_id) = match &notification.notification_metadata {
        NotifEvent::CommentedOnDocument(comment) => {
            let (comment_id, thread_id) = (
                comment.comment_id.to_string(),
                comment.thread_id.to_string(),
            );
            (comment_role(&comment_id, &thread_id), comment_id, thread_id)
        }
        NotifEvent::RepliedToDocumentCommentThread(reply) => (
            MessageRole::Reply,
            reply.comment_id.to_string(),
            reply.thread_id.to_string(),
        ),
        NotifEvent::MentionedInDocumentComment(mention) => (
            MessageRole::Mention,
            mention.comment_id.to_string(),
            mention.thread_id.to_string(),
        ),
        NotifEvent::InitiativeDiscussion(discussion) => {
            let (comment_id, thread_id) = (
                discussion.message_id.to_string(),
                discussion.thread_id.to_string(),
            );
            let role = match discussion.reason {
                InitiativeDiscussionReason::Mention => MessageRole::Mention,
                _ => comment_role(&comment_id, &thread_id),
            };
            (role, comment_id, thread_id)
        }
        NotifEvent::CrmDiscussion(discussion) => {
            let (comment_id, thread_id) = (
                discussion.message_id.to_string(),
                discussion.thread_id.to_string(),
            );
            let role = match discussion.reason {
                CrmDiscussionReason::Mention => MessageRole::Mention,
                _ => comment_role(&comment_id, &thread_id),
            };
            (role, comment_id, thread_id)
        }
        _ => return None,
    };
    Some(DiscussionView {
        notification,
        role,
        comment_id,
        thread_id,
    })
}

/// Place an entity's discussion notifications: one row per active thread,
/// one for its other top-level comments.
fn place_discussions(views: Vec<DiscussionView<'_>>) -> Vec<Placed> {
    // Threads with activity beyond their root absorb the root.
    let active: HashSet<&str> = views
        .iter()
        .filter(|view| view.comment_id != view.thread_id)
        .map(|view| view.thread_id.as_str())
        .collect();
    let mut speakers: HashMap<&str, (MessageRole, Uuid)> = HashMap::new();
    for view in &views {
        let candidate = (view.role, view.notification.notification_id);
        speakers
            .entry(view.comment_id.as_str())
            .and_modify(|speaker| {
                if view.role < speaker.0 {
                    *speaker = candidate;
                }
            })
            .or_insert(candidate);
    }
    views
        .iter()
        .map(|view| {
            let (role, speaker) = speakers[view.comment_id.as_str()];
            let root = view.comment_id == view.thread_id;
            let threaded =
                !root || role == MessageRole::Mention || active.contains(view.thread_id.as_str());
            let speaks = speaker == view.notification.notification_id;
            Placed {
                notification: view.notification.clone(),
                slot: if threaded {
                    Slot::Thread(view.thread_id.clone())
                } else {
                    Slot::TopLevel
                },
                shown: speaks,
                root_mention: speaks && root && role == MessageRole::Mention,
            }
        })
        .collect()
}

/// Whether a calendar reminder's occurrence has ended by `now`. An all-day
/// occurrence counts as ended a day after its date, whatever the viewer's
/// zone.
fn occurrence_ended(reminder: &CalendarEventReminderMetadata, now: DateTime<Utc>) -> bool {
    match (reminder.ends_at, reminder.start_date) {
        (Some(ends_at), _) => ends_at < now,
        (None, Some(start_date)) => start_date
            .checked_add_days(Days::new(2))
            .is_some_and(|after| after <= now.date_naive()),
        (None, None) => false,
    }
}

/// The slot and visibility of a notification that is neither channel
/// activity nor discussion. `None` for kinds the inbox never shows.
fn place_event(notification: &FeedNotification, now: DateTime<Utc>) -> Option<(Slot, bool)> {
    Some(match &notification.notification_metadata {
        NotifEvent::EntityAccessRequested(request) => {
            (Slot::AccessRequested(request.request_id), true)
        }
        NotifEvent::EntityAccessGranted(grant) => (Slot::AccessGranted(grant.request_id), true),
        NotifEvent::NewEmail(_) | NotifEvent::Reminder(_) => (Slot::Email, true),
        NotifEvent::TaskAssigned(_) => (Slot::Task, true),
        NotifEvent::CalendarEventReminder(reminder) => {
            (Slot::CalendarEvent, !occurrence_ended(reminder, now))
        }
        NotifEvent::CalendarEventJoinRequest(request) => {
            (Slot::CalendarJoinRequest(request.request_id), true)
        }
        NotifEvent::AiResponse(_)
        | NotifEvent::AgentSessionSettled(_)
        | NotifEvent::AgentSessionWaitingForInput(_)
        | NotifEvent::AgentSessionMentioned(_) => (Slot::Agent, true),
        NotifEvent::GithubPrCheckRun(check) => (
            Slot::PullRequest,
            check.state != GithubPrCheckRunState::Completed,
        ),
        NotifEvent::GithubPrStatusChanged(_)
        | NotifEvent::GithubReviewRequested(_)
        | NotifEvent::GithubPrComment(_)
        | NotifEvent::GithubPrMention(_)
        | NotifEvent::GithubPrReview(_) => (Slot::PullRequest, true),
        NotifEvent::InboxReauthRequired(_) | NotifEvent::InviteToTeam(_) => return None,
        // Channel activity and discussions are placed by their own rules; on
        // any other entity they have no row.
        NotifEvent::ChannelMention(_)
        | NotifEvent::DocumentMention(_)
        | NotifEvent::ChannelMessageSend(_)
        | NotifEvent::ChannelMessageReply(_)
        | NotifEvent::ChannelMessageReaction(_)
        | NotifEvent::ChannelInvite(_)
        | NotifEvent::CallStarted(_)
        | NotifEvent::MentionedInDocumentComment(_)
        | NotifEvent::RepliedToDocumentCommentThread(_)
        | NotifEvent::CommentedOnDocument(_)
        | NotifEvent::InitiativeDiscussion(_)
        | NotifEvent::CrmDiscussion(_) => return None,
    })
}

fn row_type(slot: &Slot, channel: bool, root_mention: bool) -> InboxRowType {
    match (slot, channel, root_mention) {
        (Slot::TopLevel, true, _) => InboxRowType::ChannelMessages,
        (Slot::TopLevel, false, _) => InboxRowType::DiscussionMessages,
        (Slot::Thread(_), true, true) => InboxRowType::ChannelMention,
        (Slot::Thread(_), true, false) => InboxRowType::ChannelThread,
        (Slot::Thread(_), false, true) => InboxRowType::DiscussionMention,
        (Slot::Thread(_), false, false) => InboxRowType::DiscussionThread,
        (Slot::Email, ..) => InboxRowType::Email,
        (Slot::Agent, ..) => InboxRowType::Agent,
        (Slot::Task, ..) => InboxRowType::Task,
        (Slot::PullRequest, ..) => InboxRowType::PullRequest,
        (Slot::CalendarEvent, ..) => InboxRowType::CalendarEvent,
        (Slot::CalendarJoinRequest(_), ..) => InboxRowType::CalendarJoinRequest,
        (Slot::AccessRequested(_), ..) => InboxRowType::AccessRequested,
        (Slot::AccessGranted(_), ..) => InboxRowType::AccessGranted,
    }
}

/// Who a notification is from: the agent for agent session events, Macro
/// for reminders and AI chat responses, otherwise the user who sent it.
fn actor(notification: &FeedNotification) -> Option<InboxActor> {
    let agent = |session: &AgentSessionNotificationRef| InboxActor::Agent {
        bot_id: session.bot_id,
        name: session.bot_name.clone(),
    };
    match &notification.notification_metadata {
        NotifEvent::AgentSessionSettled(settled) => Some(agent(&settled.session)),
        NotifEvent::AgentSessionWaitingForInput(waiting) => Some(agent(&waiting.session)),
        NotifEvent::AgentSessionMentioned(mentioned) => Some(
            mentioned
                .mentioned_by
                .clone()
                .map_or_else(|| agent(&mentioned.session), InboxActor::User),
        ),
        NotifEvent::AiResponse(_)
        | NotifEvent::Reminder(_)
        | NotifEvent::CalendarEventReminder(_) => Some(InboxActor::Macro),
        NotifEvent::TaskAssigned(task) => Some(InboxActor::User(task.assigned_by.clone())),
        _ => notification.sender_id.clone().map(InboxActor::User),
    }
}

/// What the viewer can do from a row in `slot` showing `shown`, newest
/// first.
fn actions(slot: &Slot, shown: &[FeedNotification]) -> Vec<InboxRowAction> {
    let action = |kind, target: Option<&Uuid>, url: Option<String>| InboxRowAction {
        kind,
        target_id: target.map(Uuid::to_string),
        url,
    };
    match slot {
        Slot::AccessRequested(request) => vec![
            action(InboxRowActionKind::Approve, Some(request), None),
            action(InboxRowActionKind::Deny, Some(request), None),
        ],
        Slot::CalendarJoinRequest(request) => vec![
            action(InboxRowActionKind::Accept, Some(request), None),
            action(InboxRowActionKind::Decline, Some(request), None),
        ],
        Slot::AccessGranted(_) => vec![action(InboxRowActionKind::Open, None, None)],
        Slot::Agent
            if matches!(
                shown[0].notification_metadata,
                NotifEvent::AgentSessionWaitingForInput(_)
            ) =>
        {
            vec![action(InboxRowActionKind::Answer, None, None)]
        }
        Slot::PullRequest => shown
            .iter()
            .find_map(|notification| match &notification.notification_metadata {
                NotifEvent::GithubReviewRequested(requested) => Some(action(
                    InboxRowActionKind::Review,
                    None,
                    Some(requested.common.url.clone()),
                )),
                _ => None,
            })
            .into_iter()
            .collect(),
        _ => Vec::new(),
    }
}

/// The rows of the group filed under `group`, newest first.
///
/// `notifications` are the viewer's pending notifications filed under the
/// group's entity. `mail` is its mailbox state when it is an email thread,
/// whose row follows the mailbox's read state.
pub fn rows(
    group: &FeedKey,
    notifications: &[FeedNotification],
    mail: Option<MailFacts>,
    viewer: &MacroUserIdStr<'static>,
    now: DateTime<Utc>,
) -> Vec<InboxRow> {
    let channel = group.entity().entity_type == EntityType::Channel;
    let placed: Vec<Placed> = if channel {
        place_channel(notifications, viewer)
    } else {
        let mut placed =
            place_discussions(notifications.iter().filter_map(discussion_view).collect());
        placed.extend(notifications.iter().filter_map(|notification| {
            place_event(notification, now).map(|(slot, shown)| Placed {
                notification: notification.clone(),
                slot,
                shown,
                root_mention: false,
            })
        }));
        placed
    };

    let mut order: Vec<Slot> = Vec::new();
    let mut by_slot: HashMap<Slot, Vec<Placed>> = HashMap::new();
    for placed in placed {
        by_slot
            .entry(placed.slot.clone())
            .or_insert_with(|| {
                order.push(placed.slot.clone());
                Vec::new()
            })
            .push(placed);
    }

    let mut rows: Vec<InboxRow> = order
        .into_iter()
        .filter_map(|slot| {
            let group_slot = by_slot
                .remove(&slot)
                .expect("every ordered slot has a group");
            let root_mention = group_slot.iter().any(|placed| placed.root_mention);
            let (shown, hidden): (Vec<Placed>, Vec<Placed>) =
                group_slot.into_iter().partition(|placed| placed.shown);
            if shown.is_empty() {
                return None;
            }
            let mut notifications: Vec<FeedNotification> = shown
                .into_iter()
                .map(|placed| placed.notification)
                .collect();
            let mut hidden: Vec<FeedNotification> = hidden
                .into_iter()
                .map(|placed| placed.notification)
                .collect();
            sort_newest_first(&mut notifications);
            sort_newest_first(&mut hidden);
            let unseen = match (&slot, mail) {
                // Mail is unread while it has unread messages; a reminder
                // that has not been seen keeps it unread too.
                (Slot::Email, Some(mail)) => {
                    !mail.is_read
                        || notifications.iter().any(|n| {
                            matches!(n.notification_metadata, NotifEvent::Reminder(_))
                                && counts_as_unseen(n)
                        })
                }
                _ => notifications.iter().any(|n| counts_as_unseen(n)),
            };
            Some(InboxRow {
                row_type: row_type(&slot, channel, root_mention),
                actor: actor(&notifications[0]),
                actions: actions(&slot, &notifications),
                thread_id: match &slot {
                    Slot::Thread(root) => Some(root.clone()),
                    _ => None,
                },
                id: InboxRowId {
                    group: group.clone(),
                    slot: slot.id(),
                },
                notifications,
                hidden,
                unseen,
            })
        })
        .collect();
    rows.sort_by(|a, b| {
        let (a, b) = (a.latest(), b.latest());
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.notification_id.cmp(&a.notification_id))
    });
    rows
}
