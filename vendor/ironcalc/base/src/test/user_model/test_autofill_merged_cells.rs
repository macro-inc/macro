#![allow(clippy::unwrap_used)]

// Autofill and merged cells.
//
// The rules under test:
//
// * Containment: an existing merged cell intersecting the source area or the
//   fill target must be fully contained in it; otherwise the fill is rejected.
// * The merged cells of the source are tiled into the fill target, together
//   with the values, styles and links of the source pattern. Merged cells
//   fully contained in the target are removed first (replaced by the tiled
//   pattern).
// * The fill boundary must not cut a tiled merge: a partial last tile is
//   valid only when every merge it contains fits whole.
// * Value progressions are detected over the non-covered cells of the source
//   and land on the non-covered cells of the target (covered cells stay
//   empty).

use bitcode::decode;

use crate::expressions::types::Area;
use crate::test::user_model::util::new_empty_user_model;
use crate::types::{BorderItem, BorderStyle, Color, Link, MergedCell};
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

const PARTIAL_OVERLAP: &str = "Cannot auto-fill: a merged cell partially overlaps the fill area";
const CUT_MERGE: &str = "Cannot auto-fill: the fill size must fit whole merged cells";

// ── Replicating the source pattern ───────────────────────────────────────────

#[test]
fn fill_down_replicates_the_merge_pattern() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "hello").unwrap();
    // merge B2:C3
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    // fill B2:C3 down to row 7: two tiles, B4:C5 and B6:C7
    model.auto_fill_rows(&area(0, 2, 2, 2, 2), 7).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![merged(2, 2, 2, 2), merged(4, 2, 2, 2), merged(6, 2, 2, 2)]
    );
    assert_eq!(value(&model, 4, 2), "hello");
    assert_eq!(value(&model, 6, 2), "hello");
    // covered cells of the new tiles are empty
    assert_eq!(value(&model, 4, 3), "");
    assert_eq!(value(&model, 5, 2), "");
    assert_eq!(value(&model, 7, 3), "");
}

#[test]
fn fill_up_replicates_the_merge_pattern() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 5, 2, "x").unwrap();
    // merge B5:B6
    model.merge_cells(&area(0, 5, 2, 1, 2)).unwrap();

    // fill B5:B6 up to row 1: two tiles, B3:B4 and B1:B2
    model.auto_fill_rows(&area(0, 5, 2, 1, 2), 1).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![merged(1, 2, 1, 2), merged(3, 2, 1, 2), merged(5, 2, 1, 2)]
    );
    assert_eq!(value(&model, 1, 2), "x");
    assert_eq!(value(&model, 3, 2), "x");
    assert_eq!(value(&model, 2, 2), "");
    assert_eq!(value(&model, 4, 2), "");
}

#[test]
fn fill_right_replicates_the_merge_pattern() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "hi").unwrap();
    // merge B2:C3
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    // fill B2:C3 right to column 7: two tiles, D2:E3 and F2:G3
    model.auto_fill_columns(&area(0, 2, 2, 2, 2), 7).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![merged(2, 2, 2, 2), merged(2, 4, 2, 2), merged(2, 6, 2, 2)]
    );
    assert_eq!(value(&model, 2, 4), "hi");
    assert_eq!(value(&model, 2, 6), "hi");
    assert_eq!(value(&model, 3, 4), "");
    assert_eq!(value(&model, 2, 5), "");
}

#[test]
fn fill_left_replicates_the_merge_pattern() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 5, "z").unwrap();
    // merge E1:F1
    model.merge_cells(&area(0, 1, 5, 2, 1)).unwrap();

    // fill E1:F1 left to column 1: two tiles, C1:D1 and A1:B1
    model.auto_fill_columns(&area(0, 1, 5, 2, 1), 1).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![merged(1, 1, 2, 1), merged(1, 3, 2, 1), merged(1, 5, 2, 1)]
    );
    assert_eq!(value(&model, 1, 1), "z");
    assert_eq!(value(&model, 1, 3), "z");
    assert_eq!(value(&model, 1, 2), "");
    assert_eq!(value(&model, 1, 4), "");
}

#[test]
fn fill_right_tiles_a_vertical_merge_sideways() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "v").unwrap();
    // merge A1:A2, one column wide
    model.merge_cells(&area(0, 1, 1, 1, 2)).unwrap();

    // fill A1:A2 right to column 3: each new column gets its own 1x2 merge
    model.auto_fill_columns(&area(0, 1, 1, 1, 2), 3).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![merged(1, 1, 1, 2), merged(1, 2, 1, 2), merged(1, 3, 1, 2)]
    );
    assert_eq!(value(&model, 1, 2), "v");
    assert_eq!(value(&model, 1, 3), "v");
    assert_eq!(value(&model, 2, 2), "");
    assert_eq!(value(&model, 2, 3), "");
}

#[test]
fn fill_down_mixes_merged_and_plain_rows() {
    let mut model = new_empty_user_model();
    // pattern: A1:A2 merged with "a", A3 plain with "b"
    model.set_user_input(0, 1, 1, "a").unwrap();
    model.merge_cells(&area(0, 1, 1, 1, 2)).unwrap();
    model.set_user_input(0, 3, 1, "b").unwrap();

    // fill A1:A3 down to row 8: a full tile (rows 4-6) plus a partial tile
    // (rows 7-8) that contains the whole merge, so it is allowed
    model.auto_fill_rows(&area(0, 1, 1, 1, 3), 8).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![merged(1, 1, 1, 2), merged(4, 1, 1, 2), merged(7, 1, 1, 2)]
    );
    assert_eq!(value(&model, 4, 1), "a");
    assert_eq!(value(&model, 6, 1), "b");
    assert_eq!(value(&model, 7, 1), "a");
    assert_eq!(value(&model, 5, 1), "");
    assert_eq!(value(&model, 8, 1), "");
}

// ── Value progressions ───────────────────────────────────────────────────────

#[test]
fn fill_down_continues_a_progression_across_merged_anchors() {
    let mut model = new_empty_user_model();
    // A1:A2 merged with 1, A3:A4 merged with 2
    model.set_user_input(0, 1, 1, "1").unwrap();
    model.merge_cells(&area(0, 1, 1, 1, 2)).unwrap();
    model.set_user_input(0, 3, 1, "2").unwrap();
    model.merge_cells(&area(0, 3, 1, 1, 2)).unwrap();

    // fill A1:A4 down to row 8: the progression continues on the new anchors
    model.auto_fill_rows(&area(0, 1, 1, 1, 4), 8).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![
            merged(1, 1, 1, 2),
            merged(3, 1, 1, 2),
            merged(5, 1, 1, 2),
            merged(7, 1, 1, 2)
        ]
    );
    assert_eq!(value(&model, 5, 1), "3");
    assert_eq!(value(&model, 7, 1), "4");
    assert_eq!(value(&model, 6, 1), "");
    assert_eq!(value(&model, 8, 1), "");
}

#[test]
fn fill_right_continues_a_progression_across_merged_anchors() {
    let mut model = new_empty_user_model();
    // B1:C1 merged with 1, D1:E1 merged with 2
    model.set_user_input(0, 1, 2, "1").unwrap();
    model.merge_cells(&area(0, 1, 2, 2, 1)).unwrap();
    model.set_user_input(0, 1, 4, "2").unwrap();
    model.merge_cells(&area(0, 1, 4, 2, 1)).unwrap();

    // fill B1:E1 right to column 9: the progression continues on the new anchors
    model.auto_fill_columns(&area(0, 1, 2, 4, 1), 9).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![
            merged(1, 2, 2, 1),
            merged(1, 4, 2, 1),
            merged(1, 6, 2, 1),
            merged(1, 8, 2, 1)
        ]
    );
    assert_eq!(value(&model, 1, 6), "3");
    assert_eq!(value(&model, 1, 8), "4");
    assert_eq!(value(&model, 1, 7), "");
    assert_eq!(value(&model, 1, 9), "");
}

// ── Merges already in the fill target ────────────────────────────────────────

#[test]
fn fill_down_from_a_plain_source_unmerges_a_contained_target_merge() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "x").unwrap();
    // target merge A2:A3 with "b"
    model.set_user_input(0, 2, 1, "b").unwrap();
    model.merge_cells(&area(0, 2, 1, 1, 2)).unwrap();

    // fill plain A1 down to row 5: the merge is fully inside the target, so
    // it is unmerged and plain values land everywhere
    model.auto_fill_rows(&area(0, 1, 1, 1, 1), 5).unwrap();

    assert!(model.get_merged_cells(0).unwrap().is_empty());
    for row in 2..=5 {
        assert_eq!(value(&model, row, 1), "x");
    }

    // undo restores the merge and its content
    model.undo().unwrap();
    assert_eq!(merges_sorted(&model), vec![merged(2, 1, 1, 2)]);
    assert_eq!(value(&model, 2, 1), "b");
    assert_eq!(value(&model, 4, 1), "");
    assert_eq!(value(&model, 5, 1), "");

    model.redo().unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(value(&model, 2, 1), "x");
}

#[test]
fn fill_down_replaces_a_target_merge_of_the_same_shape() {
    let mut model = new_empty_user_model();
    // source merge A1:A2 with "a", target merge A3:A4 with "b"
    model.set_user_input(0, 1, 1, "a").unwrap();
    model.merge_cells(&area(0, 1, 1, 1, 2)).unwrap();
    model.set_user_input(0, 3, 1, "b").unwrap();
    model.merge_cells(&area(0, 3, 1, 1, 2)).unwrap();

    model.auto_fill_rows(&area(0, 1, 1, 1, 2), 4).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![merged(1, 1, 1, 2), merged(3, 1, 1, 2)]
    );
    assert_eq!(value(&model, 3, 1), "a");
    assert_eq!(value(&model, 4, 1), "");

    model.undo().unwrap();
    assert_eq!(
        merges_sorted(&model),
        vec![merged(1, 1, 1, 2), merged(3, 1, 1, 2)]
    );
    assert_eq!(value(&model, 3, 1), "b");

    model.redo().unwrap();
    assert_eq!(value(&model, 3, 1), "a");
}

#[test]
fn fill_down_replaces_a_target_merge_of_a_different_shape() {
    let mut model = new_empty_user_model();
    // source merge A1:B1 (wide), target merge A3:A4 (tall) with "b"
    model.set_user_input(0, 1, 1, "a").unwrap();
    model.merge_cells(&area(0, 1, 1, 2, 1)).unwrap();
    model.set_user_input(0, 3, 1, "b").unwrap();
    model.merge_cells(&area(0, 3, 1, 1, 2)).unwrap();

    // fill A1:B1 down to row 4: the tall merge is fully inside the target
    // (rows 2-4, columns A-B contain A3:A4) and is replaced by wide tiles
    model.auto_fill_rows(&area(0, 1, 1, 2, 1), 4).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![
            merged(1, 1, 2, 1),
            merged(2, 1, 2, 1),
            merged(3, 1, 2, 1),
            merged(4, 1, 2, 1)
        ]
    );
    assert_eq!(value(&model, 2, 1), "a");
    assert_eq!(value(&model, 3, 1), "a");
    assert_eq!(value(&model, 4, 1), "a");
}

#[test]
fn fill_down_clears_content_covered_by_a_new_tile_and_undo_restores_it() {
    let mut model = new_empty_user_model();
    // source merge A1:A2 with "x"; plain content at A6
    model.set_user_input(0, 1, 1, "x").unwrap();
    model.merge_cells(&area(0, 1, 1, 1, 2)).unwrap();
    model.set_user_input(0, 6, 1, "old").unwrap();

    // fill down to row 6: tiles A3:A4 and A5:A6; A6 becomes a covered cell
    model.auto_fill_rows(&area(0, 1, 1, 1, 2), 6).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![merged(1, 1, 1, 2), merged(3, 1, 1, 2), merged(5, 1, 1, 2)]
    );
    assert_eq!(value(&model, 5, 1), "x");
    assert_eq!(value(&model, 6, 1), "");

    model.undo().unwrap();
    assert_eq!(merges_sorted(&model), vec![merged(1, 1, 1, 2)]);
    assert_eq!(value(&model, 6, 1), "old");
    assert_eq!(value(&model, 3, 1), "");
    assert_eq!(value(&model, 5, 1), "");

    model.redo().unwrap();
    assert_eq!(
        merges_sorted(&model),
        vec![merged(1, 1, 1, 2), merged(3, 1, 1, 2), merged(5, 1, 1, 2)]
    );
    assert_eq!(value(&model, 6, 1), "");
}

// ── Rejections ───────────────────────────────────────────────────────────────

#[test]
fn fill_extent_cutting_a_source_merge_tile_is_rejected() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "x").unwrap();
    // merge A1:A2
    model.merge_cells(&area(0, 1, 1, 1, 2)).unwrap();
    model.flush_send_queue();

    // one target row: the 2-tall tile does not fit
    assert_eq!(
        model.auto_fill_rows(&area(0, 1, 1, 1, 2), 3),
        Err(CUT_MERGE.to_string())
    );
    assert_eq!(merges_sorted(&model), vec![merged(1, 1, 1, 2)]);
    assert_eq!(value(&model, 3, 1), "");
    assert_history_is_clean(&mut model);
}

#[test]
fn fill_extent_cutting_a_partial_tile_merge_is_rejected() {
    let mut model = new_empty_user_model();
    // pattern: A1:A2 merged, A3 plain
    model.set_user_input(0, 1, 1, "a").unwrap();
    model.merge_cells(&area(0, 1, 1, 1, 2)).unwrap();
    model.set_user_input(0, 3, 1, "b").unwrap();
    model.flush_send_queue();

    // fill to row 7: a full tile (rows 4-6) plus a partial tile of one row,
    // which cuts the 2-tall merge of the pattern
    assert_eq!(
        model.auto_fill_rows(&area(0, 1, 1, 1, 3), 7),
        Err(CUT_MERGE.to_string())
    );
    assert_eq!(merges_sorted(&model), vec![merged(1, 1, 1, 2)]);
    assert_history_is_clean(&mut model);
}

#[test]
fn fill_columns_extent_cutting_a_source_merge_tile_is_rejected() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 2, "x").unwrap();
    // merge B1:C1
    model.merge_cells(&area(0, 1, 2, 2, 1)).unwrap();
    model.flush_send_queue();

    // one target column: the 2-wide tile does not fit
    assert_eq!(
        model.auto_fill_columns(&area(0, 1, 2, 2, 1), 4),
        Err(CUT_MERGE.to_string())
    );
    assert_eq!(merges_sorted(&model), vec![merged(1, 2, 2, 1)]);
    assert_history_is_clean(&mut model);
}

#[test]
fn fill_over_a_partially_overlapping_target_merge_is_rejected() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "x").unwrap();
    // merge A4:B5 sticks out of the fill target (rows 2-4, column A)
    model.merge_cells(&area(0, 4, 1, 2, 2)).unwrap();
    model.flush_send_queue();

    assert_eq!(
        model.auto_fill_rows(&area(0, 1, 1, 1, 1), 4),
        Err(PARTIAL_OVERLAP.to_string())
    );
    assert_eq!(merges_sorted(&model), vec![merged(4, 1, 2, 2)]);
    assert_eq!(value(&model, 2, 1), "");
    assert_history_is_clean(&mut model);
}

#[test]
fn fill_from_a_source_partially_covering_a_merge_is_rejected() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "x").unwrap();
    // merge B2:C3
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    model.flush_send_queue();

    // the source B2:B3 covers only the left half of the merge (the UI cannot
    // produce this selection; the API guards against it)
    assert_eq!(
        model.auto_fill_rows(&area(0, 2, 2, 1, 2), 7),
        Err(PARTIAL_OVERLAP.to_string())
    );
    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_history_is_clean(&mut model);
}

// ── Styles, borders and links ────────────────────────────────────────────────

fn thin(color: &str) -> Option<BorderItem> {
    Some(BorderItem {
        style: BorderStyle::Thin,
        color: Color::Rgb(color.to_string()),
    })
}

#[test]
fn fill_down_replicates_the_perimeter_borders_of_a_merged_cell() {
    let mut model = new_empty_user_model();
    // outline on B2, then merge B2:C3: the outline wraps the whole merged
    // cell, so its bottom/right sides live on non-anchor cells
    model._set_cell_border("B2", "#111111");
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    // fill down to row 5: one tile, B4:C5
    model.auto_fill_rows(&area(0, 2, 2, 2, 2), 5).unwrap();

    // the tile keeps the full outline, including the sides that are not on
    // its anchor
    let b4 = model._get_cell_border("B4");
    assert_eq!(b4.left, thin("#111111"));
    assert_eq!(b4.top, thin("#111111"));
    assert_eq!([b4.right, b4.bottom], [None, None]);
    let c4 = model._get_cell_border("C4");
    assert_eq!(c4.top, thin("#111111"));
    assert_eq!(c4.right, thin("#111111"));
    assert_eq!([c4.left, c4.bottom], [None, None]);
    let b5 = model._get_cell_border("B5");
    assert_eq!(b5.left, thin("#111111"));
    assert_eq!(b5.bottom, thin("#111111"));
    assert_eq!([b5.right, b5.top], [None, None]);
    let c5 = model._get_cell_border("C5");
    assert_eq!(c5.right, thin("#111111"));
    assert_eq!(c5.bottom, thin("#111111"));
    assert_eq!([c5.left, c5.top], [None, None]);
}

#[test]
fn fill_down_replicates_the_fill_color_of_covered_cells() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "x").unwrap();
    model.merge_cells(&area(0, 1, 1, 1, 2)).unwrap();
    model
        .update_range_style(&area(0, 1, 1, 1, 2), "fill.color", "#FF0000")
        .unwrap();

    model.auto_fill_rows(&area(0, 1, 1, 1, 2), 4).unwrap();

    // both cells of the new tile carry the fill color
    assert_eq!(
        model.get_cell_style(0, 3, 1).unwrap().fill.color,
        Color::Rgb("#FF0000".to_string())
    );
    assert_eq!(
        model.get_cell_style(0, 4, 1).unwrap().fill.color,
        Color::Rgb("#FF0000".to_string())
    );
}

#[test]
fn fill_down_replicates_the_anchor_link() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "ironcalc").unwrap();
    let link = Link::External {
        target: "https://www.ironcalc.com".to_string(),
        tooltip: None,
    };
    model.set_cell_link(0, 1, 1, link.clone(), None).unwrap();
    // merge A1:B1
    model.merge_cells(&area(0, 1, 1, 2, 1)).unwrap();

    // fill down to row 2: one tile, A2:B2
    model.auto_fill_rows(&area(0, 1, 1, 2, 1), 2).unwrap();

    assert_eq!(
        merges_sorted(&model),
        vec![merged(1, 1, 2, 1), merged(2, 1, 2, 1)]
    );
    assert_eq!(value(&model, 2, 1), "ironcalc");
    assert_eq!(model.get_cell_link(0, 2, 1), Ok(Some(link)));
}

// ── Undo, redo and external replay ───────────────────────────────────────────

#[test]
fn fill_down_undo_redo_restores_the_merge_pattern() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "hello").unwrap();
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    model.auto_fill_rows(&area(0, 2, 2, 2, 2), 7).unwrap();

    model.undo().unwrap();
    assert_eq!(merges_sorted(&model), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model, 4, 2), "");
    assert_eq!(value(&model, 6, 2), "");
    assert_eq!(value(&model, 2, 2), "hello");

    model.redo().unwrap();
    assert_eq!(
        merges_sorted(&model),
        vec![merged(2, 2, 2, 2), merged(4, 2, 2, 2), merged(6, 2, 2, 2)]
    );
    assert_eq!(value(&model, 4, 2), "hello");
    assert_eq!(value(&model, 6, 2), "hello");
}

#[test]
fn fill_down_replays_on_external_models() {
    let mut model1 = new_empty_user_model();
    let mut model2 = new_empty_user_model();

    model1.set_user_input(0, 2, 2, "hello").unwrap();
    model1.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    model1.auto_fill_rows(&area(0, 2, 2, 2, 2), 7).unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();

    assert_eq!(merges_sorted(&model2), merges_sorted(&model1));
    assert_eq!(value(&model2, 4, 2), "hello");
    assert_eq!(value(&model2, 6, 2), "hello");

    // the undo also replays
    model1.undo().unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();
    assert_eq!(merges_sorted(&model2), vec![merged(2, 2, 2, 2)]);
    assert_eq!(value(&model2, 4, 2), "");
}
