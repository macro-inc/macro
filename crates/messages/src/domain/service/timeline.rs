//! Merge independently owned, bounded sources under one chronological cursor.
use super::*;
use activity::domain::timeline::{ActivityTimelineQuery, TimelineActivity};

#[cfg(test)]
mod test;

fn page(mut entries: Vec<MessageTimelineEntry>, more_older: bool, more_newer: bool) -> MessagePage {
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.position()));
    let next_cursor = more_older
        .then(|| entries.last().map(MessageTimelineEntry::cursor))
        .flatten();
    let previous_cursor = more_newer
        .then(|| entries.first().map(MessageTimelineEntry::cursor))
        .flatten();
    MessagePage {
        entries,
        next_cursor,
        previous_cursor,
    }
}

fn merge(
    messages: MessageRootPage,
    activities: Vec<TimelineActivity>,
    query: &MessageTimelineQuery,
) -> MessagePage {
    let limit = usize::from(query.limit.unwrap_or(50));
    let newer = matches!(query.direction, MessageDirection::Newer);
    let source_has_more = if newer {
        messages.previous_cursor.is_some()
    } else {
        messages.next_cursor.is_some()
    };
    let mut merged = MessagePage::from(messages).entries;
    merged.extend(
        activities
            .into_iter()
            .map(|activity| MessageTimelineEntry::Activity { activity }),
    );
    merged.sort_by_key(MessageTimelineEntry::position);
    if !newer {
        merged.reverse();
    }
    let more = source_has_more || merged.len() > limit;
    merged.truncate(limit);
    let opposite = query.cursor.is_some();
    page(
        merged,
        if newer { opposite } else { more },
        if newer { more } else { opposite },
    )
}

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    pub(super) async fn activity_timeline(
        &self,
        parent: &MessageParent,
        mut query: MessageTimelineQuery,
    ) -> Result<MessagePage, MessageError> {
        if let Some(anchor) = query.around.take() {
            // The repository resolves replies to their root and validates thread
            // visibility. Keep the anchor even for a one-entry window.
            let anchor = self
                .repo
                .timeline(
                    parent,
                    MessageTimelineQuery {
                        around: Some(anchor),
                        limit: Some(1),
                        ..Default::default()
                    },
                )
                .await?;
            let anchor = anchor
                .items
                .into_iter()
                .next()
                .ok_or(MessageError::NotFound)?;
            let cursor = MessageCursor {
                created_at: anchor.message.created_at,
                id: anchor.message.id,
            };
            query.cursor = Some(cursor);
            query.direction = MessageDirection::Older;
            let before = self.activity_side(parent, query.clone()).await?;
            query.direction = MessageDirection::Newer;
            let after = self.activity_side(parent, query.clone()).await?;
            let before_more = before.next_cursor.is_some();
            let after_more = after.previous_cursor.is_some();
            let mut before = before.entries;
            let mut after = after.entries;
            before.sort_by_key(|entry| std::cmp::Reverse(entry.position()));
            after.sort_by_key(MessageTimelineEntry::position);
            let remaining = usize::from(query.limit.unwrap_or(50)) - 1;
            let take_before = before.len().min(remaining / 2);
            let take_after = after.len().min(remaining - take_before);
            let take_before = before.len().min(remaining - take_after);
            let more_older = before_more || before.len() > take_before;
            let more_newer = after_more || after.len() > take_after;
            before.truncate(take_before);
            after.truncate(take_after);
            before.push(MessageTimelineEntry::Message {
                message: Box::new(anchor),
            });
            before.extend(after);
            return Ok(page(before, more_older, more_newer));
        }
        self.activity_side(parent, query).await
    }

    async fn activity_side(
        &self,
        parent: &MessageParent,
        query: MessageTimelineQuery,
    ) -> Result<MessagePage, MessageError> {
        let activity = self
            .activity
            .as_ref()
            .ok_or(MessageError::Invalid("activity timeline is unavailable"))?;
        let activity_query = ActivityTimelineQuery {
            entity_type: activity::EntityType::Channel,
            entity_id: parent.entity_id(),
            actions: CHANNEL_TIMELINE_ACTIONS,
            cursor: query.cursor.as_ref().map(|c| (c.created_at, c.id)),
            newer: matches!(query.direction, MessageDirection::Newer),
            limit: query.limit.unwrap_or(50) + 1,
        };
        let messages = self.repo.timeline(parent, query.clone()).await?;
        let activities = activity.read(activity_query).await.map_err(|error| {
            MessageError::Repository(rootcause::report!("activity timeline read failed: {error}"))
        })?;
        Ok(merge(messages, activities, &query))
    }
}
