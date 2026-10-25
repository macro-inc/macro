//! Who sees what a workspace import writes: the plan's per-object sharing,
//! the owner's changes to it, and which folders can be shared.
//!
//! Sharing a folder shares everything inside it, so a folder is shared only
//! when everything written inside it is.

use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use crate::domain::models::NotionSharing;

use super::triage::Verdict;
use super::write::{FolderLayout, WriteItem};

#[cfg(test)]
mod test;

/// Why a user without a team keeps everything.
pub(super) const NO_TEAM: &str = "You're not on a team, so this stays visible only to you.";
/// Why an object is not shared when the decision model gave no answer.
const NO_ANSWER: &str = "Kept visible only to you: the decision model gave no answer.";

/// What the plan says about one object's sharing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PlanSharing {
    /// Shared with the team.
    pub shared: bool,
    /// Why, when there is something to say.
    pub reason: Option<String>,
    /// Whether the user may change it.
    pub shareable: bool,
}

/// The plan's sharing for one object under the user's choice.
pub(super) fn plan_sharing(sharing: NotionSharing, verdict: &Verdict, team: bool) -> PlanSharing {
    let personal = |reason: &str| PlanSharing {
        shared: false,
        reason: Some(reason.to_string()),
        shareable: false,
    };
    if !team {
        return personal(NO_TEAM);
    }
    let (shared, reason) = match sharing {
        NotionSharing::Team => (true, None),
        NotionSharing::Personal => (false, None),
        NotionSharing::Ai => match verdict.shared {
            Some(shared) => (shared, verdict.shared_reason.clone()),
            None => (false, Some(NO_ANSWER.to_string())),
        },
    };
    PlanSharing {
        shared,
        reason,
        shareable: true,
    }
}

/// The owner's changes to the plan's sharing that the import accepts: rows
/// that can be shared, set to a value other than the plan's. Returns the
/// rows to share and the rows to keep.
pub(super) fn sharing_changes(
    items: &[WriteItem],
    shared: &[Uuid],
    personal: &[Uuid],
) -> (Vec<Uuid>, Vec<Uuid>) {
    let mut to_share = Vec::new();
    let mut to_keep = Vec::new();
    for item in items.iter().filter(|item| item.shareable) {
        if shared.contains(&item.import_id) && !item.shared {
            to_share.push(item.import_id);
        } else if personal.contains(&item.import_id) && item.shared {
            to_keep.push(item.import_id);
        }
    }
    (to_share, to_keep)
}

/// The folders to share: those whose every written object, the folder's
/// own page included, is shared. A folder holding a private page or
/// database stays with the user, since sharing it would share them.
pub(super) fn shared_folders(items: &[WriteItem], layout: &FolderLayout) -> HashSet<Uuid> {
    let parents: HashMap<Uuid, Option<Uuid>> = items
        .iter()
        .map(|item| (item.import_id, item.parent))
        .collect();
    let mut private: HashSet<Uuid> = HashSet::new();
    let mut holds_written: HashSet<Uuid> = HashSet::new();
    for item in items.iter().filter(|item| item.writes()) {
        // The item's own folder (when it became one) and every folder above.
        let mut current = Some(item.import_id);
        let mut guard = 0;
        while let Some(folder) = current {
            guard += 1;
            if guard > items.len() + 1 {
                break;
            }
            holds_written.insert(folder);
            if !item.shared {
                private.insert(folder);
            }
            current = parents.get(&folder).copied().flatten();
        }
    }
    layout
        .folders
        .iter()
        .copied()
        .filter(|folder| holds_written.contains(folder) && !private.contains(folder))
        .collect()
}
