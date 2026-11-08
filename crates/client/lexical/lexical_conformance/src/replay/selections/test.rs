use super::*;
use lexical_model::*;

#[test]
fn peer_slots_and_activation_are_independent_while_object_ids_and_values_are_shared() -> Result<()>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let text = tx.create_text("text")?.key();
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    let parent = SelectionBindings::default();
    let identity = tx
        .foreign_selection_identity(SelectionSlot::Active)
        .expect("active identity");
    let active = parent.push(SelectionSlot::Active, identity)?;
    parent.set_active(Some(active))?;
    let activation = parent.active()?;
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    let committed = tx.committed_state().clone();
    let unrelated = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
        text,
        Utf16Offset(2),
    ))));
    let identity = tx
        .foreign_selection_identity(unrelated)
        .expect("detached identity");
    let unrelated_id = parent.push(unrelated, identity)?;
    assert_eq!(unrelated_id, 1);
    let peer = SelectionBindings {
        objects: parent.objects.clone(),
        frame: Arc::new(Mutex::new(Frame::default())),
    };
    let (created, peer_slot) =
        snapshot.with_read_transaction(&committed, |read| -> Result<_> {
            assert_eq!(peer.resolve(read, active)?, Some(SelectionSlot::Active));
            peer.set_active(Some(active))?;
            peer.set_active(None)?;
            assert_eq!(parent.active()?, activation);
            let slot = read.detach_selection(Selection::Range(RangeSelection::collapsed(
                Point::text(text, Utf16Offset(3)),
            )));
            assert_eq!(slot, unrelated);
            let identity = read
                .foreign_selection_identity(slot)
                .expect("peer identity");
            let id = peer.push(slot, identity)?;
            assert_eq!(id, 2);
            let value = read
                .selection_at(slot)?
                .map(Selection::snapshot_for_foreign_read);
            peer.save_value(id, value)?;
            peer.synchronize(read)?;
            assert_eq!(parent.try_slot(unrelated_id)?, Some(unrelated));
            assert_eq!(parent.try_slot(id)?, None);
            Ok((id, slot))
        })??;
    assert_eq!(parent.active()?, activation);
    let hydrated = parent.resolve(&mut tx, created)?.expect("hydrated value");
    assert_ne!(hydrated, peer_slot);
    assert_eq!(tx.anchor_at(hydrated)?.offset(), 3);
    assert_eq!(tx.anchor_at(unrelated)?.offset(), 2);
    assert_eq!(parent.resolve(&mut tx, created)?, Some(hydrated));
    assert_eq!(parent.resolve(&mut tx, 9999)?, None);
    let last = tx.detach_selection(Selection::Range(RangeSelection::collapsed(Point::text(
        text,
        Utf16Offset(4),
    ))));
    let identity = tx.foreign_selection_identity(last).expect("last identity");
    assert_eq!(parent.push(last, identity)?, 3);
    Ok(())
}
