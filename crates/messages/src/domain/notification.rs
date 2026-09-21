use super::models::MessageParent;
use std::collections::{BTreeMap, HashSet};

#[cfg(test)]
mod test;

/// Semantic notification reason, independent of message storage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommentNotificationReason {
    /// Explicit user mention.
    Mention,
    /// Reply to a discussion the recipient contributed to.
    Reply,
    /// Comment on an assigned task.
    Assignee,
    /// Comment on an entity owned by the recipient.
    Owner,
}

/// Facts used to select a document discussion's notification audience.
#[derive(Debug, Default)]
pub struct CommentAudience {
    /// Explicitly mentioned users.
    pub mentioned: Vec<String>,
    /// Authors who have contributed to this thread.
    pub participants: Vec<String>,
    /// Task assignees; empty for non-task documents.
    pub assignees: Vec<String>,
    /// Document owners.
    pub owners: Vec<String>,
    /// Candidate users whose current parent view access was verified.
    pub authorized: HashSet<String>,
}

/// Select at most one reason per authorized user in mention/reply/assignee/owner order.
/// Channel messages use channel notification policy instead.
pub fn comment_recipients(
    parent: &MessageParent,
    actor: &str,
    is_reply: bool,
    audience: &CommentAudience,
) -> BTreeMap<String, CommentNotificationReason> {
    let mut recipients = BTreeMap::new();
    if !parent.is_discussion() {
        return recipients;
    }
    let groups = [
        (
            &audience.mentioned,
            CommentNotificationReason::Mention,
            true,
        ),
        (
            &audience.participants,
            CommentNotificationReason::Reply,
            is_reply,
        ),
        (
            &audience.assignees,
            CommentNotificationReason::Assignee,
            matches!(parent, MessageParent::Document(_)),
        ),
        (&audience.owners, CommentNotificationReason::Owner, true),
    ];
    for (users, reason, enabled) in groups {
        if !enabled {
            continue;
        }
        for user in users {
            if user != actor && audience.authorized.contains(user) {
                recipients.entry(user.clone()).or_insert(reason);
            }
        }
    }
    recipients
}
