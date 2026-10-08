//! Merge independently owned, bounded sources under one chronological cursor.
use super::*;
use activity::domain::timeline::{ActivityTimelineQuery, TimelineActivity};

#[cfg(test)]
mod test;

fn page(
    mut entries: Vec<MessageTimelineEntry>,
    more_older: bool,
    more_newer: bool,
) -> MessageTimelinePage {
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.position()));
    let next_cursor = more_older
        .then(|| entries.last().map(MessageTimelineEntry::cursor))
        .flatten();
    let previous_cursor = more_newer
        .then(|| entries.first().map(MessageTimelineEntry::cursor))
        .flatten();
    MessageTimelinePage {
        entries,
        next_cursor,
        previous_cursor,
    }
}

fn merge(
    messages: MessagePage,
    activities: Vec<TimelineActivity>,
    query: &MessageTimelineQuery,
) -> MessageTimelinePage {
    let limit = usize::from(query.limit.unwrap_or(50));
    let newer = matches!(query.direction, MessageDirection::Newer);
    let source_has_more = if newer {
        messages.previous_cursor.is_some()
    } else {
        messages.next_cursor.is_some()
    };
    let mut merged = MessageTimelinePage::from(messages).entries;
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
        source: TimelineActivitySource,
        mut query: MessageTimelineQuery,
    ) -> Result<MessageTimelinePage, MessageError> {
        let Some(anchor) = query.around.take() else {
            return self.activity_side(parent, source, query).await;
        };
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
            .await?
            .items
            .into_iter()
            .next()
            .ok_or(MessageError::NotFound)?;
        query.cursor = Some(MessageCursor {
            created_at: anchor.message.created_at,
            id: anchor.message.id,
        });
        // Read each side's share of the window rather than a full page per
        // side; only a side that runs short makes the other read further.
        let remaining = query.limit.unwrap_or(50) - 1;
        let older_share = remaining / 2;
        let newer_share = remaining - older_share;
        let side = |direction, share: u16| MessageTimelineQuery {
            direction,
            // A zero share still reads one entry to learn whether that side continues.
            limit: Some(share.max(1)),
            ..query.clone()
        };
        let (mut before, mut after) = futures::try_join!(
            self.activity_side(parent, source, side(MessageDirection::Older, older_share)),
            self.activity_side(parent, source, side(MessageDirection::Newer, newer_share))
        )?;
        if after.entries.len() < usize::from(newer_share) {
            let want = usize::from(remaining) - after.entries.len();
            self.extend_side(
                parent,
                source,
                &query,
                &mut before,
                MessageDirection::Older,
                want,
            )
            .await?;
        } else if before.entries.len() < usize::from(older_share) {
            let want = usize::from(remaining) - before.entries.len();
            self.extend_side(
                parent,
                source,
                &query,
                &mut after,
                MessageDirection::Newer,
                want,
            )
            .await?;
        }
        let before_more = before.next_cursor.is_some();
        let after_more = after.previous_cursor.is_some();
        let mut before = before.entries;
        let mut after = after.entries;
        before.sort_by_key(|entry| std::cmp::Reverse(entry.position()));
        after.sort_by_key(MessageTimelineEntry::position);
        let remaining = usize::from(remaining);
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
        Ok(page(before, more_older, more_newer))
    }

    /// Continue one side of a centered window from where it stopped, until it
    /// holds `want` entries or that side of the timeline runs out.
    async fn extend_side(
        &self,
        parent: &MessageParent,
        source: TimelineActivitySource,
        query: &MessageTimelineQuery,
        side: &mut MessageTimelinePage,
        direction: MessageDirection,
        want: usize,
    ) -> Result<(), MessageError> {
        let older = matches!(direction, MessageDirection::Older);
        let cursor = if older {
            side.next_cursor.clone()
        } else {
            side.previous_cursor.clone()
        };
        let missing = want.saturating_sub(side.entries.len());
        let (Some(cursor), Ok(missing @ 1..)) = (cursor, u16::try_from(missing)) else {
            return Ok(());
        };
        let rest = self
            .activity_side(
                parent,
                source,
                MessageTimelineQuery {
                    direction,
                    cursor: Some(cursor),
                    limit: Some(missing),
                    ..query.clone()
                },
            )
            .await?;
        side.entries.extend(rest.entries);
        if older {
            side.next_cursor = rest.next_cursor;
        } else {
            side.previous_cursor = rest.previous_cursor;
        }
        Ok(())
    }

    async fn activity_side(
        &self,
        parent: &MessageParent,
        source: TimelineActivitySource,
        query: MessageTimelineQuery,
    ) -> Result<MessageTimelinePage, MessageError> {
        let activity = self
            .activity
            .as_ref()
            .ok_or(MessageError::Invalid("activity timeline is unavailable"))?;
        let activity_query = ActivityTimelineQuery {
            entity_type: source.entity_type,
            entity_id: parent.entity_id(),
            selection: source.selection,
            cursor: query.cursor.as_ref().map(|c| (c.created_at, c.id)),
            newer: matches!(query.direction, MessageDirection::Newer),
            limit: query.limit.unwrap_or(50) + 1,
        };
        let (messages, activities) =
            futures::try_join!(self.repo.timeline(parent, query.clone()), async {
                activity.read(activity_query).await.map_err(|error| {
                    MessageError::Repository(rootcause::report!(
                        "activity timeline read failed: {error}"
                    ))
                })
            })?;
        Ok(merge(messages, activities, &query))
    }
}
