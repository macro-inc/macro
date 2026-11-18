//! The same runner body, instantiated once per loro-internal build. Only the
//! editor commit and the undo clock differ: they use patched-only APIs.

/// The editor's patched loro-internal.
pub mod patched {
    use loro_patched as li;
    include!("side_body.rs");

    /// Mirrors document_session's eligible local projection commit: suspend
    /// recording at the final commit boundary, resume at the committed
    /// frontiers, then checkpoint undo from the new local op span.
    fn editor_commit(doc: &li::LoroDoc, undo: &li::UndoManager, timestamp: i64) -> EditorCommit {
        if !undo.accepts_projected_checkpoint(crate::LOCAL_ORIGIN) {
            drop(doc.commit_with(commit_options(crate::LOCAL_ORIGIN, timestamp)));
            return EditorCommit::default();
        }
        // The projection's own writes: oplog_vv already includes pending ops.
        let changed = doc.get_pending_txn_len() > 0;
        let suspended = doc.app_state().lock().suspend_recording_for_local_commit();
        drop(doc.commit_with(commit_options(crate::LOCAL_ORIGIN, timestamp)));
        if suspended {
            doc.app_state().lock().start_recording();
        }
        let mut out = EditorCommit {
            suppressed: suspended,
            projected: false,
            error: None,
        };
        if suspended && changed {
            out.projected = true;
            if let Err(e) = undo.record_projected_checkpoint() {
                out.error = Some(e.to_string());
            }
        }
        out
    }

    fn configure_clock(undo: &li::UndoManager, regime: crate::MergeRegime) {
        use std::sync::atomic::{AtomicI64, Ordering};
        use std::sync::Arc;
        match regime {
            crate::MergeRegime::Never => undo.set_merge_interval(0),
            crate::MergeRegime::Always => undo.set_merge_interval(ALWAYS_MERGE_MS),
            crate::MergeRegime::InjectedNever => {
                undo.set_merge_interval(500);
                let clock = Arc::new(AtomicI64::new(1_000));
                undo.set_time_source(Some(Arc::new(move || {
                    clock.fetch_add(1_000, Ordering::Relaxed)
                })));
            }
            crate::MergeRegime::InjectedAlways => {
                undo.set_merge_interval(500);
                undo.set_time_source(Some(Arc::new(|| 42)));
            }
        }
    }
}

/// Unmodified crates.io loro-internal 1.17.1.
pub mod upstream {
    use loro_upstream as li;
    include!("side_body.rs");

    /// Upstream has no suppression API: an ordinary origin-tagged commit.
    fn editor_commit(doc: &li::LoroDoc, _undo: &li::UndoManager, timestamp: i64) -> EditorCommit {
        drop(doc.commit_with(commit_options(crate::LOCAL_ORIGIN, timestamp)));
        EditorCommit::default()
    }

    fn configure_clock(undo: &li::UndoManager, regime: crate::MergeRegime) {
        match regime {
            crate::MergeRegime::Never | crate::MergeRegime::InjectedNever => {
                undo.set_merge_interval(0)
            }
            crate::MergeRegime::Always | crate::MergeRegime::InjectedAlways => {
                undo.set_merge_interval(ALWAYS_MERGE_MS)
            }
        }
    }
}
