//! Immutable rollback leaves; public durable images and reads stay owned.
use super::*;
use std::rc::Rc;

#[derive(Default)]
pub(super) struct SharedStoreImage {
    entries: BTreeMap<(SyncDocId, WalOwner, WalSeq), Rc<StoredWalRecord>>,
    snapshots: BTreeMap<SyncDocId, Rc<StoredSnapshot>>,
}
impl SharedStoreImage {
    pub(super) fn capture(image: &StoreImage, previous: Option<&Self>) -> Self {
        let entries = image
            .entries
            .iter()
            .map(|(key, row)| {
                let value = previous
                    .and_then(|old| old.entries.get(key))
                    .filter(|old| old.as_ref() == row)
                    .cloned()
                    .unwrap_or_else(|| Rc::new(row.clone()));
                (key.clone(), value)
            })
            .collect();
        let snapshots = image
            .snapshots
            .iter()
            .map(|(key, snapshot)| {
                let value = previous
                    .and_then(|old| old.snapshots.get(key))
                    .filter(|old| old.as_ref() == snapshot)
                    .cloned()
                    .unwrap_or_else(|| Rc::new(snapshot.clone()));
                (key.clone(), value)
            })
            .collect();
        Self { entries, snapshots }
    }
    pub(super) fn into_owned(self) -> StoreImage {
        StoreImage {
            entries: self
                .entries
                .into_iter()
                .map(|(key, value)| {
                    let row =
                        Rc::try_unwrap(value).unwrap_or_else(|shared| shared.as_ref().clone());
                    (key, row)
                })
                .collect(),
            snapshots: self
                .snapshots
                .into_iter()
                .map(|(key, value)| {
                    let snapshot =
                        Rc::try_unwrap(value).unwrap_or_else(|shared| shared.as_ref().clone());
                    (key, snapshot)
                })
                .collect(),
        }
    }
}
