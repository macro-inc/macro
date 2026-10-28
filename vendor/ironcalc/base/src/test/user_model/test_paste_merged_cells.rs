#![allow(clippy::unwrap_used)]

// Paste and merged cells: the containment rule.
//
// * A merged cell intersecting the paste target must be fully contained in
//   it. A contained merge is removed and replaced by whatever the paste
//   carries (the merge pattern of the copied area, or nothing for plain
//   data); a merge sticking out of the target rejects the paste.
// * Exception: a single-cell paste whose target is the anchor of a merged
//   cell writes the anchor and keeps the merge.
// * The merges of the copied area are matched against the merge list as it
//   was before the paste, so a paste overlapping its own source still
//   recreates every merge.

use bitcode::decode;

use crate::expressions::types::Area;
use crate::test::user_model::util::new_empty_user_model;
use crate::types::MergedCell;
use crate::user_model::history::QueueDiffs;
use crate::UserModel;

fn area(sheet: u32, row: i32, column: i32, width: i32, height: i32) -> Area {
    Area {
        sheet,
        row,
        column,
        width,
        height,
    }
}

fn merged(row: i32, column: i32, width: i32, height: i32) -> MergedCell {
    MergedCell {
        row,
        column,
        width,
        height,
    }
}

// The merged cells of sheet 0, sorted, so the tests don't depend on the order
// the implementation creates them in.
fn merges_sorted(model: &UserModel) -> Vec<MergedCell> {
    let mut merges = model.get_merged_cells(0).unwrap();
    merges.sort_by_key(|m| (m.row, m.column));
    merges
}

fn value(model: &UserModel, row: i32, column: i32) -> String {
    model.get_formatted_cell_value(0, row, column).unwrap()
}

fn assert_history_is_clean(model: &mut UserModel) {
    let queue: Vec<QueueDiffs> = decode(&model.flush_send_queue()).unwrap();
    assert!(queue.is_empty());
}

const PARTIAL_OVERLAP: &str = "Cannot paste: a merged cell partially overlaps the paste area";

// ── Copy-paste ───────────────────────────────────────────────────────────────

#[test]
fn paste_replaces_a_contained_target_merge() {
    let mut model = new_empty_user_model();
    // a plain 2x2 block A1:B2
    model.set_user_input(0, 1, 1, "1").unwrap();
    model.set_user_input(0, 1, 2, "2").unwrap();
    model.set_user_input(0, 2, 1, "3").unwrap();
    model.set_user_input(0, 2, 2, "4").unwrap();
    // target merge D1:D2 with content, fully inside the paste target D1:E2
    model.set_user_input(0, 1, 4, "x").unwrap();
    model.merge_cells(&area(0, 1, 4, 1, 2)).unwrap();

    model.set_selected_range(1, 1, 2, 2).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    model.set_selected_cell(1, 4).unwrap();
    model
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, false)
        .unwrap();

    // the merge is gone and the plain values landed everywhere
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(value(&model, 1, 4), "1");
    assert_eq!(value(&model, 1, 5), "2");
    assert_eq!(value(&model, 2, 4), "3");
    assert_eq!(value(&model, 2, 5), "4");

    // undo restores the merge and its content
    model.undo().unwrap();
    assert_eq!(merges_sorted(&model), vec![merged(1, 4, 1, 2)]);
    assert_eq!(value(&model, 1, 4), "x");
    assert_eq!(value(&model, 1, 5), "");
    assert_eq!(value(&model, 2, 5), "");

    model.redo().unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(value(&model, 1, 4), "1");
}

#[test]
fn paste_a_merged_block_onto_an_identical_merge() {
    let mut model = new_empty_user_model();
    // source merge B2:C3 with "5", target merge E2:F3 with "9"
    model.set_user_input(0, 2, 2, "5").unwrap();
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    model.set_user_input(0, 2, 5, "9").unwrap();
    model.merge_cells(&area(0, 2, 5, 2, 2)).unwrap();

    model.set_selected_cell(2, 2).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    model.set_selected_cell(2, 5).unwrap();
    model
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, false)
        .unwrap();

    // the target merge was replaced by the identical pasted one
    assert_eq!(
        merges_sorted(&model),
        vec![merged(2, 2, 2, 2), merged(2, 5, 2, 2)]
    );
    assert_eq!(value(&model, 2, 5), "5");

    model.undo().unwrap();
    assert_eq!(
        merges_sorted(&model),
        vec![merged(2, 2, 2, 2), merged(2, 5, 2, 2)]
    );
    assert_eq!(value(&model, 2, 5), "9");

    model.redo().unwrap();
    assert_eq!(value(&model, 2, 5), "5");
}

#[test]
fn paste_a_merged_block_onto_itself_is_a_no_op_paste() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "5").unwrap();
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    // copy the merged cell and paste it back in place
    model.set_selected_cell(2, 2).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    model
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, false)
        .unwrap();

    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model, 2, 2), "5");

    model.undo().unwrap();
    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model, 2, 2), "5");
}

#[test]
fn paste_partially_overlapping_a_merge_is_rejected() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "1").unwrap();
    model.set_user_input(0, 1, 2, "2").unwrap();
    // merge E1:E2 sticks out of the paste target D1:E1
    model.merge_cells(&area(0, 1, 5, 1, 2)).unwrap();

    model.set_selected_range(1, 1, 1, 2).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    model.set_selected_cell(1, 4).unwrap();
    model.flush_send_queue();

    assert_eq!(
        model.paste_from_clipboard(0, clipboard.range, &clipboard.data, false),
        Err(PARTIAL_OVERLAP.to_string())
    );
    // the model is untouched and the history is clean
    assert_eq!(merges_sorted(&model), vec![merged(1, 5, 1, 2)]);
    assert_eq!(value(&model, 1, 4), "");
    assert_history_is_clean(&mut model);
}

#[test]
fn paste_single_cell_into_a_merged_cell_keeps_the_merge() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "42").unwrap();
    // merge B2:C3 with "x"
    model.set_user_input(0, 2, 2, "x").unwrap();
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    model.set_selected_cell(1, 1).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    // selecting the merged cell puts the anchor B2 in the view
    model.set_selected_cell(2, 2).unwrap();
    model
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, false)
        .unwrap();

    // the merge survives and the anchor got the pasted value
    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model, 2, 2), "42");

    model.undo().unwrap();
    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model, 2, 2), "x");

    model.redo().unwrap();
    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model, 2, 2), "42");
}

#[test]
fn cut_paste_single_cell_into_a_merged_cell_keeps_the_merge() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "42").unwrap();
    // merge B2:C3
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    model.set_selected_cell(1, 1).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    model.set_selected_cell(2, 2).unwrap();
    model
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, true)
        .unwrap();

    // the value moved into the merged cell's anchor and the source is empty
    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model, 2, 2), "42");
    assert_eq!(value(&model, 1, 1), "");

    model.undo().unwrap();
    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model, 2, 2), "");
    assert_eq!(value(&model, 1, 1), "42");
}

// ── Cut-paste ────────────────────────────────────────────────────────────────

#[test]
fn cut_paste_replaces_a_contained_target_merge() {
    let mut model = new_empty_user_model();
    // source merge B2:C3 with "5", target merge E2:F3 with "9"
    model.set_user_input(0, 2, 2, "5").unwrap();
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    model.set_user_input(0, 2, 5, "9").unwrap();
    model.merge_cells(&area(0, 2, 5, 2, 2)).unwrap();

    model.set_selected_cell(2, 2).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    model.set_selected_cell(2, 5).unwrap();
    model
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, true)
        .unwrap();

    // the merge moved onto the replaced target: gone from the source
    assert_eq!(merges_sorted(&model), vec![merged(2, 5, 2, 2)]);
    assert_eq!(value(&model, 2, 5), "5");
    assert_eq!(value(&model, 2, 2), "");

    // undo restores both merges and both contents
    model.undo().unwrap();
    assert_eq!(
        merges_sorted(&model),
        vec![merged(2, 2, 2, 2), merged(2, 5, 2, 2)]
    );
    assert_eq!(value(&model, 2, 2), "5");
    assert_eq!(value(&model, 2, 5), "9");

    model.redo().unwrap();
    assert_eq!(merges_sorted(&model), vec![merged(2, 5, 2, 2)]);
    assert_eq!(value(&model, 2, 5), "5");
}

// ── Paste overlapping its own source ─────────────────────────────────────────

#[test]
fn paste_overlapping_the_source_recreates_all_merges() {
    let mut model = new_empty_user_model();
    // two stacked merges: A1:A2 with "a", A3:A4 with "b"
    model.set_user_input(0, 1, 1, "a").unwrap();
    model.merge_cells(&area(0, 1, 1, 1, 2)).unwrap();
    model.set_user_input(0, 3, 1, "b").unwrap();
    model.merge_cells(&area(0, 3, 1, 1, 2)).unwrap();

    // copy A1:A4 and paste it at A3: the target overlaps the copied area, and
    // the merge A3:A4 is both a source merge and a replaced target merge
    model.set_selected_range(1, 1, 4, 1).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    model.set_selected_cell(3, 1).unwrap();
    model
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, false)
        .unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![merged(1, 1, 1, 2), merged(3, 1, 1, 2), merged(5, 1, 1, 2)]
    );
    assert_eq!(value(&model, 1, 1), "a");
    assert_eq!(value(&model, 3, 1), "a");
    assert_eq!(value(&model, 5, 1), "b");

    model.undo().unwrap();
    assert_eq!(
        merges_sorted(&model),
        vec![merged(1, 1, 1, 2), merged(3, 1, 1, 2)]
    );
    assert_eq!(value(&model, 3, 1), "b");
    assert_eq!(value(&model, 5, 1), "");
}

// ── External replay ──────────────────────────────────────────────────────────

#[test]
fn paste_over_a_merge_replays_on_external_models() {
    let mut model1 = new_empty_user_model();
    let mut model2 = new_empty_user_model();

    // like paste_replaces_a_contained_target_merge, replayed on model2: the
    // unmerge diff must come before the cell writes for the replay to work
    model1.set_user_input(0, 1, 1, "1").unwrap();
    model1.set_user_input(0, 2, 1, "3").unwrap();
    model1.set_user_input(0, 1, 4, "x").unwrap();
    model1.merge_cells(&area(0, 1, 4, 1, 2)).unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();

    model1.set_selected_range(1, 1, 2, 1).unwrap();
    let clipboard = model1.copy_to_clipboard().unwrap();
    model1.set_selected_cell(1, 4).unwrap();
    model1
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, false)
        .unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();

    assert!(model2.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(value(&model2, 1, 4), "1");
    assert_eq!(value(&model2, 2, 4), "3");

    // the undo also replays
    model1.undo().unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();
    assert_eq!(merges_sorted(&model2), vec![merged(1, 4, 1, 2)]);
    assert_eq!(value(&model2, 1, 4), "x");
}

// ── CSV (external text) paste ────────────────────────────────────────────────

#[test]
fn paste_csv_replaces_a_contained_target_merge() {
    let mut model = new_empty_user_model();
    // merge A2:B3 with "x", exactly the extent of the pasted text
    model.set_user_input(0, 2, 1, "x").unwrap();
    model.merge_cells(&area(0, 2, 1, 2, 2)).unwrap();

    model.set_selected_cell(2, 1).unwrap();
    model
        .paste_csv_string(&area(0, 2, 1, 1, 1), "1\t2\n3\t4")
        .unwrap();

    // plain text carries no merges: the target merge is simply gone
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(value(&model, 2, 1), "1");
    assert_eq!(value(&model, 2, 2), "2");
    assert_eq!(value(&model, 3, 1), "3");
    assert_eq!(value(&model, 3, 2), "4");

    model.undo().unwrap();
    assert_eq!(merges_sorted(&model), vec![merged(2, 1, 2, 2)]);
    assert_eq!(value(&model, 2, 1), "x");
    assert_eq!(value(&model, 3, 2), "");

    model.redo().unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(value(&model, 2, 1), "1");
}

#[test]
fn paste_csv_partially_overlapping_a_merge_is_rejected() {
    let mut model = new_empty_user_model();
    // merge B2:C3 sticks out of the paste target A1:B2
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    model.flush_send_queue();

    assert_eq!(
        model.paste_csv_string(&area(0, 1, 1, 1, 1), "1\t2\n3\t4"),
        Err(PARTIAL_OVERLAP.to_string())
    );
    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model, 1, 1), "");
    assert_history_is_clean(&mut model);
}

#[test]
fn paste_csv_single_value_into_a_merged_cell_keeps_the_merge() {
    let mut model = new_empty_user_model();
    // merge B2:C3 with "x"
    model.set_user_input(0, 2, 2, "x").unwrap();
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    // paste a single value at the anchor
    model.set_selected_cell(2, 2).unwrap();
    model.paste_csv_string(&area(0, 2, 2, 1, 1), "42").unwrap();

    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model, 2, 2), "42");

    model.undo().unwrap();
    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model, 2, 2), "x");
}

#[test]
fn paste_csv_over_a_merge_replays_on_external_models() {
    let mut model1 = new_empty_user_model();
    let mut model2 = new_empty_user_model();

    model1.set_user_input(0, 2, 1, "x").unwrap();
    model1.merge_cells(&area(0, 2, 1, 2, 2)).unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();

    model1.set_selected_cell(2, 1).unwrap();
    model1
        .paste_csv_string(&area(0, 2, 1, 1, 1), "1\t2\n3\t4")
        .unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();

    assert!(model2.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(value(&model2, 2, 1), "1");
    assert_eq!(value(&model2, 3, 2), "4");

    // the undo also replays
    model1.undo().unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();
    assert_eq!(merges_sorted(&model2), vec![merged(2, 1, 2, 2)]);
    assert_eq!(value(&model2, 2, 1), "x");
}
