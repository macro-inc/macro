//! Catching a channel reader up from its change sequence number.
use std::collections::HashSet;

use activity::domain::timeline::{ActivityTimelineLookup, TimelineActivity};
use entity_access::domain::models::EntityAccessReceipt;
use uuid::Uuid;

use super::{MessageService, MessageView, log_read_error, parent_from_receipt};
use crate::domain::{
    changes::{ChannelChangePlan, MAX_CHANGE_ROWS},
    models::{Message, MessageParent},
    ports::{
        MessageError, MessageEventPublisher, MessagePage, MessageRepository, MessageTimelineEntry,
        MessageTimelinePage, timeline_activity,
    },
};

/// What changed in a channel after a reader's sequence number, as the
/// current state of everything that changed.
#[derive(Debug, Clone, Default)]
pub struct ChannelChanges {
    /// The reader cannot be caught up: it drops what it holds and reads the
    /// channel again, starting from `seq`.
    pub reset: bool,
    /// The reader's sequence number once it applies this page.
    pub seq: i64,
    /// More changes follow `seq`; ask again from it.
    pub has_more: bool,
    /// Changed roots, as the timeline shows them now.
    pub entries: Vec<MessageTimelineEntry>,
    /// Changed replies that are still live.
    pub replies: Vec<Message>,
    /// Timeline facts (renames, joins) recorded since, oldest first.
    pub activities: Vec<TimelineActivity>,
    /// Changed messages the timeline no longer shows: deleted replies, and
    /// deleted roots without a live reply.
    pub removed: Vec<Uuid>,
}

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    /// The channel's latest change sequence number. A reader that takes it
    /// before reading a page can catch up from it afterwards and miss nothing.
    #[tracing::instrument(skip(self, access), fields(channel_id = %access.entity().entity_id), err(Debug))]
    pub async fn channel_seq(
        &self,
        access: &EntityAccessReceipt<MessageView>,
    ) -> Result<i64, MessageError> {
        let channel_id = channel_from_receipt(access)?;
        self.repo.channel_seq(channel_id).await
    }

    /// One root as the channel's timeline shows it now, with its thread
    /// summary and call; `None` when the timeline no longer shows it.
    #[tracing::instrument(skip(self, access), fields(channel_id = %access.entity().entity_id), err(Debug))]
    pub async fn channel_root(
        &self,
        access: &EntityAccessReceipt<MessageView>,
        root_id: Uuid,
    ) -> Result<Option<MessageTimelineEntry>, MessageError> {
        let parent = MessageParent::Channel(channel_from_receipt(access)?);
        let roots = self.repo.roots_by_ids(&parent, &[root_id]).await?;
        let page = self
            .with_call_entries(MessageTimelinePage::from(MessagePage {
                items: roots,
                next_cursor: None,
                previous_cursor: None,
            }))
            .await?;
        Ok(page.entries.into_iter().next())
    }

    /// Everything that changed in a channel after `since`, or a reset when
    /// the log can no longer say.
    #[tracing::instrument(skip(self, access), fields(channel_id = %access.entity().entity_id), err(Debug))]
    pub async fn channel_changes(
        &self,
        access: EntityAccessReceipt<MessageView>,
        since: i64,
    ) -> Result<ChannelChanges, MessageError> {
        async {
            let channel_id = channel_from_receipt(&access)?;
            let parent = MessageParent::Channel(channel_id);
            self.ensure_parent(&parent).await?;
            let log = self
                .repo
                .channel_change_log(channel_id, since, MAX_CHANGE_ROWS)
                .await?;
            let plan = ChannelChangePlan::new(since, &log, MAX_CHANGE_ROWS);
            let mut changes = ChannelChanges {
                reset: plan.reset,
                seq: plan.seq,
                has_more: plan.has_more,
                ..ChannelChanges::default()
            };
            if plan.reset {
                return Ok(changes);
            }
            changes.activities = self.changed_activities(&parent, plan.activities).await?;
            // A call's end changes what its root shows and logs only the
            // fact, so the fact reloads the root.
            let mut roots = plan.roots.clone();
            for call_root in changes.activities.iter().filter_map(ended_call) {
                if !roots.contains(&call_root) {
                    roots.push(call_root);
                }
            }
            let mut shown = HashSet::new();
            let roots = self.repo.roots_by_ids(&parent, &roots).await?;
            let page = self
                .with_call_entries(MessageTimelinePage::from(MessagePage {
                    items: roots,
                    next_cursor: None,
                    previous_cursor: None,
                }))
                .await?;
            shown.extend(page.entries.iter().map(|entry| entry.position().1));
            changes.entries = page.entries;
            changes.replies = self.repo.live_replies(&parent, &plan.replies).await?;
            shown.extend(changes.replies.iter().map(|reply| reply.id));
            changes.removed = plan
                .roots
                .iter()
                .chain(&plan.replies)
                .copied()
                .filter(|id| !shown.contains(id))
                .collect();
            Ok(changes)
        }
        .await
        .inspect_err(log_read_error)
    }
}

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    /// The logged facts the parent's timeline shows.
    async fn changed_activities(
        &self,
        parent: &MessageParent,
        ids: Vec<Uuid>,
    ) -> Result<Vec<TimelineActivity>, MessageError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        // Returning nothing here would move the reader past facts it never
        // received.
        let (Some(reader), Some(source)) = (&self.activity, timeline_activity(parent)) else {
            return Err(MessageError::Repository(rootcause::report!(
                "no activity reader is configured to read logged channel facts"
            )));
        };
        reader
            .read_by_ids(ActivityTimelineLookup {
                entity_type: source.entity_type,
                entity_id: parent.entity_id(),
                selection: source.selection,
                ids,
            })
            .await
            .map_err(|error| {
                MessageError::Repository(rootcause::report!(
                    "activity timeline read failed: {error}"
                ))
            })
    }
}

/// The call root a logged fact ended, when the fact is a call's end. The
/// root carries its call's id.
fn ended_call(fact: &TimelineActivity) -> Option<Uuid> {
    let ended: &'static str = activity::ActionTag::CallEnded.into();
    if fact.action != ended {
        return None;
    }
    let end: activity::domain::models::CallEnd =
        serde_json::from_value(fact.payload.clone()?).ok()?;
    end.call_id.parse().ok()
}

fn channel_from_receipt(access: &EntityAccessReceipt<MessageView>) -> Result<Uuid, MessageError> {
    match parent_from_receipt(access)? {
        MessageParent::Channel(channel_id) => Ok(channel_id),
        _ => Err(MessageError::Invalid(
            "only channels keep a change sequence",
        )),
    }
}
