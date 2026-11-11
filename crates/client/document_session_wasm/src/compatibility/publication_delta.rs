//! Publication deltas visit changed keys and destroyed subtrees, never all live nodes.
use super::*;
use lexical_model::*;
use std::collections::HashSet;

impl Host {
    pub(super) fn publication_batch(
        &mut self,
        state: &EditorState,
        commits: &[Commit],
        version: u64,
    ) -> Result<compat::ForeignRenderBatch, BoundaryError> {
        let full_reconcile = commits.iter().any(|commit| commit.full_reconcile);
        let source = Arc::new(state.view().snapshot_for_foreign_read()?);
        let mut changed = HashSet::new();
        let mut removed = HashSet::new();
        for commit in commits {
            changed.extend(commit.changes.dirty_leaves.iter().copied());
            changed.extend(commit.changes.dirty_elements.keys().copied());
            changed.extend(commit.normalized.iter().copied());
            for (key, mutation) in &commit.changes.mutations {
                changed.insert(*key);
                if *mutation == Mutation::Destroyed {
                    removed.insert(*key);
                    // GC need not dirty every descendant of a removed element.
                    // Enumerate only the destroyed subtree in its previous graph.
                    removed.extend(commit.prev.view().descendants(*key).map(|(key, _)| key));
                }
            }
            if full_reconcile {
                removed.extend(
                    commit
                        .prev
                        .view()
                        .snapshot_for_foreign_read()?
                        .record_keys(),
                );
            }
        }
        removed.extend(
            changed
                .iter()
                .copied()
                .filter(|key| !state.view().contains(*key)),
        );
        removed.retain(|key| !state.view().contains(*key));
        let mut removed: Vec<_> = removed.into_iter().collect();
        removed.sort_unstable();
        let mut keys = if full_reconcile {
            source.record_keys()
        } else {
            changed
                .into_iter()
                .filter(|key| state.view().contains(*key))
                .collect()
        };
        keys.sort_unstable();
        Ok(compat::ForeignRenderBatch {
            editor_id: self.editor,
            update_id: 0,
            version,
            full_reconcile,
            records: self.records(
                source,
                keys,
                version,
                0,
                compat::ForeignAccess::Frozen,
                records::CaptureOptions {
                    writable: &[],
                    include_root_cache: false,
                },
            )?,
            removed_keys: removed.into_iter().map(records::key).collect(),
        })
    }
}

#[cfg(test)]
mod test;
