//! Counting the inbox's unread rows without paging it.
//!
//! The feed layer names the groups that may hold an unread row: entities
//! with an unseen notification, and email threads with unread mail. Each is
//! then read as the inbox reads it (authorized, filtered, cut into rows), so
//! a count never includes a row the inbox would not list.

use std::collections::{HashMap, VecDeque};

use super::*;

/// Groups that may hold an unread row, looked up per entity type. More than
/// enough to reach [`UNREAD_ROWS_COUNTED`] unless most can no longer be
/// opened.
const UNREAD_KEYS_PER_TYPE: u16 = 500;

/// Groups of one entity type read per round, between checks of whether that
/// type already holds [`UNREAD_ROWS_COUNTED`] unread rows.
const UNREAD_ROUND: usize = 100;

impl<S, N, M, G, A, U> NotificationInboxServiceImpl<S, N, M, G, A, U>
where
    S: CandidateSource,
    N: FeedNotifications,
    M: FeedMail,
    G: FeedSignals,
    A: BulkActionStore,
    U: ClearUpdates,
{
    /// The kind of each unread row of the current groups among `keys`.
    /// Groups that are gone, or hold no unread row, are absent.
    async fn unread_among(
        &self,
        viewer: &FeedViewer,
        keys: &[FeedKey],
    ) -> Result<HashMap<FeedKey, Vec<InboxRowType>>, Report> {
        Ok(self
            .current(viewer, keys, CandidateRead::Replica)
            .await?
            .into_iter()
            .filter_map(|(key, group)| {
                let unread: Vec<InboxRowType> = group
                    .rows
                    .iter()
                    .filter(|row| row.unseen)
                    .map(|row| row.row_type)
                    .collect();
                (!unread.is_empty()).then_some((key, unread))
            })
            .collect())
    }

    /// Count every unread row, a round of groups per entity type at a time,
    /// until each type runs out of groups or holds enough unread rows.
    pub(super) async fn count_unread(&self, viewer: &FeedViewer) -> Result<UnreadRows, Report> {
        let keys = self
            .reader
            .unread_keys(
                viewer,
                policy::CANDIDATE_TYPES.to_vec(),
                UNREAD_KEYS_PER_TYPE,
            )
            .await?;
        let mut waiting: HashMap<EntityType, VecDeque<FeedKey>> = HashMap::new();
        for key in unique(keys) {
            waiting
                .entry(key.entity().entity_type)
                .or_default()
                .push_back(key);
        }

        let mut unread = UnreadRows::default();
        loop {
            let mut round = Vec::new();
            for (entity_type, keys) in &mut waiting {
                if unread.rows_under(*entity_type) >= UNREAD_ROWS_COUNTED {
                    continue;
                }
                let take = keys.len().min(UNREAD_ROUND);
                round.extend(keys.drain(..take));
            }
            if round.is_empty() {
                break;
            }
            unread
                .groups
                .extend(self.unread_among(viewer, &round).await?);
        }
        unread.more = waiting
            .into_iter()
            .filter(|(_, keys)| !keys.is_empty())
            .map(|(entity_type, _)| entity_type)
            .collect();
        Ok(unread)
    }

    /// Recount `groups` within `unread`.
    pub(super) async fn recount_unread(
        &self,
        viewer: &FeedViewer,
        mut unread: UnreadRows,
        groups: Vec<FeedKey>,
    ) -> Result<UnreadRows, Report> {
        let groups = unique(groups);
        if groups.is_empty() {
            return Ok(unread);
        }
        let mut current = self.unread_among(viewer, &groups).await?;
        for group in groups {
            match current.remove(&group) {
                Some(rows) => unread.groups.insert(group, rows),
                None => unread.groups.remove(&group),
            };
        }

        // An entity type that stopped at enough unread rows left groups
        // unread; once it falls back under, those are owed a read.
        let owed = unread
            .more
            .iter()
            .any(|entity_type| unread.rows_under(*entity_type) < UNREAD_ROWS_COUNTED);
        if owed {
            return self.count_unread(viewer).await;
        }
        Ok(unread)
    }
}
