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
        let mut ids = self.read(viewer, &patterns, false).await?;
        // The read returns the newest matches, so a full one may have left out
        // an older channel named exactly this; read those on their own.
        if ids.len() >= CHANNELS_PER_NAME as usize {
            ids.extend(self.read(viewer, &exact_patterns(needle), true).await?);
        }
        Ok(ids)
    }

    async fn read(
        &self,
        viewer: &NameViewer,
        patterns: &[String],
        regex_patterns: bool,
    ) -> Result<Vec<Uuid>, NameSourceError> {
        let matches = match_channel_names(
            &self.db,
            ChannelNameSearch {
                viewer_user_id: viewer.user.clone(),
                patterns,
                regex_patterns,
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

/// Case-insensitive regexes, one per comma-separated part of `needle`, that
/// together match every channel the lookup would call `needle` exactly:
/// surrounding space, one leading `#` or `@`, any run of space between
/// words. Each part is anchored at the name's ends or a comma, because an
/// unnamed private channel's name lists its members with commas and the
/// read matches each part against one member's name.
fn exact_patterns(needle: &Needle) -> Vec<String> {
    let parts: Vec<Vec<String>> = needle
        .as_str()
        .split(',')
        .map(|part| {
            part.split_whitespace()
                .map(name_search::escape_regex)
                .collect::<Vec<_>>()
        })
        .filter(|words| !words.is_empty())
        .collect();
    let last = parts.len().saturating_sub(1);
    parts
        .iter()
        .enumerate()
        .map(|(index, words)| {
            let start = if index == 0 {
                r"^\s*[#@]?\s*"
            } else {
                r"(^|,)\s*"
            };
            let end = if index == last { r"\s*$" } else { r"\s*(,|$)" };
            format!("{start}{}{end}", words.join(r"\s+"))
        })
        .collect()
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

#[cfg(test)]
mod test;
