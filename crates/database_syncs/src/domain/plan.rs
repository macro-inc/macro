//! What a run writes: which source rows to insert, update and delete, from
//! the rows the sync wrote before and what the source holds now.

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};

use models_databases::{CellWrite, RowId};
use sha2::{Digest, Sha256};

/// SHA-256 of a row's rendered cells, to tell whether it changed.
pub type Fingerprint = [u8; 32];

/// A source row the sync wrote, and the table row holding it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowMapping {
    /// The source's id for the row.
    pub external_id: String,
    /// The table row.
    pub row_id: RowId,
    /// What the row's cells were when last written; `None` while its insert
    /// is in flight, whose row may or may not exist.
    pub fingerprint: Option<Fingerprint>,
}

/// A row as the source holds it now: every synced column's cell, cleared
/// where the source has no value.
#[derive(Debug, Clone, PartialEq)]
pub struct SourceRow {
    /// The source's id for the row.
    pub external_id: String,
    /// Its cells, in column order.
    pub cells: Vec<CellWrite>,
}

/// A source row to add to the table.
#[derive(Debug, Clone, PartialEq)]
pub struct RowInsert {
    /// The source's id for the row.
    pub external_id: String,
    /// The id an earlier, unfinished insert reserved, which this one reuses.
    pub row_id: Option<RowId>,
    /// Its cells.
    pub cells: Vec<CellWrite>,
    /// Their fingerprint.
    pub fingerprint: Fingerprint,
}

/// A table row whose source row changed.
#[derive(Debug, Clone, PartialEq)]
pub struct RowUpdate {
    /// The source's id for the row.
    pub external_id: String,
    /// The table row.
    pub row_id: RowId,
    /// Its cells.
    pub cells: Vec<CellWrite>,
    /// Their fingerprint.
    pub fingerprint: Fingerprint,
}

/// A source row that is gone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RowDelete {
    /// The source's id for the row.
    pub external_id: String,
    /// The table row to remove; `None` when it is gone already.
    pub row_id: Option<RowId>,
}

/// Everything one run writes.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SyncPlan {
    /// Rows to add.
    pub inserts: Vec<RowInsert>,
    /// Rows to rewrite.
    pub updates: Vec<RowUpdate>,
    /// Rows to remove.
    pub deletes: Vec<RowDelete>,
}

/// The fingerprint of a row's cells.
pub fn fingerprint(cells: &[CellWrite]) -> Fingerprint {
    let mut hasher = Sha256::new();
    for cell in cells {
        hasher.update(cell.column.as_uuid().as_bytes());
        hasher.update(format!("{:?}", cell.value));
    }
    hasher.finalize().into()
}

/// Plan a run. `present` holds which mapped rows the table still has.
/// Rows mirror the source: a row someone deleted in Macro comes back. Only a
/// `complete` read removes rows, so a cut-off read never deletes.
pub fn plan(
    mappings: &[RowMapping],
    present: &HashSet<RowId>,
    rows: Vec<SourceRow>,
    complete: bool,
) -> SyncPlan {
    let by_external_id: HashMap<&str, &RowMapping> = mappings
        .iter()
        .map(|mapping| (mapping.external_id.as_str(), mapping))
        .collect();
    let mut seen: HashSet<String> = HashSet::new();
    let mut planned = SyncPlan::default();

    for row in rows {
        if !seen.insert(row.external_id.clone()) {
            continue;
        }

        let row_fingerprint = fingerprint(&row.cells);
        let Some(mapping) = by_external_id.get(row.external_id.as_str()) else {
            planned.inserts.push(RowInsert {
                external_id: row.external_id,
                row_id: None,
                cells: row.cells,
                fingerprint: row_fingerprint,
            });
            continue;
        };

        if present.contains(&mapping.row_id) {
            if mapping.fingerprint != Some(row_fingerprint) {
                planned.updates.push(RowUpdate {
                    external_id: row.external_id,
                    row_id: mapping.row_id,
                    cells: row.cells,
                    fingerprint: row_fingerprint,
                });
            }
            continue;
        }

        // An unfinished insert retries under the id it reserved; a row
        // someone deleted comes back under a new one.
        let reserved = mapping.fingerprint.is_none().then_some(mapping.row_id);
        planned.inserts.push(RowInsert {
            external_id: row.external_id,
            row_id: reserved,
            cells: row.cells,
            fingerprint: row_fingerprint,
        });
    }

    if complete {
        planned.deletes = mappings
            .iter()
            .filter(|mapping| !seen.contains(&mapping.external_id))
            .map(|mapping| RowDelete {
                external_id: mapping.external_id.clone(),
                row_id: present.contains(&mapping.row_id).then_some(mapping.row_id),
            })
            .collect();
    }

    planned
}
