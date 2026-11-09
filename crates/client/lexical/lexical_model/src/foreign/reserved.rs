//! Constructors consume exact native key capabilities without allocating twice.
use crate::*;
use std::sync::Arc;
impl Transaction<'_> {
    /// Construct one exact native type using a host-reserved key and owned fields.
    /// JS replacement functions remain a separate host operation.
    pub fn create_reserved_with<Node: NodeType>(
        &mut self,
        reserved: ForeignReservedKey,
        node: Node,
        base: BaseData,
    ) -> Result<Id<Node>, Error> {
        self.guard_write()?;
        let index = self
            .pending
            .registry
            .index_of::<Node>()
            .ok_or(Error::UnregisteredNodeOnCreate(Node::TYPE))?;
        if base.kind() != self.pending.registry.registered(index).kind {
            return Err(Error::BaseKindMismatch);
        }
        let key = reserved.consume(&self.editor.keys)?;
        Ok(Id::new_unchecked(self.insert_record_with_key(
            index,
            Arc::new(node),
            base,
            Some(key),
        )?))
    }
}
#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn reserved_constructor_uses_issued_stream_and_never_reallocates() -> Result<(), Error> {
        let keys = SharedKeyCounter::new();
        let reserved = keys.reserve_for_foreign_host()?;
        let expected = reserved.key();
        let burned = keys.reserve_for_foreign_host()?.key();
        let mut editor = Editor::builder(EditorMode::Headless)
            .key_source(KeySource::Shared(keys.clone()))
            .build()
            .unwrap();
        let mut tx = editor.transaction();
        let created = tx.create_reserved_with(
            reserved,
            Text::default(),
            BaseData::Text(TextData::default()),
        )?;
        assert_eq!(created.key(), expected);
        assert_eq!(keys.last_allocated(), Some(burned));
        let next = tx.create(Paragraph::default())?;
        assert!(next.key().index() > burned.index());
        let alien = SharedKeyCounter::new().reserve_for_foreign_host()?;
        assert!(matches!(
            tx.create_reserved_with(alien, Text::default(), BaseData::Text(TextData::default())),
            Err(Error::Invariant("reserved key allocation stream mismatch"))
        ));
        assert_eq!(tx.children_keys(NodeKey::ROOT)?, Vec::<NodeKey>::new());
        Ok(())
    }
}
