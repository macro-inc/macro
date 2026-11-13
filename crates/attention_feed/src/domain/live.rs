//! Batching realtime triggers into recomputes.

use std::{collections::HashSet, time::Duration};

use futures::Stream;
use tokio::sync::mpsc::Receiver;

use super::models::{FeedKey, FeedTrigger, LiveBatch};

#[cfg(test)]
mod test;

/// How long triggers are collected before one recompute, so a burst of
/// realtime events (a busy thread, a bulk done) costs one feed lookup.
pub const COALESCE_WINDOW: Duration = Duration::from_millis(300);

/// Add one trigger to `batch`, each key once.
fn absorb(batch: &mut LiveBatch, seen: &mut HashSet<FeedKey>, trigger: FeedTrigger) {
    match trigger {
        FeedTrigger::Changed(entities) => {
            for entity in entities {
                let key = FeedKey::new(entity);
                if seen.insert(key.clone()) {
                    batch.keys.push(key);
                }
            }
        }
        FeedTrigger::Invalidated => batch.invalidated = true,
    }
}

/// One batch per burst of triggers: the first trigger opens a `window`,
/// everything arriving within it joins the batch. The stream ends when the
/// triggers end.
pub fn coalesce(
    mut triggers: Receiver<FeedTrigger>,
    window: Duration,
) -> impl Stream<Item = LiveBatch> {
    async_stream::stream! {
        while let Some(first) = triggers.recv().await {
            let mut batch = LiveBatch::default();
            let mut seen = HashSet::new();
            absorb(&mut batch, &mut seen, first);
            let deadline = tokio::time::sleep(window);
            tokio::pin!(deadline);
            loop {
                tokio::select! {
                    () = &mut deadline => break,
                    next = triggers.recv() => match next {
                        Some(trigger) => absorb(&mut batch, &mut seen, trigger),
                        None => break,
                    },
                }
            }
            yield batch;
        }
    }
}
