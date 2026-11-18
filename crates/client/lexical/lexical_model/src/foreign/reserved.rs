//! Constructors consume exact native key capabilities without allocating twice.
use crate::*;
use std::sync::Arc;
impl Transaction<'_> {
    /// Install an already-constructed JS instance with a native reserved record.
    /// Validate namespace/class before consuming the ticket or installing any record.
    pub fn create_reserved_with_instance<Node: NodeType>(
        &mut self,
        reserved: ForeignReservedKey,
        node: Node,
        base: BaseData,
        instance: ForeignInstance,
    ) -> Result<Id<Node>, Error> {
        self.guard_write()?;
        if instance.is_ephemeral() || !instance.owner().matches(self) {
            return Err(Error::Invariant("reserved instance owner mismatch"));
        }
        self.pending
            .foreign_instances
            .validate_instance(Node::TYPE, &instance)?;
        ForeignReadOperation::check()?;
        let created = self.create_reserved_with(reserved, node, base)?;
        let update = self.foreign_update_identity();
        let slot = self
            .pending
            .nodes
            .get_mut(&created.key())
            .ok_or(Error::Invariant("reserved record missing"))?;
        let slot = Arc::make_mut(slot);
        slot.foreign_instance
            .set(instance)
            .map_err(|_| Error::Invariant("reserved instance already bound"))?;
        slot.foreign_instance_write = Some(update);
        Ok(created)
    }
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

#[cfg(test)]
mod instance_test {
    use super::*;
    struct Instances;
    impl ForeignInstanceHooks for Instances {
        fn validate_instance(
            &self,
            type_name: &str,
            instance: &ForeignInstance,
        ) -> Result<(), Error> {
            if type_name != "text" || instance.class_id() != 7 {
                return Err(Error::Invariant("instance class mismatch"));
            }
            Ok(())
        }
        fn clone_instance(
            &self,
            _: ForeignInstanceCloneRequest,
        ) -> Result<ForeignInstanceClone, Error> {
            Err(Error::Invariant("new instance must not clone"))
        }
    }
    #[test]
    fn reserved_instance_is_writable_once_without_constructor_replay() -> Result<(), Error> {
        let keys = SharedKeyCounter::new();
        let invalid_class_ticket = keys.reserve_for_foreign_host()?;
        let invalid_class_key = invalid_class_ticket.key();
        let invalid_base_ticket = keys.reserve_for_foreign_host()?;
        let invalid_base_key = invalid_base_ticket.key();
        let ticket = keys.reserve_for_foreign_host()?;
        let key = ticket.key();
        let mut editor = Editor::builder(EditorMode::Headless)
            .key_source(KeySource::Shared(keys.clone()))
            .foreign_instance_hooks(Arc::new(Instances))
            .build()
            .expect("editor");
        let mut tx = editor.transaction();
        let invalid = ForeignInstance::new(tx.view().foreign_instance_owner(), 8, 21)?;
        assert!(
            tx.create_reserved_with_instance(
                invalid_class_ticket,
                Text::default(),
                BaseData::Text(TextData::default()),
                invalid
            )
            .is_err()
        );
        assert!(!tx.contains(invalid_class_key));
        let invalid = ForeignInstance::new(tx.view().foreign_instance_owner(), 7, 22)?;
        assert!(matches!(
            tx.create_reserved_with_instance(
                invalid_base_ticket,
                Text::default(),
                BaseData::Element(ElementData::default()),
                invalid
            ),
            Err(Error::BaseKindMismatch)
        ));
        assert!(!tx.contains(invalid_base_key));
        let instance = ForeignInstance::new(tx.view().foreign_instance_owner(), 7, 23)?;
        let text = tx.create_reserved_with_instance(
            ticket,
            Text::default(),
            BaseData::Text(TextData::default()),
            instance,
        )?;
        assert_eq!(text.key(), key);
        let captured = tx.view().snapshot_for_foreign_read()?;
        tx.text(text)?.set_text_content("typed")?;
        assert_eq!(
            tx.view()
                .foreign_instance(key)
                .expect("instance")
                .instance_id(),
            23
        );
        assert!(tx.foreign_is_writable(key));
        assert_eq!(
            captured
                .view()
                .foreign_instance(key)
                .expect("captured instance")
                .instance_id(),
            23
        );
        assert_eq!(captured.view().text_content(key), "");
        assert_eq!(tx.text_content(key), "typed");
        assert_eq!(keys.last_allocated(), Some(key));
        let paragraph = tx.create(Paragraph {})?;
        tx.append(paragraph, &[key])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.commit()?;
        assert_eq!(
            editor
                .state()
                .view()
                .foreign_instance(key)
                .expect("published instance")
                .instance_id(),
            23
        );
        Ok(())
    }
}
