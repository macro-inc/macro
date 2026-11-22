use super::super::selection_values::{Origin, SelectionValues};
use super::*;
use lexical_model::{
    Editor, EditorMode, NodeKey, Paragraph, Point, RangeSelection, Selection, Utf16Offset,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn value(selection: Selection) -> Result<SelectionValue, BoundaryError> {
    let mut values = SelectionValues::new(1);
    let reference = values.allocate(selection, 7, 9)?;
    values.get(reference)
}
fn range(key: NodeKey, anchor: u32, focus: u32) -> Selection {
    Selection::Range(RangeSelection::new(
        Point::Text {
            key,
            offset: Utf16Offset(anchor),
        },
        Point::Text {
            key,
            offset: Utf16Offset(focus),
        },
    ))
}
fn string(text: &str) -> compat::ForeignCallbackValue {
    compat::ForeignCallbackValue::ForeignStringArgument {
        value: text.encode_utf16().collect(),
    }
}

#[test]
fn current_query_hydrates_the_latest_owned_value_without_replacing_active() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("abcdef")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.set_selection(Some(range(text.key(), 0, 0)))?;
    let active = tx.foreign_selection_identity(SelectionSlot::Active);
    let mut owned = value(range(text.key(), 1, 2))?;
    let stale = tx.detach_foreign_selection(
        owned.value.snapshot_for_foreign_read(),
        owned.identity.clone(),
    );
    owned.value = range(text.key(), 2, 5);
    owned.cached_nodes = Some(vec![]);
    let reference = owned.reference;
    let execution = execute(
        &mut tx,
        owned,
        false,
        compat::CompatOperation::SelectionGetTextContent,
        &[],
    )?;
    let SelectionOpResult::Scalar(compat::ForeignCallbackValue::ForeignStringArgument { value }) =
        execution.result?
    else {
        panic!("expected text")
    };
    assert_eq!(String::from_utf16(&value)?, "cde");
    assert_eq!(tx.anchor_at(stale)?.offset(), 2);
    assert_eq!(tx.focus_at(stale)?.offset(), 5);
    assert_eq!(tx.anchor()?.offset(), 0);
    assert_eq!(execution.active_identity, active);
    assert!(!execution.value_is_active);
    assert!(!execution.writes_graph);
    assert_eq!(execution.value.reference, reference);
    assert_eq!(execution.value.cached_nodes, Some(vec![]));
    Ok(())
}

#[test]
fn historical_query_uses_fresh_detached_raw_data_and_preserves_the_source_slot() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("abcdef")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.set_selection(Some(range(text.key(), 0, 0)))?;
    tx.commit()?;
    let mut tx = editor.transaction();
    let mut owned = value(range(text.key(), 1, 2))?;
    let stale = tx.detach_foreign_selection(
        owned.value.snapshot_for_foreign_read(),
        owned.identity.clone(),
    );
    owned.value = range(text.key(), 2, 5).with_foreign_value_metadata(false, None);
    owned.cached_nodes = Some(vec![]);
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    let committed = tx.committed_state().clone();
    snapshot.with_read_transaction(&committed, |peer| -> TestResult {
        let active = peer.foreign_selection_identity(SelectionSlot::Active);
        let execution = execute(
            peer,
            owned,
            true,
            compat::CompatOperation::SelectionGetTextContent,
            &[],
        )?;
        let SelectionOpResult::Scalar(compat::ForeignCallbackValue::ForeignStringArgument {
            value,
        }) = execution.result?
        else {
            panic!("expected text")
        };
        assert_eq!(String::from_utf16(&value)?, "cde");
        assert_eq!(peer.anchor_at(stale)?.offset(), 1);
        assert_eq!(peer.focus_at(stale)?.offset(), 2);
        assert_eq!(peer.anchor()?.offset(), 0);
        assert_eq!(execution.active_identity, active);
        assert!(!execution.writes_graph);
        assert!(!execution.value_is_active);
        assert_eq!(execution.value.cached_nodes, Some(vec![]));
        assert_eq!(
            execution
                .value
                .value
                .as_range()
                .and_then(RangeSelection::cached_is_backward),
            None
        );
        Ok(())
    })??;
    Ok(())
}

#[test]
fn active_write_returns_updated_raw_value_and_actual_identity() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("abcdef")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    let mut owned = value(range(text.key(), 2, 4))?;
    let slot = tx.detach_foreign_selection(
        owned.value.snapshot_for_foreign_read(),
        owned.identity.clone(),
    );
    tx.activate_foreign_selection(slot)?;
    owned.origin = Origin::Active { update: 9 };
    owned.cached_nodes = Some(vec![]);
    let identity = owned.identity.clone();
    let execution = execute(
        &mut tx,
        owned,
        false,
        compat::CompatOperation::SelectionInsertText,
        &[string("Ω")],
    )?;
    assert!(matches!(execution.result?, SelectionOpResult::None));
    assert_eq!(tx.view().text_content(NodeKey::ROOT), "abΩef");
    assert!(execution.writes_graph);
    assert!(execution.value_is_active);
    assert_eq!(execution.active_identity, Some(identity.clone()));
    assert_eq!(execution.value.identity, identity);
    assert_eq!(
        execution
            .value
            .value
            .as_range()
            .map(|range| range.anchor.offset()),
        Some(3)
    );
    assert_eq!(execution.value.cached_nodes, None);
    Ok(())
}

#[test]
fn detached_line_break_preserves_pinned_global_and_raw_receiver_points() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let first = tx.create(Paragraph::default())?;
    let active = tx.create_text("active")?;
    let second = tx.create(Paragraph::default())?;
    let detached = tx.create_text("ab")?;
    tx.append(first, &[active.key()])?;
    tx.append(second, &[detached.key()])?;
    tx.append(NodeKey::ROOT, &[first.key(), second.key()])?;
    tx.set_selection(Some(range(active.key(), 2, 2)))?;
    let owned = value(range(detached.key(), 1, 1))?;
    let identity = owned.identity.clone();
    let execution = execute(
        &mut tx,
        owned,
        false,
        compat::CompatOperation::SelectionInsertLineBreak,
        &[compat::ForeignCallbackValue::ForeignBooleanArgument { value: true }],
    )?;
    assert!(matches!(execution.result?, SelectionOpResult::None));
    assert_eq!(tx.view().text_content(second), "ab\n");
    assert_eq!(tx.anchor()?.key(), second.key());
    assert_eq!(tx.anchor()?.offset(), 1);
    assert_eq!(
        execution.value.value.as_range().map(|range| range.anchor),
        Some(Point::text(detached, Utf16Offset(1)))
    );
    assert_eq!(execution.value.identity, identity);
    assert!(!execution.value_is_active);
    assert_eq!(
        execution.active_identity,
        tx.foreign_selection_identity(SelectionSlot::Active)
    );
    Ok(())
}

struct FailingTableHook;
impl lexical_model::TableSelectionHooks for FailingTableHook {
    fn nodes(
        &self,
        _: lexical_model::StateRef<'_>,
        _: &lexical_model::TableSelection,
    ) -> Result<Vec<NodeKey>, lexical_model::Error> {
        Err(lexical_model::Error::Invariant("unexpected table query"))
    }
    fn text_content(
        &self,
        _: lexical_model::StateRef<'_>,
        _: &lexical_model::TableSelection,
    ) -> Result<String, lexical_model::Error> {
        Err(lexical_model::Error::Invariant("unexpected table query"))
    }
    fn insert_nodes(
        &self,
        tx: &mut Transaction<'_>,
        slot: SelectionSlot,
        nodes: &[NodeKey],
    ) -> Result<(), lexical_model::Error> {
        let mut table = tx
            .selection_at(slot)?
            .and_then(Selection::as_table)
            .ok_or(lexical_model::Error::UnsupportedSelection)?;
        table.set(table.table, table.focus.key(), table.anchor.key());
        tx.synchronize_foreign_selection_value(slot, Selection::Table(table))?;
        tx.text(nodes[0])?.set_text_content("changed")?;
        Err(lexical_model::Error::Invariant("table callback failure"))
    }
}
#[test]
fn helper_failure_keeps_partial_callback_changes_and_refreshed_raw_value() -> TestResult {
    use lexical_rich_nodes::table::{TableCellNode, TableNode, TableRowNode};
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<TableNode>()
        .node::<TableRowNode>()
        .node::<TableCellNode>()
        .table_selection_hooks(FailingTableHook)
        .build()?;
    let mut tx = editor.transaction();
    let table = tx.create(TableNode::default())?;
    let row = tx.create(TableRowNode::default())?;
    let first = tx.create(TableCellNode::default())?;
    let second = tx.create(TableCellNode::default())?;
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("before")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(first, &[paragraph.key()])?;
    tx.append(row, &[first.key(), second.key()])?;
    tx.append(table, &[row.key()])?;
    tx.append(NodeKey::ROOT, &[table.key()])?;
    let mut owned = value(Selection::Table(lexical_model::TableSelection::new(
        table.key(),
        first.key(),
        second.key(),
    )))?;
    let slot = tx.detach_foreign_selection(
        owned.value.snapshot_for_foreign_read(),
        owned.identity.clone(),
    );
    tx.activate_foreign_selection(slot)?;
    owned.origin = Origin::Active { update: 9 };
    owned.cached_nodes = Some(vec![]);
    let key = text.key();
    let args = [compat::ForeignCallbackValue::ForeignNodeArrayArgument {
        values: vec![compat::ForeignNodeRef {
            editor_id: 1,
            version: 7,
            key: compat::ForeignKey {
                index: key.index(),
                generation: key.generation(),
            },
            instance_owner_id: 0,
            class_id: 0,
            instance_id: 0,
        }],
    }];
    let execution = execute(
        &mut tx,
        owned,
        false,
        compat::CompatOperation::SelectionInsertNodes,
        &args,
    )?;
    assert!(matches!(
        execution.result,
        Err(BoundaryError::Model(lexical_model::Error::Invariant(
            "table callback failure"
        )))
    ));
    assert_eq!(tx.view().text_content(paragraph), "changed");
    let result = execution.value.value.as_table().ok_or("expected table")?;
    assert_eq!(result.anchor.key(), second.key());
    assert_eq!(result.focus.key(), first.key());
    assert!(result.is_dirty());
    assert!(execution.writes_graph);
    assert_eq!(execution.value.cached_nodes, None);
    assert_eq!(
        execution.active_identity,
        tx.foreign_selection_identity(SelectionSlot::Active)
    );
    Ok(())
}

#[test]
fn current_direction_query_reports_only_memo_metadata_changes() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("abcdef")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.commit()?;
    let mut tx = editor.transaction();
    let mut owned = value(range(text.key(), 4, 1).with_foreign_value_metadata(false, None))?;
    owned.cached_nodes = Some(vec![]);
    let execution = execute(
        &mut tx,
        owned,
        false,
        compat::CompatOperation::SelectionIsBackward,
        &[],
    )?;
    assert!(matches!(
        execution.result?,
        SelectionOpResult::Scalar(compat::ForeignCallbackValue::ForeignBooleanArgument {
            value: true
        })
    ));
    assert!(execution.value_metadata_changed);
    assert!(!execution.writes_graph);
    assert_eq!(
        execution
            .value
            .value
            .as_range()
            .and_then(RangeSelection::cached_is_backward),
        Some(true)
    );
    assert!(!execution.value.value.is_dirty());
    assert_eq!(execution.value.cached_nodes, Some(vec![]));
    assert!(!tx.is_dirty_leaf(text));
    assert!(!tx.is_dirty_element(paragraph));
    assert_eq!(tx.view().text_content(NodeKey::ROOT), "abcdef");
    Ok(())
}

#[test]
fn historical_direction_query_never_populates_returned_memos() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("abcdef")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    tx.commit()?;
    let tx = editor.transaction();
    let mut owned = value(range(text.key(), 4, 1).with_foreign_value_metadata(false, None))?;
    owned.cached_nodes = Some(vec![]);
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    let committed = tx.committed_state().clone();
    snapshot.with_read_transaction(&committed, |peer| -> TestResult {
        let execution = execute(
            peer,
            owned,
            true,
            compat::CompatOperation::SelectionIsBackward,
            &[],
        )?;
        assert!(matches!(
            execution.result?,
            SelectionOpResult::Scalar(compat::ForeignCallbackValue::ForeignBooleanArgument {
                value: true
            })
        ));
        assert!(!execution.value_metadata_changed);
        assert!(!execution.writes_graph);
        assert_eq!(
            execution
                .value
                .value
                .as_range()
                .and_then(RangeSelection::cached_is_backward),
            None
        );
        assert_eq!(execution.value.cached_nodes, Some(vec![]));
        assert!(!execution.value.value.is_dirty());
        assert!(!peer.is_dirty_leaf(text));
        Ok(())
    })??;
    Ok(())
}

#[test]
fn unsupported_operation_fails_before_slot_setup() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let owned = value(Selection::Range(RangeSelection::at_root()))?;
    let identity = owned.identity.clone();
    assert!(tx.foreign_selection_slot(&identity).is_none());
    assert!(matches!(
        execute(
            &mut tx,
            owned,
            false,
            compat::CompatOperation::SetSelection,
            &[]
        ),
        Err(BoundaryError::Invalid("compatibility selection operation"))
    ));
    assert!(tx.foreign_selection_slot(&identity).is_none());
    Ok(())
}

#[test]
fn current_query_never_changes_a_frozen_raw_capture() -> TestResult {
    let mut editor = Editor::builder(EditorMode::Headless).build()?;
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?;
    let text = tx.create_text("abcdef")?;
    tx.append(paragraph, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[paragraph.key()])?;
    let mut owned = value(range(text.key(), 4, 1).with_foreign_value_metadata(false, None))?;
    owned.origin = Origin::Frozen;
    owned.cached_nodes = Some(vec![]);
    let execution = execute(
        &mut tx,
        owned,
        false,
        compat::CompatOperation::SelectionIsBackward,
        &[],
    )?;
    assert!(matches!(
        execution.result?,
        SelectionOpResult::Scalar(compat::ForeignCallbackValue::ForeignBooleanArgument {
            value: true
        })
    ));
    assert!(!execution.value_metadata_changed);
    assert!(!execution.writes_graph);
    assert_eq!(
        execution
            .value
            .value
            .as_range()
            .and_then(RangeSelection::cached_is_backward),
        None
    );
    assert_eq!(execution.value.cached_nodes, Some(vec![]));
    assert!(!execution.value.value.is_dirty());
    Ok(())
}
