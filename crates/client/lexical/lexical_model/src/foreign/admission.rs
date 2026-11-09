//! Adopt a staged host update only after the normal input policy admits it.
use super::*;

impl Transaction<'_> {
    pub(crate) fn guard_foreign_publication(&self) -> Result<(), Error> {
        if self.foreign_defer_publication {
            return Err(Error::Invariant("host update awaits admission"));
        }
        Ok(())
    }
    /// Install an unpublished update into a pristine command transaction.
    /// The host must route the command through its ordinary authorization and
    /// readiness boundary; this method grants no independent edit authority.
    pub fn adopt_foreign_update(&mut self, update: PendingUpdate) -> Result<(), Error> {
        self.guard_write()?;
        if update.read_only {
            return Err(Error::ForeignReadOnly);
        }
        if !Arc::ptr_eq(&self.editor.suspend_owner, &update.owner)
            || self.editor.suspend_version != update.version
        {
            return Err(Error::StaleSuspendedUpdate);
        }
        if self.has_foreign_effects()
            || self.preceding.is_some()
            || self.options
                != (UpdateOptions {
                    tags: self.editor.carried_tags.clone(),
                    ..UpdateOptions::default()
                })
        {
            return Err(Error::Invariant("host update target is not pristine"));
        }
        if update.preceding.is_some() {
            return Err(Error::Invariant(
                "host update already published a preceding commit",
            ));
        }
        self.foreign_defer_publication = false;
        self.foreign_update = update.update;
        self.foreign_native_calls = update.native_calls;
        self.foreign_read_only = update.read_only;
        self.foreign_read_sources = update.read_sources;
        self.foreign_read_origin = update.read_origin;
        self.foreign_retired_records = update.retired_records;
        self.foreign_previous_selection = update.previous_selection;
        self.foreign_previous_selection_identity = update.previous_selection_identity;
        self.native_projection = update.native_projection;
        self.extensions = update.extensions;
        self.events = update.events;
        self.default_prevented = update.default_prevented;
        self.pending = update.pending;
        self.dirty_leaves = update.dirty_leaves;
        self.dirty_elements = update.dirty_elements;
        self.composition_key = update.composition_key;
        self.selection_context = update.selection_context;
        self.sealed = update.sealed;
        self.full_reconcile = update.full_reconcile;
        self.selection_dirty = update.selection_dirty;
        self.preceding = update.preceding;
        self.options = update.options;
        self.normalized = update.normalized;
        self.nested = update.nested;
        self.transform_iterations = update.transform_iterations;
        self.dirty_since_flush = update.dirty_since_flush;
        #[cfg(feature = "bench-counters")]
        {
            self.work = update.work;
        }
        self.detached = update.detached;
        self.selection_replacements = update.selection_replacements;
        self.foreign_selections = update.foreign_selections;
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn admitted_update_preserves_tree_selection_tags_and_extensions() -> Result<(), Error> {
        let mut editor = Editor::builder(EditorMode::Headless)
            .extension_state(0_u32)
            .build()
            .expect("editor");
        let mut staged = editor.transaction();
        let paragraph = staged.create(Paragraph::default())?;
        let text = staged.create_text("staged text")?;
        staged.append(paragraph, &[text.key()])?;
        staged.append(NodeKey::ROOT, &[paragraph.key()])?;
        staged.select_end(text)?;
        *staged.extension_mut::<u32>()? = 9;
        staged.add_tag("host-tag".parse().expect("tag"));
        let pending = staged.suspend();
        assert!(editor.state().is_empty_state());
        let mut admitted = editor.transaction();
        admitted.adopt_foreign_update(pending)?;
        let commit = admitted.commit()?;
        assert_eq!(commit.next.root_text_content().as_ref(), "staged text");
        assert!(commit.selection_changed);
        assert!(commit.tags.contains(&"host-tag".parse().expect("tag")));
        assert_eq!(*editor.extension::<u32>()?, 9);
        Ok(())
    }

    #[test]
    fn stale_or_foreign_updates_never_replace_target_state() -> Result<(), Error> {
        let mut first = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let mut second = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let pending = first.transaction().suspend();
        assert!(matches!(
            second.transaction().adopt_foreign_update(pending),
            Err(Error::StaleSuspendedUpdate)
        ));
        let pending = first.transaction().suspend();
        let mut changed = first.transaction();
        let paragraph = changed.create(Paragraph::default())?;
        changed.append(NodeKey::ROOT, &[paragraph.key()])?;
        changed.commit()?;
        let mut current = first.transaction();
        assert!(matches!(
            current.adopt_foreign_update(pending),
            Err(Error::StaleSuspendedUpdate)
        ));
        assert_eq!(current.view().children_size(NodeKey::ROOT), 1);
        Ok(())
    }

    #[test]
    fn admission_rejects_intervening_writes_without_discarding_them() -> Result<(), Error> {
        let mut editor = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let pending = editor.transaction().suspend();
        let mut current = editor.transaction();
        let paragraph = current.create(Paragraph::default())?;
        current.append(NodeKey::ROOT, &[paragraph.key()])?;
        assert!(matches!(
            current.adopt_foreign_update(pending),
            Err(Error::Invariant("host update target is not pristine"))
        ));
        assert_eq!(current.view().children_size(NodeKey::ROOT), 1);
        Ok(())
    }
    #[test]
    fn inherited_selection_tags_do_not_make_a_fresh_target_dirty() -> Result<(), Error> {
        let mut editor = Editor::builder(EditorMode::Headless)
            .build()
            .expect("editor");
        let mut tx = editor.transaction();
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("original")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.commit()?;
        let mut selection = editor.transaction();
        selection.select_end(text)?;
        selection.add_tag("selection-tag".parse().expect("tag"));
        selection.commit()?;
        let mut staged = editor.transaction();
        staged.text(text)?.set_text_content("edited")?;
        let pending = staged.suspend();
        let mut admitted = editor.transaction();
        admitted.adopt_foreign_update(pending)?;
        let commit = admitted.commit()?;
        assert_eq!(commit.next.root_text_content().as_ref(), "edited");
        assert!(commit.tags.contains(&"selection-tag".parse().expect("tag")));
        Ok(())
    }
}
