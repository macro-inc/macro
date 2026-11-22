//! Owned selection values carry metadata without granting editor authority.
use crate::*;

impl Selection {
    /// Restore raw dirty/direction facts on an owned value, never a model graph.
    pub fn with_foreign_value_metadata(
        mut self,
        dirty: bool,
        cached_backward: Option<bool>,
    ) -> Self {
        self.set_dirty(dirty);
        if let Self::Range(range) = &mut self {
            range.cached_direction =
                cached_backward.map(|backward| (range.anchor, range.focus, backward));
        }
        self
    }
}
impl Transaction<'_> {
    /// Synchronize a writable selection's raw value while preserving its identity.
    /// Historical hosts keep detached values outside this transaction instead.
    pub fn synchronize_foreign_selection_value(
        &mut self,
        slot: SelectionSlot,
        value: Selection,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let existing = self.selection_at(slot)?;
        let same = existing.is_some_and(|existing| {
            let values_equal = match (existing, &value) {
                (Selection::Node(a), Selection::Node(b)) => a.keys().eq(b.keys()),
                _ => existing == &value,
            };
            values_equal && existing.is_dirty() == value.is_dirty()
        });
        if same {
            // Direction memoization changes no semantic value or dirty signal.
            *self.selection_mut_at(slot)? = value;
            return Ok(());
        }
        let raw = value.snapshot_for_foreign_read();
        self.install_selection_at(slot, value)?;
        *self.selection_mut_at(slot)? = raw;
        Ok(())
    }
}
#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn owned_metadata_and_noop_sync_do_not_dirty_the_graph_or_replace_identity() -> Result<(), Error>
    {
        let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
        editor.update(|tx| {
            tx.replace_selection(Some(Selection::Range(RangeSelection::at_root())))?;
            Ok(())
        })?;
        let mut tx = editor.transaction();
        let identity = tx
            .foreign_selection_identity(SelectionSlot::Active)
            .unwrap();
        let value =
            Selection::Range(RangeSelection::at_root()).with_foreign_value_metadata(false, None);
        tx.synchronize_foreign_selection_value(SelectionSlot::Active, value)?;
        tx.flush()?;
        assert!(!tx.has_foreign_effects());
        tx.synchronize_foreign_selection_value(
            SelectionSlot::Active,
            Selection::Range(RangeSelection::at_root())
                .with_foreign_value_metadata(false, Some(false)),
        )?;
        assert_eq!(tx.range_selection()?.cached_is_backward(), Some(false));
        assert!(!tx.has_foreign_effects());
        tx.flush()?;
        assert!(!tx.has_foreign_effects());
        let mut range = RangeSelection::at_root();
        range.format = TextFormat::BOLD;
        tx.synchronize_foreign_selection_value(
            SelectionSlot::Active,
            Selection::Range(range).with_foreign_value_metadata(true, Some(false)),
        )?;
        assert_eq!(
            tx.foreign_selection_identity(SelectionSlot::Active),
            Some(identity)
        );
        assert_eq!(tx.range_selection()?.format, TextFormat::BOLD);
        assert_eq!(tx.range_selection()?.cached_is_backward(), Some(false));
        assert!(tx.has_foreign_effects());
        Ok(())
    }
}
