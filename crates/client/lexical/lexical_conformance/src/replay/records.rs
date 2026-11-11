//! Record identity allocation shared by independent callback dispatch frames.
use super::{Result, fail};
use lexical_model::{ForeignRecordIdentity, NodeKey};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
pub(crate) struct RecordIdentities(Arc<Mutex<Records>>);

#[derive(Default)]
struct Records {
    by_record: HashMap<(u64, NodeKey, ForeignRecordIdentity), (u64, u64)>,
    next: u64,
}

impl RecordIdentities {
    /// Only owned identity data is accessed under this guard; no model or host
    /// call runs in this scope.
    pub fn identify(
        &self,
        editor: u64,
        key: NodeKey,
        identity: ForeignRecordIdentity,
        version: u64,
    ) -> Result<(u64, u64)> {
        let mut records = self
            .0
            .lock()
            .map_err(|_| fail("record identity store poisoned"))?;
        if let Some(record) = records.by_record.get(&(editor, key, identity.clone())) {
            return Ok(*record);
        }
        let record = (version, records.next);
        records.next = records
            .next
            .checked_add(1)
            .ok_or_else(|| fail("record identity overflow"))?;
        records.by_record.insert((editor, key, identity), record);
        Ok(record)
    }

    pub fn retain(
        &self,
        live: &std::collections::HashSet<(NodeKey, ForeignRecordIdentity)>,
    ) -> Result<()> {
        self.0
            .lock()
            .map_err(|_| fail("record identity store poisoned"))?
            .by_record
            .retain(|(_, key, token), _| live.contains(&(*key, token.clone())));
        Ok(())
    }

    pub fn matches(
        &self,
        key: NodeKey,
        record: &ForeignRecordIdentity,
        identity: u64,
    ) -> Result<bool> {
        Ok(self
            .0
            .lock()
            .map_err(|_| fail("record identity store poisoned"))?
            .by_record
            .iter()
            .any(|((_, node, token), (_, id))| *node == key && token == record && *id == identity))
    }

    pub fn release_version(&self, editor: u64, version: u64) -> Result<()> {
        self.0
            .lock()
            .map_err(|_| fail("record identity store poisoned"))?
            .by_record
            .retain(|(record_editor, _, _), (owner, _)| {
                *record_editor != editor || *owner != version
            });
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use lexical_model::{Editor, EditorMode};

    #[test]
    fn record_release_cannot_invalidate_another_editors_equal_version() -> Result<()> {
        let editor = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let token = editor
            .state()
            .view()
            .foreign_record_identity(NodeKey::ROOT)?;
        let records = RecordIdentities::default();
        let first = records.identify(0, NodeKey::ROOT, token.clone(), 1)?;
        let second = records.identify(1, NodeKey::ROOT, token.clone(), 1)?;
        assert_ne!(first.1, second.1);
        records.release_version(0, 1)?;
        assert!(!records.matches(NodeKey::ROOT, &token, first.1)?);
        assert!(records.matches(NodeKey::ROOT, &token, second.1)?);
        assert_eq!(records.identify(1, NodeKey::ROOT, token, 1)?, second);
        Ok(())
    }
}
