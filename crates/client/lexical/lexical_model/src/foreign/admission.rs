//! Compatibility entry point for common staged admission.
use super::*;
impl Transaction<'_> {
    /// Install an unpublished update through the common admission contract.
    pub fn adopt_foreign_update(&mut self, update: PendingUpdate) -> Result<(), Error> {
        self.adopt_staged_update(update)
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
