//! Item scoping and notification stacking.
//!
//! Scoping decides which of a candidate's notifications belong to its item.
//! A channel's notifications split between the channel item and one item per
//! thread: mentions, reactions, replies and document mentions belong to the
//! thread rooted at the message they name, matching how notifications are
//! keyed for the feed; a root message joins its thread once the thread has
//! replies or thread mentions. Every other item owns all of its entity's
//! notifications.
//!
//! Stacking then groups an item's notifications for presentation: one stack
//! per conversation thread, mentions shadowing the plain message they were
//! sent in, and every other event on its own. Shadowed notifications stay in
//! the item's scope so completing the item acknowledges them too.

use std::collections::{HashMap, HashSet};

use model_entity::EntityType;
use model_notifications::NotifEvent;
use notification::domain::models::UserNotificationRow;

use super::models::{FeedNotification, WorkFeedStack, WorkFeedStackKind};

#[cfg(test)]
mod test;

/// The channel thread root a channel notification is attributed to, if any:
/// the thread for replies, and the named message's thread (or the message
/// itself, which becomes the root) for mentions, reactions and document
/// mentions. Plain sends and channel-level events have none.
pub fn channel_thread_root(notification: &UserNotificationRow<NotifEvent>) -> Option<&str> {
    if notification.entity.entity_type != EntityType::Channel {
        return None;
    }
    match &notification.notification_metadata {
        NotifEvent::ChannelMessageReply(reply) => Some(reply.thread_id.as_str()),
        NotifEvent::ChannelMention(mention) => {
            Some(mention.thread_id.as_deref().unwrap_or(&mention.message_id))
        }
        NotifEvent::ChannelMessageReaction(reaction) => Some(
            reaction
                .thread_id
                .as_deref()
                .unwrap_or(&reaction.message_id),
        ),
        NotifEvent::DocumentMention(mention) => Some(
            mention
                .channel
                .thread_id
                .as_deref()
                .unwrap_or(&mention.channel.message_id),
        ),
        _ => None,
    }
}

/// Threads in a channel that have replies or thread mentions; their root
/// messages belong to the thread rather than to the channel.
fn active_threads(notifications: &[FeedNotification]) -> HashSet<&str> {
    notifications
        .iter()
        .filter_map(|notification| match &notification.notification_metadata {
            NotifEvent::ChannelMessageReply(reply) => Some(reply.thread_id.as_str()),
            NotifEvent::ChannelMention(mention) => mention.thread_id.as_deref(),
            _ => None,
        })
        .collect()
}

/// The root message a plain channel send is about, when it is one.
fn root_send_message(notification: &FeedNotification) -> Option<&str> {
    match &notification.notification_metadata {
        NotifEvent::ChannelMessageSend(send) => Some(send.message_id.as_str()),
        _ => None,
    }
}

/// The channel item's share of its channel's notifications.
pub fn scope_channel(notifications: &[FeedNotification]) -> Vec<FeedNotification> {
    let active = active_threads(notifications);
    notifications
        .iter()
        .filter(|notification| {
            channel_thread_root(notification).is_none()
                && root_send_message(notification).is_none_or(|message| !active.contains(message))
        })
        .cloned()
        .collect()
}

/// One thread item's share of its channel's notifications.
pub fn scope_channel_thread(
    notifications: &[FeedNotification],
    root: &str,
) -> Vec<FeedNotification> {
    notifications
        .iter()
        .filter(|notification| {
            channel_thread_root(notification) == Some(root)
                || root_send_message(notification) == Some(root)
        })
        .cloned()
        .collect()
}

/// Sort notifications newest first, breaking ties by id for a stable order.
pub fn sort_newest_first(notifications: &mut [FeedNotification]) {
    notifications.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.notification_id.cmp(&a.notification_id))
    });
}

/// A message-shaped notification's role in its conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    /// A new root message or comment.
    Send,
    /// A reply in a thread.
    Reply,
    /// A mention.
    Mention,
}

/// A channel message or document comment notification, normalized.
#[derive(Debug, Clone)]
struct View {
    notification: FeedNotification,
    role: Role,
    message_id: String,
    thread_id: Option<String>,
}

fn channel_view(notification: &FeedNotification) -> Option<View> {
    let (role, message_id, thread_id) = match &notification.notification_metadata {
        NotifEvent::ChannelMessageSend(send) => (Role::Send, send.message_id.clone(), None),
        NotifEvent::ChannelMessageReply(reply) => (
            Role::Reply,
            reply.message_id.clone(),
            Some(reply.thread_id.clone()),
        ),
        NotifEvent::ChannelMention(mention) => (
            Role::Mention,
            mention.message_id.clone(),
            mention.thread_id.clone(),
        ),
        _ => return None,
    };
    Some(View {
        notification: notification.clone(),
        role,
        message_id,
        thread_id,
    })
}

fn comment_view(notification: &FeedNotification) -> Option<View> {
    let (role, message_id, thread_id) = match &notification.notification_metadata {
        // A root comment shares its thread's id; owner notifications for
        // replies use the generic comment event.
        NotifEvent::CommentedOnDocument(comment) => {
            let comment_id = comment.comment_id.to_string();
            let thread_id = comment.thread_id.to_string();
            let role = if comment_id == thread_id {
                Role::Send
            } else {
                Role::Reply
            };
            (role, comment_id, thread_id)
        }
        NotifEvent::RepliedToDocumentCommentThread(reply) => (
            Role::Reply,
            reply.comment_id.to_string(),
            reply.thread_id.to_string(),
        ),
        NotifEvent::MentionedInDocumentComment(mention) => (
            Role::Mention,
            mention.comment_id.to_string(),
            mention.thread_id.to_string(),
        ),
        _ => return None,
    };
    Some(View {
        notification: notification.clone(),
        role,
        message_id,
        thread_id: Some(thread_id),
    })
}

/// The discussion thread a project, company or contact notification is in.
fn discussion_thread(notification: &FeedNotification) -> Option<String> {
    match &notification.notification_metadata {
        NotifEvent::InitiativeDiscussion(discussion) => Some(format!(
            "initiative_discussion:{}:{}",
            notification.entity.entity_id, discussion.thread_id
        )),
        NotifEvent::CrmDiscussion(discussion) => Some(format!(
            "crm_discussion:{}:{}",
            notification.entity.entity_id, discussion.thread_id
        )),
        _ => None,
    }
}

fn is_channel_event(notification: &FeedNotification) -> bool {
    matches!(
        notification.notification_metadata,
        NotifEvent::ChannelMention(_)
            | NotifEvent::ChannelMessageSend(_)
            | NotifEvent::ChannelMessageReaction(_)
            | NotifEvent::ChannelMessageReply(_)
            | NotifEvent::DocumentMention(_)
    )
}

fn is_comment_event(notification: &FeedNotification) -> bool {
    matches!(
        notification.notification_metadata,
        NotifEvent::CommentedOnDocument(_)
            | NotifEvent::RepliedToDocumentCommentThread(_)
            | NotifEvent::MentionedInDocumentComment(_)
    )
}

fn make_stack(
    kind: WorkFeedStackKind,
    thread_id: Option<String>,
    mut notifications: Vec<FeedNotification>,
) -> Option<WorkFeedStack> {
    if notifications.is_empty() {
        return None;
    }
    sort_newest_first(&mut notifications);
    Some(WorkFeedStack {
        kind,
        thread_id,
        notifications,
    })
}

/// Group values by key, keeping first-seen key order so output is stable.
fn group_by<T>(items: impl IntoIterator<Item = (String, T)>) -> Vec<(String, Vec<T>)> {
    let mut order = Vec::new();
    let mut groups: HashMap<String, Vec<T>> = HashMap::new();
    for (key, item) in items {
        groups
            .entry(key.clone())
            .or_insert_with(|| {
                order.push(key);
                Vec::new()
            })
            .push(item);
    }
    order
        .into_iter()
        .map(|key| {
            let items = groups.remove(&key).expect("every ordered key has a group");
            (key, items)
        })
        .collect()
}

/// Channel stacks: root mentions without a thread stand alone, new root
/// messages share one stack, and each thread gathers its replies, thread
/// mentions and absorbed root. A mention shadows the send or reply for the
/// same message.
fn stack_channel_views(views: Vec<View>) -> Vec<WorkFeedStack> {
    let mentioned: HashSet<String> = views
        .iter()
        .filter(|view| view.role == Role::Mention)
        .map(|view| view.message_id.clone())
        .collect();
    let active: HashSet<String> = views
        .iter()
        .filter_map(|view| match view.role {
            Role::Reply => view.thread_id.clone(),
            Role::Mention => view.thread_id.clone(),
            Role::Send => None,
        })
        .collect();

    let mut orphan_mentions = Vec::new();
    let mut new_sends = Vec::new();
    let mut threaded = Vec::new();
    for view in views {
        let shadowed = view.role != Role::Mention && mentioned.contains(&view.message_id);
        if shadowed {
            continue;
        }
        match (view.role, view.thread_id.as_deref()) {
            (Role::Reply, Some(thread)) => threaded.push((thread.to_string(), view.notification)),
            (Role::Reply, None) => {}
            (Role::Mention, Some(thread)) => threaded.push((thread.to_string(), view.notification)),
            (Role::Mention, None) if active.contains(&view.message_id) => {
                threaded.push((view.message_id, view.notification))
            }
            (Role::Mention, None) => orphan_mentions.push(view),
            (Role::Send, _) if active.contains(&view.message_id) => {
                threaded.push((view.message_id, view.notification))
            }
            (Role::Send, _) => new_sends.push(view.notification),
        }
    }

    let mut stacks: Vec<WorkFeedStack> = orphan_mentions
        .into_iter()
        .filter_map(|view| {
            make_stack(
                WorkFeedStackKind::ChannelMention,
                Some(view.message_id),
                vec![view.notification],
            )
        })
        .collect();
    stacks.extend(make_stack(
        WorkFeedStackKind::ChannelMessages,
        None,
        new_sends,
    ));
    stacks.extend(
        group_by(threaded)
            .into_iter()
            .filter(|(thread, _)| !thread.is_empty())
            .filter_map(|(thread, notifications)| {
                make_stack(
                    WorkFeedStackKind::ChannelThread,
                    Some(thread),
                    notifications,
                )
            }),
    );
    stacks
}

/// Document comment stacks: a thread with several events or any reply is one
/// stack, a lone mention stands alone, and lone root comments share a stack.
/// A mention shadows the comment it was made in.
fn stack_comment_views(views: Vec<View>) -> Vec<WorkFeedStack> {
    let mentioned: HashSet<String> = views
        .iter()
        .filter(|view| view.role == Role::Mention)
        .map(|view| view.message_id.clone())
        .collect();
    let visible = views
        .into_iter()
        .filter(|view| view.role == Role::Mention || !mentioned.contains(&view.message_id))
        .map(|view| (view.thread_id.clone().unwrap_or_default(), view));

    let mut stacks = Vec::new();
    let mut standalone_sends = Vec::new();
    for (thread, group) in group_by(visible) {
        if thread.is_empty() {
            continue;
        }
        let is_thread = group.len() >= 2 || group.iter().any(|view| view.role == Role::Reply);
        if is_thread {
            stacks.extend(make_stack(
                WorkFeedStackKind::CommentThread,
                Some(thread),
                group.into_iter().map(|view| view.notification).collect(),
            ));
            continue;
        }
        let view = group.into_iter().next().expect("groups are non-empty");
        match view.role {
            Role::Send => standalone_sends.push(view.notification),
            Role::Mention => stacks.extend(make_stack(
                WorkFeedStackKind::CommentMention,
                Some(thread),
                vec![view.notification],
            )),
            Role::Reply => {}
        }
    }
    stacks.extend(make_stack(
        WorkFeedStackKind::Comments,
        None,
        standalone_sends,
    ));
    stacks
}

/// Group an item's notifications into stacks, newest stack first.
pub fn stack(notifications: &[FeedNotification]) -> Vec<WorkFeedStack> {
    let mut stacks = Vec::new();

    let reactions: Vec<FeedNotification> = notifications
        .iter()
        .filter(|n| {
            matches!(
                n.notification_metadata,
                NotifEvent::ChannelMessageReaction(_)
            )
        })
        .cloned()
        .collect();
    let channel_views: Vec<View> = notifications.iter().filter_map(channel_view).collect();
    let comment_views: Vec<View> = notifications.iter().filter_map(comment_view).collect();
    let document_mentions: Vec<FeedNotification> = notifications
        .iter()
        .filter(|n| matches!(n.notification_metadata, NotifEvent::DocumentMention(_)))
        .cloned()
        .collect();
    let discussions = notifications
        .iter()
        .filter_map(|n| discussion_thread(n).map(|thread| (thread, n.clone())));

    for (_, group) in group_by(discussions) {
        let thread_id = group.first().and_then(|n| match &n.notification_metadata {
            NotifEvent::InitiativeDiscussion(d) => Some(d.thread_id.to_string()),
            NotifEvent::CrmDiscussion(d) => Some(d.thread_id.to_string()),
            _ => None,
        });
        stacks.extend(make_stack(WorkFeedStackKind::Discussion, thread_id, group));
    }
    stacks.extend(stack_channel_views(channel_views));
    stacks.extend(make_stack(
        WorkFeedStackKind::ChannelReactions,
        None,
        reactions,
    ));
    stacks.extend(stack_comment_views(comment_views));
    stacks.extend(make_stack(
        WorkFeedStackKind::DocumentMentions,
        None,
        document_mentions,
    ));
    stacks.extend(
        notifications
            .iter()
            .filter(|n| {
                !is_channel_event(n) && !is_comment_event(n) && discussion_thread(n).is_none()
            })
            .filter_map(|n| make_stack(WorkFeedStackKind::Event, None, vec![n.clone()])),
    );

    stacks.sort_by(|a, b| {
        let (a, b) = (a.latest(), b.latest());
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.notification_id.cmp(&a.notification_id))
    });
    stacks
}
