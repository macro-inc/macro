use loro::{Frontiers, LoroDoc, VersionVector};

/// Content-free operation counts at a requested snapshot frontier.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotStats {
    /// Operations included by the requested base, if that frontier is known.
    pub base_ops: Option<u64>,
    /// Operations in the current operation-log version vector.
    pub current_ops: u64,
    /// Current operations beyond the requested base, if known.
    pub retained_ops: Option<u64>,
    /// Operations below the document's cached shallow root.
    pub cached_root_ops: u64,
    /// Requested-base operations beyond the cached shallow root, if known.
    pub base_cached_root_distance: Option<u64>,
}

impl SnapshotStats {
    /// Observe version vectors without exporting, checking out, or changing policy.
    pub fn from_doc(doc: &LoroDoc, at: &Frontiers) -> Self {
        let current = doc.oplog_vv();
        let cached = doc.shallow_since_vv().to_vv();
        let base = doc.frontiers_to_vv(at);
        Self {
            base_ops: base.as_ref().map(total),
            current_ops: total(&current),
            retained_ops: base.as_ref().map(|base| distance(&current, base)),
            cached_root_ops: total(&cached),
            base_cached_root_distance: base.as_ref().map(|base| distance(base, &cached)),
        }
    }
}

fn total(vv: &VersionVector) -> u64 {
    vv.values().fold(0u64, |sum, value| {
        sum.saturating_add((*value).max(0) as u64)
    })
}

fn distance(newer: &VersionVector, older: &VersionVector) -> u64 {
    newer.iter().fold(0u64, |sum, (peer, counter)| {
        let previous = older.get(peer).copied().unwrap_or(0);
        let distance = i64::from(*counter) - i64::from(previous);
        sum.saturating_add(distance.max(0) as u64)
    })
}

#[cfg(test)]
mod test;
