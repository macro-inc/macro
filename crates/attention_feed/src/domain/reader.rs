//! Paging and recomputing a feed's candidates with their notifications.
//!
//! A feed builds its own entries from loaded candidates and may drop some (an
//! item with no reason left, a group with only hidden notifications). The
//! reader refills a page from later candidate pages until it holds the
//! requested number of entries or the feed is exhausted, in a bounded number
//! of rounds, and the cursor always points just past the last candidate the
//! feed was shown, kept or dropped, so nothing repeats or is skipped.

use std::collections::{HashMap, HashSet};

use model_entity::{Entity, EntityType};
use rootcause::Report;

use super::{
    models::{
        Candidate, CandidateKeying, CandidateRequest, FeedKey, FeedPage, FeedPosition, FeedViewer,
        Loaded, sort_newest_first,
    },
    ports::{CandidateSource, FeedNotifications},
};

#[cfg(test)]
mod test;

/// Most candidate pages one feed page reads while refilling after drops.
pub const MAX_FILL_ROUNDS: usize = 4;

/// Most candidate keys recomputed per source request.
const RECOMPUTE_CHUNK: usize = 200;

/// Reads candidates and the notifications their scopes draw from.
pub struct FeedReader<S, N> {
    source: S,
    notifications: N,
}

/// The entity whose notifications a candidate reads: a thread-scoped channel
/// thread shares its channel's; every other candidate reads its own.
fn notification_source<E>(
    candidate: &Candidate<E>,
    keying: CandidateKeying,
) -> Option<Entity<'static>> {
    match (keying, candidate.key.entity_type) {
        (CandidateKeying::ThreadScoped, EntityType::ChannelMessage) => candidate
            .facts
            .thread_channel
            .map(|channel| EntityType::Channel.with_entity_string(channel.to_string())),
        _ => Some(candidate.key.clone()),
    }
}

fn position<E>(candidate: &Candidate<E>) -> FeedPosition {
    FeedPosition {
        sort_at: candidate.sort_at,
        entity_id: candidate.key.entity_id.to_string(),
    }
}

impl<S, N> FeedReader<S, N>
where
    S: CandidateSource,
    N: FeedNotifications,
{
    /// Create the reader over its ports.
    pub fn new(source: S, notifications: N) -> Self {
        Self {
            source,
            notifications,
        }
    }

    /// Load each candidate's notifications, in candidate order.
    async fn load(
        &self,
        viewer: &FeedViewer,
        keying: CandidateKeying,
        candidates: Vec<Candidate<S::Entity>>,
    ) -> Result<Vec<Loaded<S::Entity>>, Report> {
        let mut sources = Vec::new();
        let mut seen = HashSet::new();
        for source in candidates
            .iter()
            .filter_map(|candidate| notification_source(candidate, keying))
        {
            if seen.insert(source.clone()) {
                sources.push(source);
            }
        }
        let loaded = if sources.is_empty() {
            HashMap::new()
        } else {
            self.notifications
                .active(viewer.user.clone(), sources)
                .await?
        };
        Ok(candidates
            .into_iter()
            .map(|candidate| {
                let mut notifications = notification_source(&candidate, keying)
                    .and_then(|source| loaded.get(&source).cloned())
                    .unwrap_or_default();
                sort_newest_first(&mut notifications);
                Loaded {
                    candidate,
                    notifications,
                }
            })
            .collect())
    }

    /// One page of entries built by `build`, which drops a candidate by
    /// returning `None`. Reads further candidate pages until `request.limit`
    /// entries are kept, the feed ends, or [`MAX_FILL_ROUNDS`] pages were
    /// read.
    #[tracing::instrument(
        name = "attention_feed.page",
        skip_all,
        fields(user = %request.viewer.user, keying = ?request.keying, limit = request.limit),
        err
    )]
    pub async fn page<T>(
        &self,
        request: CandidateRequest,
        mut build: impl FnMut(Loaded<S::Entity>) -> Option<T>,
    ) -> Result<FeedPage<T>, Report> {
        let limit = usize::from(request.limit);
        let mut entries = Vec::with_capacity(limit);
        let mut after = request.after.clone();
        for _ in 0..MAX_FILL_ROUNDS {
            let page = self
                .source
                .page(CandidateRequest {
                    after: after.clone(),
                    ..request.clone()
                })
                .await?;
            let loaded = self
                .load(&request.viewer, request.keying, page.items)
                .await?;
            let total = loaded.len();
            for (index, item) in loaded.into_iter().enumerate() {
                let walked = position(&item.candidate);
                if let Some(entry) = build(item) {
                    entries.push(entry);
                }
                if entries.len() == limit && index + 1 < total {
                    // Full before the page ran out: resume just past the
                    // last candidate walked.
                    return Ok(FeedPage {
                        entries,
                        next: Some(walked),
                    });
                }
            }
            if entries.len() == limit || page.next.is_none() {
                return Ok(FeedPage {
                    entries,
                    next: page.next,
                });
            }
            after = page.next;
        }
        Ok(FeedPage {
            entries,
            next: after,
        })
    }

    /// The current candidates for `keys` in `request`'s feed, loaded, keyed
    /// by key. Keys the feed no longer admits are absent.
    #[tracing::instrument(
        name = "attention_feed.current",
        skip_all,
        fields(user = %request.viewer.user, keying = ?request.keying, keys = keys.len()),
        err
    )]
    pub async fn current(
        &self,
        request: CandidateRequest,
        keys: &[FeedKey],
    ) -> Result<HashMap<FeedKey, Loaded<S::Entity>>, Report> {
        let mut current = HashMap::with_capacity(keys.len());
        for chunk in keys.chunks(RECOMPUTE_CHUNK) {
            let page = self
                .source
                .page(CandidateRequest {
                    limit: u16::try_from(chunk.len()).unwrap_or(u16::MAX),
                    after: None,
                    only: Some(chunk.iter().map(|key| key.entity().clone()).collect()),
                    ..request.clone()
                })
                .await?;
            for loaded in self
                .load(&request.viewer, request.keying, page.items)
                .await?
            {
                current.insert(FeedKey::new(loaded.candidate.key.clone()), loaded);
            }
        }
        Ok(current)
    }
}
