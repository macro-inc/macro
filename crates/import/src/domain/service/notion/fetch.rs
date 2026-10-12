//! Reading a page's block tree within fixed bounds.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use tokio::time::Instant;

use crate::domain::models::{NotionBlock, NotionBlockKind, NotionId};
use crate::domain::ports::{ApiSourceError, NotionSession};

#[cfg(test)]
mod test;

/// Deepest nesting read (top-level blocks are depth 1).
pub(crate) const MAX_DEPTH: usize = 6;
/// Most blocks read for one page.
pub(crate) const MAX_BLOCKS: usize = 2_000;
/// Most children pages read under one block (100 blocks each).
const MAX_CHILD_PAGES: usize = 25;
/// Reading stops after this long and the page imports truncated, leaving
/// the rest of its import time for images and the document: pages share
/// the user's paced reads.
pub(crate) const READ_BUDGET: Duration = Duration::from_secs(60);

/// A page's blocks as far as the bounds allow.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct BlockTree {
    /// Top-level blocks with their children filled in.
    pub blocks: Vec<NotionBlock>,
    /// Whether a bound stopped the read before the end of the page.
    pub truncated: bool,
}

struct Budget {
    remaining: usize,
    deadline: Instant,
    truncated: bool,
}

impl Budget {
    fn spent(&self) -> bool {
        self.remaining == 0 || Instant::now() >= self.deadline
    }
}

/// Read `page`'s blocks: children recursively, the original's children for
/// synced-block copies, never into child pages or databases (those are
/// pages of their own). Stops at [`MAX_DEPTH`], [`MAX_BLOCKS`] or
/// [`READ_BUDGET`].
pub(crate) async fn fetch_tree(
    session: &impl NotionSession,
    page: &NotionId,
) -> Result<BlockTree, ApiSourceError> {
    let mut budget = Budget {
        remaining: MAX_BLOCKS,
        deadline: Instant::now() + READ_BUDGET,
        truncated: false,
    };
    let blocks = children(session, page, 1, &mut budget).await?;
    Ok(BlockTree {
        blocks,
        truncated: budget.truncated,
    })
}

fn children<'a, S: NotionSession>(
    session: &'a S,
    parent: &'a NotionId,
    depth: usize,
    budget: &'a mut Budget,
) -> Pin<Box<dyn Future<Output = Result<Vec<NotionBlock>, ApiSourceError>> + Send + 'a>> {
    Box::pin(async move {
        let mut blocks = Vec::new();
        let mut cursor: Option<String> = None;
        let mut complete = false;
        for _ in 0..MAX_CHILD_PAGES {
            if Instant::now() >= budget.deadline {
                break;
            }
            let page = session.children(parent, cursor.as_deref()).await?;
            for block in page.blocks {
                if budget.remaining == 0 {
                    budget.truncated = true;
                    return Ok(blocks);
                }
                budget.remaining -= 1;
                blocks.push(block);
            }
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => {
                    complete = true;
                    break;
                }
            }
        }
        if !complete {
            budget.truncated = true;
        }

        for block in &mut blocks {
            let source = match &block.kind {
                // Separate pages: linked, never inlined.
                NotionBlockKind::ChildPage { .. } | NotionBlockKind::ChildDatabase { .. } => {
                    continue;
                }
                NotionBlockKind::SyncedBlock {
                    synced_from: Some(original),
                } => original.clone(),
                _ if block.has_children => block.id.clone(),
                _ => continue,
            };
            if depth >= MAX_DEPTH || budget.spent() {
                budget.truncated = true;
                continue;
            }
            match children(session, &source, depth + 1, budget).await {
                Ok(children) => block.children = children,
                // A synced original the connection cannot read renders
                // empty rather than failing the page.
                Err(ApiSourceError::NotFound) if source != block.id => {
                    tracing::debug!(block = %block.id, "synced block original is not readable");
                }
                Err(error) => return Err(error),
            }
        }
        Ok(blocks)
    })
}
