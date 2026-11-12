//! Name sources over this crate's own stores.

use std::collections::HashSet;

use channels::outbound::channel_name::{
    ChannelNameSearch, batch_resolve_channel_names, match_channel_names,
};
use futures::{StreamExt, TryStreamExt};
use models_search::names::{NameKind, NamedItem};
use readonly_pool::ReadOnlyPool;
use uuid::Uuid;

use crate::domain::names::{
    Candidate, NameSource, NameSourceError, NameViewer, Needle, READS_PER_SOURCE,
};

/// How many channels one name reads.
const CHANNELS_PER_NAME: i64 = 100;

/// Channels the viewer is in, by the name they see: a DM or an unnamed
/// private channel by its other participants' names.
pub(crate) struct ChannelNames {
    db: ReadOnlyPool,
}

impl ChannelNames {
    pub(crate) fn new(db: ReadOnlyPool) -> Self {
        Self { db }
    }

    /// The channels whose name holds every word of `needle`.
    async fn search(
        &self,
        viewer: &NameViewer,
        needle: &Needle,
    ) -> Result<Vec<Uuid>, NameSourceError> {
        let patterns: Vec<String> = needle
            .as_str()
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|word| !word.is_empty())
            .map(|word| format!("%{}%", name_search::escape_like(word)))
            .collect();
        let matches = match_channel_names(
            &self.db,
            ChannelNameSearch {
                viewer_user_id: viewer.user.clone(),
                patterns: &patterns,
                regex_patterns: false,
                channel_ids: &[],
                channel_types: &[],
                after: None,
                limit: CHANNELS_PER_NAME,
            },
        )
        .await
        .map_err(|error| NameSourceError::Internal(rootcause::Report::new(error).into_dynamic()))?;
        Ok(matches.into_iter().map(|hit| hit.channel_id).collect())
    }
}

#[async_trait::async_trait]
impl NameSource for ChannelNames {
    fn kinds(&self) -> &'static [NameKind] {
        &[NameKind::Channel]
    }

    async fn find(
        &self,
        viewer: &NameViewer,
        _kinds: &[NameKind],
        needles: &[Needle],
    ) -> Result<Vec<Candidate>, NameSourceError> {
        // Futures built up front: a stream `map` closure that borrows the
        // viewer isn't `Send` enough for `async_trait`.
        let searches: Vec<_> = needles
            .iter()
            .map(|needle| self.search(viewer, needle))
            .collect();
        let found: Vec<Vec<Uuid>> = futures::stream::iter(searches)
            .buffer_unordered(READS_PER_SOURCE)
            .try_collect()
            .await?;
        let ids: Vec<Uuid> = found
            .into_iter()
            .flatten()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let names = batch_resolve_channel_names(&self.db, &ids, viewer.user.clone())
            .await
            .map_err(|error| {
                NameSourceError::Internal(rootcause::Report::new(error).into_dynamic())
            })?;
        Ok(names
            .into_iter()
            .map(|(id, name)| Candidate {
                item: NamedItem::Channel { id },
                name,
                aliases: Vec::new(),
            })
            .collect())
    }
}
