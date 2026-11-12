//! Authorized channel catch-up reads, with the same parent capability as timelines.

use std::collections::HashSet;

use activity::domain::timeline::ActivityTimelineIdsQuery;

use super::*;
use crate::domain::changes::{
    ChannelChangeKind, ChannelChanges, ChannelMessageChange, MAX_CHANNEL_CHANGE_ROWS,
    requires_reset,
};

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    /// Read the current channel counter before a timeline or thread snapshot.
    #[tracing::instrument(name = "messages.channel_seq", skip_all, fields(%channel_id), err)]
    pub async fn channel_seq(&self, channel_id: Uuid) -> Result<i64, MessageError> {
        self.repo.channel_seq(channel_id).await
    }

    /// Read current states for a bounded, gap-free page of committed changes.
    #[tracing::instrument(name = "messages.channel_changes", skip_all, fields(%channel_id, after, seq = tracing::field::Empty, reset_required = tracing::field::Empty, has_more = tracing::field::Empty), err)]
    pub async fn channel_changes(
        &self,
        access: EntityAccessReceipt<MessageView>,
        channel_id: Uuid,
        after: i64,
    ) -> Result<ChannelChanges, MessageError> {
        if after < 0 {
            return Err(MessageError::Invalid("channel sequence cannot be negative"));
        }
        let parent = parent_from_receipt(&access)?;
        if parent != MessageParent::Channel(channel_id) {
            return Err(MessageError::Forbidden);
        }
        self.ensure_parent(&parent).await?;
        let log = self.repo.channel_change_log(channel_id, after).await?;
        if requires_reset(&log, after) {
            tracing::Span::current().record("seq", log.seq);
            tracing::Span::current().record("reset_required", true);
            tracing::Span::current().record("has_more", false);
            return Ok(ChannelChanges {
                reset_required: true,
                seq: log.seq,
                ..Default::default()
            });
        }

        let mut message_ids = Vec::new();
        let mut activity_ids = Vec::new();
        let mut seen_messages = HashSet::new();
        let mut seen_activities = HashSet::new();
        let mut seq = after;
        for change in log.changes.iter().take(MAX_CHANNEL_CHANGE_ROWS) {
            match change.kind {
                ChannelChangeKind::Message(id) if seen_messages.insert(id) => message_ids.push(id),
                ChannelChangeKind::Activity(id) if seen_activities.insert(id) => {
                    activity_ids.push(id)
                }
                _ => {}
            }
            seq = change.seq;
        }
        let mut messages = self
            .repo
            .load_channel_message_changes(channel_id, &message_ids)
            .await?;
        let activities = if activity_ids.is_empty() {
            Vec::new()
        } else {
            let source = timeline_activity(&parent)
                .ok_or(MessageError::Invalid("channel has no activity timeline"))?;
            let activity = self.activity.as_ref().ok_or_else(|| {
                MessageError::Repository(rootcause::report!(
                    "activity timeline reader is not configured"
                ))
            })?;
            activity
                .read_ids(ActivityTimelineIdsQuery {
                    entity_type: source.entity_type,
                    entity_id: parent.entity_id(),
                    selection: source.selection,
                    ids: activity_ids.clone(),
                })
                .await
                .map_err(|error| {
                    MessageError::Repository(rootcause::report!(
                        "activity timeline read failed: {error}"
                    ))
                })?
        };
        let call_ids: Vec<_> = messages
            .iter()
            .filter_map(|change| match change {
                ChannelMessageChange::Root { message, .. }
                    if message.message.kind == MessageKind::CallRoot =>
                {
                    Some(message.message.id)
                }
                _ => None,
            })
            .collect();
        if !call_ids.is_empty() {
            let calls = self.repo.call_entry_statuses(&call_ids).await?;
            for change in &mut messages {
                if let ChannelMessageChange::Root { message, call } = change
                    && message.message.kind == MessageKind::CallRoot
                {
                    *call = Some(
                        calls
                            .get(&message.message.id)
                            .copied()
                            .unwrap_or(CallEntryStatus::RecordDeleted),
                    );
                }
            }
        }
        let found_messages: HashSet<_> = messages.iter().map(ChannelMessageChange::id).collect();
        let found_activities: HashSet<_> = activities.iter().map(|activity| activity.id).collect();
        let removed_ids = message_ids
            .into_iter()
            .filter(|id| !found_messages.contains(id))
            .chain(
                activity_ids
                    .into_iter()
                    .filter(|id| !found_activities.contains(id)),
            )
            .collect();
        let has_more = seq < log.seq;
        tracing::Span::current().record("seq", seq);
        tracing::Span::current().record("reset_required", false);
        tracing::Span::current().record("has_more", has_more);
        Ok(ChannelChanges {
            reset_required: false,
            seq,
            has_more,
            messages,
            activities,
            removed_ids,
        })
    }
}
