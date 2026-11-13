//! One parse per GraphQL document text.
//!
//! A cache write passes its operation text through several projection passes
//! (filter projections, notifications, mail, properties). Each used to parse
//! it again, and for a 20 KB Soup operation with inlined fragments that
//! parsing cost more than the write itself. Writes repeat a handful of
//! operations, so a few recent documents per thread cover them.

use cache_core::document::{Document, DocumentError};
use std::cell::RefCell;
use std::sync::Arc;

const RECENT_DOCUMENTS: usize = 16;

thread_local! {
    /// Most recently used first.
    static RECENT: RefCell<Vec<(String, Arc<Document>)>> = const { RefCell::new(Vec::new()) };
}

/// The parsed form of `query`, shared with earlier callers on this thread.
pub(crate) fn parsed_document(query: &str) -> Result<Arc<Document>, DocumentError> {
    RECENT.with(|recent| {
        let mut recent = recent.borrow_mut();
        if let Some(index) = recent.iter().position(|(text, _)| text == query) {
            let entry = recent.remove(index);
            let document = Arc::clone(&entry.1);
            recent.insert(0, entry);
            return Ok(document);
        }

        let document = Arc::new(Document::parse(query)?);
        recent.truncate(RECENT_DOCUMENTS - 1);
        recent.insert(0, (query.to_owned(), Arc::clone(&document)));
        Ok(document)
    })
}

#[cfg(test)]
mod test;
