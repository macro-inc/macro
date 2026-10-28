//! Coalesce notification member edits before composing a parent's projection.

use cache_core::predicate::{ProjectionIncompleteKind, ProjectionMutation};
use indexmap::IndexMap;
use predicate_index::{ExactFact, Profile, RecordKey, Token};
use std::collections::BTreeSet;

struct Batch {
    profile: Profile,
    partition: Token,
    state: BatchState,
}

enum BatchState {
    Members {
        remove: BTreeSet<ExactFact>,
        insert: BTreeSet<ExactFact>,
    },
    Incomplete(ProjectionIncompleteKind),
}

/// Notification updates contain only member edits or invalidation. Combining
/// them per parent avoids copying and sorting a large projection for every child.
/// This does not combine separate optimistic queue layers or reorder snapshots.
pub(super) fn batch_member_changes(mutations: Vec<ProjectionMutation>) -> Vec<ProjectionMutation> {
    let mut batches = IndexMap::<RecordKey, Batch>::new();
    for mutation in mutations {
        match mutation {
            ProjectionMutation::PatchExact {
                record_key,
                profile,
                partition,
                remove,
                insert,
            } => {
                let batch = batches.entry(record_key).or_insert_with(|| Batch {
                    profile,
                    partition,
                    state: BatchState::Members {
                        remove: BTreeSet::new(),
                        insert: BTreeSet::new(),
                    },
                });
                if let BatchState::Members {
                    remove: removed,
                    insert: inserted,
                } = &mut batch.state
                {
                    // Later removals override earlier inserts. Later inserts win
                    // over removals, including a move between unseen and seen.
                    for fact in remove {
                        inserted.remove(&fact);
                        removed.insert(fact);
                    }
                    inserted.extend(insert);
                }
            }
            ProjectionMutation::MarkIncomplete {
                record_key,
                profile,
                partition,
                kind,
            } => {
                batches.insert(
                    record_key,
                    Batch {
                        profile,
                        partition,
                        state: BatchState::Incomplete(kind),
                    },
                );
            }
            _ => unreachable!("notification updates are member edits or invalidation"),
        }
    }
    batches
        .into_iter()
        .map(|(record_key, batch)| match batch.state {
            BatchState::Members { remove, insert } => ProjectionMutation::PatchExact {
                record_key,
                profile: batch.profile,
                partition: batch.partition,
                remove: remove.into_iter().collect(),
                insert: insert.into_iter().collect(),
            },
            BatchState::Incomplete(kind) => ProjectionMutation::MarkIncomplete {
                record_key,
                profile: batch.profile,
                partition: batch.partition,
                kind,
            },
        })
        .collect()
}

#[cfg(test)]
mod test;
