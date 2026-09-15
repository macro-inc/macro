//! Run reports printed to the operator.

use std::fmt;

/// What one run wrote. Every counter is zero when the store already matched.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Summary {
    pub documents: u64,
    pub batches: u64,
    pub comment_mappings_allocated: u64,
    pub thread_mappings_allocated: u64,
    pub messages_inserted: u64,
    pub messages_updated: u64,
    pub messages_tombstoned: u64,
    pub threads_written: u64,
    pub threads_tombstoned: u64,
    pub anchors_linked: u64,
    pub notifications_remapped: u64,
    pub pdf_payloads_remapped: u64,
    pub warnings: Warnings,
}

/// Legacy data the import could not represent exactly. Nothing here aborts a run.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Warnings {
    /// Document comment notifications still pointing at a legacy id without a mapping.
    pub unmapped_notifications: u64,
    /// Numeric comment ids in saved PDF payloads without a mapping.
    pub unmapped_pdf_comment_ids: u64,
    /// Threads whose mark id is neither a UUID nor a `DISCUSSION:` mark; imported unanchored.
    pub invalid_mark_ids: u64,
    /// Threads whose first legacy comment is no longer the mapped root.
    pub root_order_drift: u64,
}

impl Summary {
    /// Add a committed batch to the run.
    pub fn absorb(&mut self, batch: Self) {
        self.documents += batch.documents;
        self.batches += batch.batches;
        self.comment_mappings_allocated += batch.comment_mappings_allocated;
        self.thread_mappings_allocated += batch.thread_mappings_allocated;
        self.messages_inserted += batch.messages_inserted;
        self.messages_updated += batch.messages_updated;
        self.messages_tombstoned += batch.messages_tombstoned;
        self.threads_written += batch.threads_written;
        self.threads_tombstoned += batch.threads_tombstoned;
        self.anchors_linked += batch.anchors_linked;
        self.notifications_remapped += batch.notifications_remapped;
        self.pdf_payloads_remapped += batch.pdf_payloads_remapped;
        self.warnings.unmapped_notifications += batch.warnings.unmapped_notifications;
        self.warnings.unmapped_pdf_comment_ids += batch.warnings.unmapped_pdf_comment_ids;
        self.warnings.invalid_mark_ids += batch.warnings.invalid_mark_ids;
        self.warnings.root_order_drift += batch.warnings.root_order_drift;
    }

    /// True when the run changed nothing.
    pub fn is_noop(&self) -> bool {
        self.comment_mappings_allocated == 0
            && self.thread_mappings_allocated == 0
            && self.messages_inserted == 0
            && self.messages_updated == 0
            && self.messages_tombstoned == 0
            && self.threads_written == 0
            && self.threads_tombstoned == 0
            && self.anchors_linked == 0
            && self.notifications_remapped == 0
            && self.pdf_payloads_remapped == 0
    }
}

impl fmt::Display for Summary {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_noop() {
            writeln!(
                f,
                "Nothing to import: {} documents with legacy comments already match the message store.",
                self.documents
            )?;
        } else {
            writeln!(
                f,
                "Imported legacy comments across {} documents in {} batches.",
                self.documents, self.batches
            )?;
            writeln!(
                f,
                "  comment mappings allocated: {}",
                self.comment_mappings_allocated
            )?;
            writeln!(
                f,
                "  thread mappings allocated:  {}",
                self.thread_mappings_allocated
            )?;
            writeln!(
                f,
                "  messages inserted:          {}",
                self.messages_inserted
            )?;
            writeln!(f, "  messages updated:           {}", self.messages_updated)?;
            writeln!(
                f,
                "  messages tombstoned:        {}",
                self.messages_tombstoned
            )?;
            writeln!(f, "  thread states written:      {}", self.threads_written)?;
            writeln!(
                f,
                "  thread states tombstoned:   {}",
                self.threads_tombstoned
            )?;
            writeln!(f, "  PDF anchors linked:         {}", self.anchors_linked)?;
            writeln!(
                f,
                "  notifications remapped:     {}",
                self.notifications_remapped
            )?;
            writeln!(
                f,
                "  PDF payloads remapped:      {}",
                self.pdf_payloads_remapped
            )?;
        }
        write!(f, "{}", self.warnings)
    }
}

impl fmt::Display for Warnings {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let lines = [
            (
                self.unmapped_notifications,
                "document comment notifications still reference a legacy id without a mapping",
            ),
            (
                self.unmapped_pdf_comment_ids,
                "numeric comment ids in saved PDF payloads have no mapping and were left as is",
            ),
            (
                self.invalid_mark_ids,
                "threads carry a mark id that is not a UUID and were imported unanchored",
            ),
            (
                self.root_order_drift,
                "threads whose first legacy comment is no longer the mapped root",
            ),
        ];
        for (count, text) in lines {
            if count > 0 {
                writeln!(f, "  warning: {count} {text}")?;
            }
        }
        Ok(())
    }
}

/// Work still ahead of the next run, without writing anything.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Pending {
    pub comments_without_mapping: i64,
    pub threads_without_mapping: i64,
    pub documents_with_legacy_comments: i64,
}

impl fmt::Display for Pending {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Preflight passed.")?;
        writeln!(
            f,
            "  documents with legacy comments: {}",
            self.documents_with_legacy_comments
        )?;
        writeln!(
            f,
            "  comments without a mapping:    {}",
            self.comments_without_mapping
        )?;
        writeln!(
            f,
            "  threads without a mapping:     {}",
            self.threads_without_mapping
        )?;
        write!(
            f,
            "Edits and deletions of already imported comments are only detected by a real run."
        )
    }
}
