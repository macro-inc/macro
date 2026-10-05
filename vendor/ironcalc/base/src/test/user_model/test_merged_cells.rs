#![allow(clippy::unwrap_used)]

use bitcode::decode;

use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::types::Area;
use crate::test::user_model::util::new_empty_user_model;
use crate::types::{BorderItem, BorderStyle, Color, HorizontalAlignment, Link, MergedCell};
use crate::user_model::history::{Diff, QueueDiffs};
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

fn last_diff_list(model: &mut UserModel) -> Vec<Diff> {
    let bytes = model.flush_send_queue();
    let queue: Vec<QueueDiffs> = decode(&bytes).unwrap();
    queue.last().unwrap().list.clone()
}

#[test]
fn merge_undo_redo() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "5").unwrap();

    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 2)]);
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("5".to_string()));

    model.undo().unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("5".to_string()));

    model.redo().unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 2)]);
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("5".to_string()));
}

#[test]
fn merge_moves_content_to_the_anchor_and_undo_restores_it() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 3, 3, "hello").unwrap();

    // C3 is the only cell with content in B2:C3: it moves to the anchor
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 2)]);
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 2),
        Ok("hello".to_string())
    );
    assert_eq!(model.get_formatted_cell_value(0, 3, 3), Ok("".to_string()));

    model.undo().unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("".to_string()));
    assert_eq!(
        model.get_formatted_cell_value(0, 3, 3),
        Ok("hello".to_string())
    );

    model.redo().unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 2)]);
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 2),
        Ok("hello".to_string())
    );
    assert_eq!(model.get_formatted_cell_value(0, 3, 3), Ok("".to_string()));

    // undo again after the redo
    model.undo().unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("".to_string()));
    assert_eq!(
        model.get_formatted_cell_value(0, 3, 3),
        Ok("hello".to_string())
    );
}

#[test]
fn merge_with_more_than_one_content_cell_fails_and_leaves_no_trace() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "5").unwrap();
    model.set_user_input(0, 3, 3, "hello").unwrap();
    model.flush_send_queue();

    assert_eq!(
        model.merge_cells(&area(0, 2, 2, 2, 2)),
        Err("Cannot merge cells: more than one cell has content".to_string())
    );
    // the model is untouched and the history is clean
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("5".to_string()));
    assert_eq!(
        model.get_formatted_cell_value(0, 3, 3),
        Ok("hello".to_string())
    );
    let queue: Vec<QueueDiffs> = decode(&model.flush_send_queue()).unwrap();
    assert!(queue.is_empty());
}

#[test]
fn unmerge_undo_redo() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "5").unwrap();
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    model.unmerge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());

    model.undo().unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 2)]);

    model.redo().unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    // the anchor content survives merge + unmerge
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("5".to_string()));
}

#[test]
fn merge_diff_shape() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 3, 3, "42").unwrap();
    model.flush_send_queue();

    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    let list = last_diff_list(&mut model);
    // a SetCellValue clearing the covered cell C3, a SetCellValue giving its
    // content to the anchor B2, a SetCellStyle for the anchor (the moved cell
    // brings an explicit style along) and the SetMergedCells
    assert_eq!(list.len(), 4);
    assert!(matches!(
        &list[0],
        Diff::SetCellValue {
            sheet: 0,
            row: 3,
            column: 3,
            ..
        }
    ));
    assert!(matches!(
        &list[1],
        Diff::SetCellValue {
            sheet: 0,
            row: 2,
            column: 2,
            ..
        }
    ));
    assert!(matches!(
        &list[2],
        Diff::SetCellStyle {
            sheet: 0,
            row: 2,
            column: 2,
            ..
        }
    ));
    assert!(
        matches!(&list[3], Diff::SetMergedCells { sheet: 0, old_value, new_value }
            if old_value.is_empty() && new_value == &vec![merged(2, 2, 2, 2)])
    );
}

#[test]
fn no_op_unmerge_does_not_pollute_history() {
    let mut model = new_empty_user_model();
    model.unmerge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    assert!(!model.can_undo());
}

#[test]
fn failed_merge_does_not_pollute_history() {
    let mut model = new_empty_user_model();
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    model.flush_send_queue();
    // overlapping merge fails and must leave no trace
    assert!(model.merge_cells(&area(0, 3, 3, 2, 2)).is_err());
    let queue: Vec<QueueDiffs> = decode(&model.flush_send_queue()).unwrap();
    assert!(queue.is_empty());
}

#[test]
fn external_diffs_replay() {
    let mut model1 = new_empty_user_model();
    let mut model2 = new_empty_user_model();

    model1.set_user_input(0, 3, 3, "hello").unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();

    model1.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();

    // the content moved to the anchor on the external model too
    assert_eq!(
        model2.get_merged_cells(0).unwrap(),
        vec![merged(2, 2, 2, 2)]
    );
    assert_eq!(model2.get_formatted_cell_value(0, 3, 3), Ok("".to_string()));
    assert_eq!(
        model2.get_formatted_cell_value(0, 2, 2),
        Ok("hello".to_string())
    );

    // the undo also replays
    model1.undo().unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();
    assert!(model2.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(model2.get_formatted_cell_value(0, 2, 2), Ok("".to_string()));
    assert_eq!(
        model2.get_formatted_cell_value(0, 3, 3),
        Ok("hello".to_string())
    );
}

#[test]
fn merge_moves_the_content_cell_link_to_the_anchor_and_undo_restores_it() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 3, 3, "ironcalc").unwrap();
    let link = Link::External {
        target: "https://www.ironcalc.com".to_string(),
        tooltip: None,
    };
    model.set_cell_link(0, 3, 3, link.clone(), None).unwrap();

    // C3 is the only cell with content: its link moves to the anchor with it
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    assert_eq!(model.get_cell_link(0, 3, 3), Ok(None));
    assert_eq!(model.get_cell_link(0, 2, 2), Ok(Some(link.clone())));
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 2),
        Ok("ironcalc".to_string())
    );

    model.undo().unwrap();
    assert_eq!(model.get_cell_link(0, 3, 3), Ok(Some(link.clone())));
    assert_eq!(model.get_cell_link(0, 2, 2), Ok(None));

    model.redo().unwrap();
    assert_eq!(model.get_cell_link(0, 3, 3), Ok(None));
    assert_eq!(model.get_cell_link(0, 2, 2), Ok(Some(link)));
}

#[test]
fn merge_clears_the_link_of_a_covered_cell_without_content() {
    let mut model = new_empty_user_model();
    // a link on a cell with no content does not move to the anchor
    let link = Link::External {
        target: "https://www.ironcalc.com".to_string(),
        tooltip: None,
    };
    model.set_cell_link(0, 3, 3, link.clone(), None).unwrap();

    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    assert_eq!(model.get_cell_link(0, 3, 3), Ok(None));
    assert_eq!(model.get_cell_link(0, 2, 2), Ok(None));

    model.undo().unwrap();
    assert_eq!(model.get_cell_link(0, 3, 3), Ok(Some(link)));
}

#[test]
fn delete_rows_wiping_a_merge_is_undoable() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "5").unwrap();
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    // rows 1-5 contain the whole merge: it is gone
    model.delete_rows(0, 1, 5).unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());

    model.undo().unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 2)]);
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("5".to_string()));

    model.redo().unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());
}

#[test]
fn delete_rows_above_a_merge_is_undoable() {
    // Deleting rows that overlap the top of a merge shrinks and shifts it in a
    // way plain re-insertion cannot reverse; the snapshot diff must restore it.
    let mut model = new_empty_user_model();
    // merge B2:C4
    model.merge_cells(&area(0, 2, 2, 2, 3)).unwrap();
    model.delete_rows(0, 1, 2).unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(1, 2, 2, 2)]);

    model.undo().unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 3)]);

    model.redo().unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(1, 2, 2, 2)]);
}

#[test]
fn insert_rows_into_a_merge_is_undoable() {
    let mut model = new_empty_user_model();
    // merge B2:C3
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    model.insert_rows(0, 3, 2).unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 4)]);

    model.undo().unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 2)]);
}

#[test]
fn structural_ops_replay_on_external_model() {
    let mut model1 = new_empty_user_model();
    let mut model2 = new_empty_user_model();

    model1.merge_cells(&area(0, 2, 2, 2, 3)).unwrap();
    model1.delete_rows(0, 1, 2).unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();
    assert_eq!(
        model2.get_merged_cells(0).unwrap(),
        model1.get_merged_cells(0).unwrap()
    );

    // undo on model1 replays on model2
    model1.undo().unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();
    assert_eq!(
        model2.get_merged_cells(0).unwrap(),
        vec![merged(2, 2, 2, 3)]
    );
}

// ── Styles ───────────────────────────────────────────────────────────────────

fn thin(color: &str) -> Option<BorderItem> {
    Some(BorderItem {
        style: BorderStyle::Thin,
        color: Color::Rgb(color.to_string()),
    })
}

#[test]
fn merge_stamps_the_anchor_style_and_undo_restores_the_old_ones() {
    let mut model = new_empty_user_model();
    // anchor B2 red, covered C3 blue
    model
        .update_range_style(&area(0, 2, 2, 1, 1), "fill.color", "#FF0000")
        .unwrap();
    model
        .update_range_style(&area(0, 3, 3, 1, 1), "fill.color", "#0000FF")
        .unwrap();

    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    for (row, column) in [(2, 2), (2, 3), (3, 2), (3, 3)] {
        assert_eq!(
            model.get_cell_style(0, row, column).unwrap().fill.color,
            Color::Rgb("#FF0000".to_string())
        );
    }

    // undo brings the old styles back
    model.undo().unwrap();
    assert_eq!(
        model.get_cell_style(0, 3, 3).unwrap().fill.color,
        Color::Rgb("#0000FF".to_string())
    );
    assert_eq!(
        model.get_cell_style(0, 2, 3).unwrap().fill.color,
        Color::None
    );

    // redo stamps them again
    model.redo().unwrap();
    assert_eq!(
        model.get_cell_style(0, 3, 3).unwrap().fill.color,
        Color::Rgb("#FF0000".to_string())
    );

    // unmerging keeps the stamped styles: the blue is forgotten
    model.unmerge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    assert_eq!(
        model.get_cell_style(0, 3, 3).unwrap().fill.color,
        Color::Rgb("#FF0000".to_string())
    );
}

// Asserts that a full "#color" outline wraps the merged range B2:C3 as a
// whole: each cell shows only the sides of its corner of the perimeter.
fn assert_outline_wraps_b2_c3(model: &UserModel, color: &str) {
    let b2 = model._get_cell_border("B2");
    assert_eq!(b2.left, thin(color));
    assert_eq!(b2.top, thin(color));
    assert_eq!(b2.right, None);
    assert_eq!(b2.bottom, None);
    let c2 = model._get_cell_border("C2");
    assert_eq!(c2.top, thin(color));
    assert_eq!(c2.right, thin(color));
    assert_eq!(c2.left, None);
    assert_eq!(c2.bottom, None);
    let b3 = model._get_cell_border("B3");
    assert_eq!(b3.left, thin(color));
    assert_eq!(b3.bottom, thin(color));
    assert_eq!(b3.top, None);
    assert_eq!(b3.right, None);
    let c3 = model._get_cell_border("C3");
    assert_eq!(c3.right, thin(color));
    assert_eq!(c3.bottom, thin(color));
    assert_eq!(c3.left, None);
    assert_eq!(c3.top, None);
}

#[test]
fn merge_moves_the_anchor_borders_to_the_perimeter_and_undo_restores_them() {
    let mut model = new_empty_user_model();
    // full outline on the anchor B2, another border on covered C3; no content
    model._set_cell_border("B2", "#111111");
    model._set_cell_border("C3", "#999999");

    // merge B2:C3: the empty range takes the anchor's style, so its outline
    // wraps the whole merged cell and the C3 outline is dropped
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    assert_outline_wraps_b2_c3(&model, "#111111");

    // undo restores the two original outlines
    model.undo().unwrap();
    let b2 = model._get_cell_border("B2");
    assert_eq!(
        [b2.left, b2.right, b2.top, b2.bottom],
        [
            thin("#111111"),
            thin("#111111"),
            thin("#111111"),
            thin("#111111")
        ]
    );
    let c3 = model._get_cell_border("C3");
    assert_eq!(
        [c3.left, c3.right, c3.top, c3.bottom],
        [
            thin("#999999"),
            thin("#999999"),
            thin("#999999"),
            thin("#999999")
        ]
    );
}

#[test]
fn merge_moves_the_content_cell_borders_to_the_perimeter_and_undo_restores_them() {
    let mut model = new_empty_user_model();
    // C3 is the bottom-right corner of B2:C3 and the only cell with content
    model.set_user_input(0, 3, 3, "x").unwrap();
    model._set_cell_border("C3", "#999999");

    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    // the borders come from the cell with content, wherever it sat: its full
    // outline wraps the merged cell as a whole
    assert_outline_wraps_b2_c3(&model, "#999999");

    // undo restores the original outline on C3 alone
    model.undo().unwrap();
    let c3 = model._get_cell_border("C3");
    assert_eq!(
        [c3.left, c3.right, c3.top, c3.bottom],
        [
            thin("#999999"),
            thin("#999999"),
            thin("#999999"),
            thin("#999999")
        ]
    );
    let b2 = model._get_cell_border("B2");
    assert_eq!(
        [b2.left, b2.right, b2.top, b2.bottom],
        [None, None, None, None]
    );
}

#[test]
fn merge_stamps_the_content_cell_style_and_undo_restores_the_old_ones() {
    let mut model = new_empty_user_model();
    // anchor B2 red but empty, C3 blue with content
    model
        .update_range_style(&area(0, 2, 2, 1, 1), "fill.color", "#FF0000")
        .unwrap();
    model
        .update_range_style(&area(0, 3, 3, 1, 1), "fill.color", "#0000FF")
        .unwrap();
    model.set_user_input(0, 3, 3, "7").unwrap();

    // the content cell's blue wins over the anchor's red
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("7".to_string()));
    for (row, column) in [(2, 2), (2, 3), (3, 2), (3, 3)] {
        assert_eq!(
            model.get_cell_style(0, row, column).unwrap().fill.color,
            Color::Rgb("#0000FF".to_string())
        );
    }

    // undo brings the old styles and content back
    model.undo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 3, 3), Ok("7".to_string()));
    assert_eq!(
        model.get_cell_style(0, 2, 2).unwrap().fill.color,
        Color::Rgb("#FF0000".to_string())
    );
    assert_eq!(
        model.get_cell_style(0, 3, 3).unwrap().fill.color,
        Color::Rgb("#0000FF".to_string())
    );

    // redo stamps them again
    model.redo().unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("7".to_string()));
    assert_eq!(
        model.get_cell_style(0, 2, 2).unwrap().fill.color,
        Color::Rgb("#0000FF".to_string())
    );
}

#[test]
fn merge_style_stamping_replays_on_external_models() {
    let mut model1 = new_empty_user_model();
    let mut model2 = new_empty_user_model();

    model1
        .update_range_style(&area(0, 2, 2, 1, 1), "fill.color", "#FF0000")
        .unwrap();
    model1.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();

    assert_eq!(
        model2.get_cell_style(0, 3, 3).unwrap().fill.color,
        Color::Rgb("#FF0000".to_string())
    );
}

#[test]
fn copy_paste_keeps_the_perimeter_borders_of_a_merged_cell() {
    let mut model = new_empty_user_model();
    // C3, the bottom-right corner of B2:C3, has content and an outline: after
    // merging, the surviving bottom/right borders live on non-anchor cells
    model.set_user_input(0, 3, 3, "x").unwrap();
    model._set_cell_border("C3", "#111111");
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    model.set_selected_cell(2, 2).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    model.set_selected_cell(10, 10).unwrap();
    model
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, false)
        .unwrap();

    // the pasted merge keeps the full outline, including the sides that are
    // not on its anchor
    assert_eq!(
        model.get_formatted_cell_value(0, 10, 10),
        Ok("x".to_string())
    );
    let j10 = model._get_cell_border("J10");
    assert_eq!(j10.left, thin("#111111"));
    assert_eq!(j10.top, thin("#111111"));
    assert_eq!([j10.right, j10.bottom], [None, None]);
    let k10 = model._get_cell_border("K10");
    assert_eq!(k10.top, thin("#111111"));
    assert_eq!(k10.right, thin("#111111"));
    assert_eq!([k10.left, k10.bottom], [None, None]);
    let j11 = model._get_cell_border("J11");
    assert_eq!(j11.left, thin("#111111"));
    assert_eq!(j11.bottom, thin("#111111"));
    assert_eq!([j11.right, j11.top], [None, None]);
    let k11 = model._get_cell_border("K11");
    assert_eq!(k11.right, thin("#111111"));
    assert_eq!(k11.bottom, thin("#111111"));
    assert_eq!([k11.left, k11.top], [None, None]);
}

// ── Navigation and selection ─────────────────────────────────────────────────

fn selected(model: &UserModel) -> (i32, i32, [i32; 4]) {
    let view = model.get_selected_view();
    (view.row, view.column, view.range)
}

#[test]
fn full_row_and_column_selections_do_not_grow_over_merges() {
    let mut model = new_empty_user_model();
    // merge B2:C3
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    // Like in Excel, selecting a row that slices through a merged range
    // selects just that row, it does not drag the other rows of the merge in
    model.set_selected_cell(2, 1).unwrap();
    model.set_selected_range(2, 1, 2, LAST_COLUMN).unwrap();
    assert_eq!(selected(&model).2, [2, 1, 2, LAST_COLUMN]);

    // same for a column crossing the merge
    model.set_selected_cell(1, 2).unwrap();
    model.set_selected_range(1, 2, LAST_ROW, 2).unwrap();
    assert_eq!(selected(&model).2, [1, 2, LAST_ROW, 2]);
}

#[test]
fn selecting_a_covered_cell_selects_the_anchor() {
    let mut model = new_empty_user_model();
    // merge B2:D4
    model.merge_cells(&area(0, 2, 2, 3, 3)).unwrap();

    model.set_selected_cell(3, 3).unwrap();
    assert_eq!(selected(&model), (2, 2, [2, 2, 4, 4]));

    model.set_selected_cell(1, 1).unwrap();
    assert_eq!(selected(&model), (1, 1, [1, 1, 1, 1]));
}

#[test]
fn arrows_skip_over_merges() {
    let mut model = new_empty_user_model();
    // merge B2:D4
    model.merge_cells(&area(0, 2, 2, 3, 3)).unwrap();

    // horizontally through the anchor row
    model.set_selected_cell(2, 1).unwrap();
    model.on_arrow_right().unwrap();
    assert_eq!(selected(&model), (2, 2, [2, 2, 4, 4]));
    model.on_arrow_right().unwrap();
    assert_eq!(selected(&model), (2, 5, [2, 5, 2, 5]));
    model.on_arrow_left().unwrap();
    assert_eq!(selected(&model), (2, 2, [2, 2, 4, 4]));
    model.on_arrow_left().unwrap();
    assert_eq!(selected(&model), (2, 1, [2, 1, 2, 1]));

    // vertically through the anchor column
    model.set_selected_cell(1, 2).unwrap();
    model.on_arrow_down().unwrap();
    assert_eq!(selected(&model), (2, 2, [2, 2, 4, 4]));
    model.on_arrow_down().unwrap();
    assert_eq!(selected(&model), (5, 2, [5, 2, 5, 2]));
    model.on_arrow_up().unwrap();
    assert_eq!(selected(&model), (2, 2, [2, 2, 4, 4]));
    model.on_arrow_up().unwrap();
    assert_eq!(selected(&model), (1, 2, [1, 2, 1, 2]));
}

#[test]
fn arrows_enter_merges_from_covered_rows_and_columns() {
    let mut model = new_empty_user_model();
    // merge B2:D4
    model.merge_cells(&area(0, 2, 2, 3, 3)).unwrap();

    // entering horizontally on a covered row snaps to the anchor;
    // leaving continues from the anchor's row (v1 simplification)
    model.set_selected_cell(3, 1).unwrap();
    model.on_arrow_right().unwrap();
    assert_eq!(selected(&model), (2, 2, [2, 2, 4, 4]));
    model.on_arrow_right().unwrap();
    assert_eq!(selected(&model), (2, 5, [2, 5, 2, 5]));

    // entering vertically on a covered column snaps to the anchor
    model.set_selected_cell(1, 4).unwrap();
    model.on_arrow_down().unwrap();
    assert_eq!(selected(&model), (2, 2, [2, 2, 4, 4]));
}

#[test]
fn expanding_selection_grows_over_merges() {
    let mut model = new_empty_user_model();
    // merge B2:D4
    model.merge_cells(&area(0, 2, 2, 3, 3)).unwrap();

    model.set_selected_cell(1, 1).unwrap();
    model.on_expand_selected_range("ArrowDown").unwrap();
    // A1:A2 does not touch the merge
    assert_eq!(selected(&model).2, [1, 1, 2, 1]);

    model.on_expand_selected_range("ArrowRight").unwrap();
    // A1:B2 touches the merge: grows to contain it fully
    assert_eq!(selected(&model).2, [1, 1, 4, 4]);
}

#[test]
fn area_selecting_grows_over_merges() {
    let mut model = new_empty_user_model();
    // merges B2:C3 and E3:F4: growing over the first one grazes the second
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();
    model.merge_cells(&area(0, 3, 5, 2, 2)).unwrap();

    model.set_selected_cell(1, 1).unwrap();
    model.on_area_selecting(2, 4).unwrap();
    // A1:D2 covers part of B2:C3 -> grows to row 3 -> touches E3:F4? no
    // (column 5 not included): range is A1:D3
    assert_eq!(selected(&model).2, [1, 1, 3, 4]);

    model.on_area_selecting(3, 5).unwrap();
    // now both merges are grazed: fixpoint covers A1:F4
    assert_eq!(selected(&model).2, [1, 1, 4, 6]);
}

#[test]
fn navigate_to_edge_treats_merge_as_one_cell() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "5").unwrap();
    // merge B2:D4, content at the anchor
    model.merge_cells(&area(0, 2, 2, 3, 3)).unwrap();
    model.set_user_input(0, 2, 6, "7").unwrap();

    // ctrl+right from A2 lands on the merge
    model.set_selected_cell(2, 1).unwrap();
    model
        .on_navigate_to_edge_in_direction(crate::worksheet::NavigationDirection::Right)
        .unwrap();
    assert_eq!(selected(&model), (2, 2, [2, 2, 4, 4]));

    // ctrl+right from the merge jumps past it to F2
    model
        .on_navigate_to_edge_in_direction(crate::worksheet::NavigationDirection::Right)
        .unwrap();
    assert_eq!(selected(&model), (2, 6, [2, 6, 2, 6]));
}

// ── Autofill and clipboard ───────────────────────────────────────────────────

#[test]
fn auto_fill_partially_covering_a_merge_is_rejected() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 2, "1").unwrap();
    // merge B3:C4
    model.merge_cells(&area(0, 3, 2, 2, 2)).unwrap();
    model.flush_send_queue();

    // filling B1 down to B4 covers only the left half of the merge
    assert_eq!(
        model.auto_fill_rows(&area(0, 1, 2, 1, 1), 4),
        Err("Cannot auto-fill: a merged cell partially overlaps the fill area".to_string())
    );
    // filling B1 right to C1 is fine (the merge is below)
    model.auto_fill_columns(&area(0, 1, 2, 1, 1), 3).unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 1, 3), Ok("1".to_string()));
}

// Pasting over merged cells follows the containment rule; the cases live in
// test_paste_merged_cells.rs.

#[test]
fn copy_paste_recreates_the_merge_at_the_target() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "5").unwrap();
    // merge B2:C3
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    // select the merged cell (selection covers the whole merge) and copy it
    model.set_selected_cell(2, 2).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    model.set_selected_cell(10, 10).unwrap();
    model
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, false)
        .unwrap();

    // the source merge is untouched and the target got its own J10:K11 merge
    assert_eq!(
        model.get_merged_cells(0).unwrap(),
        vec![merged(2, 2, 2, 2), merged(10, 10, 2, 2)]
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 10, 10),
        Ok("5".to_string())
    );

    model.undo().unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 2)]);
    assert_eq!(
        model.get_formatted_cell_value(0, 10, 10),
        Ok("".to_string())
    );

    model.redo().unwrap();
    assert_eq!(
        model.get_merged_cells(0).unwrap(),
        vec![merged(2, 2, 2, 2), merged(10, 10, 2, 2)]
    );
}

#[test]
fn copy_paste_keeps_merges_at_their_relative_position() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "a").unwrap();
    model.set_user_input(0, 2, 2, "5").unwrap();
    model.set_user_input(0, 4, 4, "x").unwrap();
    // merge B2:C3, in the middle of the copied area
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    // copy A1:D4 and paste it at F1
    model.set_selected_range(1, 1, 4, 4).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    model.set_selected_cell(1, 6).unwrap();
    model
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, false)
        .unwrap();

    // the pasted merge keeps its offset inside the area: G2:H3
    assert_eq!(
        model.get_merged_cells(0).unwrap(),
        vec![merged(2, 2, 2, 2), merged(2, 7, 2, 2)]
    );
    assert_eq!(model.get_formatted_cell_value(0, 2, 7), Ok("5".to_string()));
}

#[test]
fn cut_paste_moves_the_merge_to_the_target() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "5").unwrap();
    // merge B2:C3
    model.merge_cells(&area(0, 2, 2, 2, 2)).unwrap();

    // select the merged cell (selection covers the whole merge) and cut it
    model.set_selected_cell(2, 2).unwrap();
    let clipboard = model.copy_to_clipboard().unwrap();
    model.set_selected_cell(10, 10).unwrap();
    model
        .paste_from_clipboard(0, clipboard.range, &clipboard.data, true)
        .unwrap();

    // the merge moved with its content: gone from the source, at J10:K11 now
    assert_eq!(
        model.get_merged_cells(0).unwrap(),
        vec![merged(10, 10, 2, 2)]
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 10, 10),
        Ok("5".to_string())
    );
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("".to_string()));

    // undo moves the merge and its content back to the source
    model.undo().unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 2)]);
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("5".to_string()));
    assert_eq!(
        model.get_formatted_cell_value(0, 10, 10),
        Ok("".to_string())
    );

    model.redo().unwrap();
    assert_eq!(
        model.get_merged_cells(0).unwrap(),
        vec![merged(10, 10, 2, 2)]
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 10, 10),
        Ok("5".to_string())
    );
}

// Merging a range whose selected cell is not the anchor must move the
// selection to the anchor: a covered cell can never stay selected (the UI
// draws the selection outline from the selected cell, sized like the merged
// rectangle, so a selected covered cell renders a shifted selection).
#[test]
fn merging_snaps_the_selection_to_the_anchor() {
    let mut model = new_empty_user_model();
    // Select H20 and extend the selection to G19: H20 stays the selected cell
    model.set_selected_cell(20, 8).unwrap();
    model.on_area_selecting(19, 7).unwrap();
    let view = model.get_selected_view();
    assert_eq!(view.range, [19, 7, 20, 8]);
    assert_eq!((view.row, view.column), (20, 8));

    // Merge the selected area, as the toolbar button does
    model.merge_cells(&area(0, 19, 7, 2, 2)).unwrap();

    // The selected cell must be the anchor G19 and the selected range the
    // whole merged range
    let view = model.get_selected_view();
    assert_eq!((view.row, view.column), (19, 7));
    assert_eq!(view.range, [19, 7, 20, 8]);
}

// ── Merge & center, merge across, merge down ─────────────────────────────────

#[test]
fn merge_center_undo_redo_is_a_single_step() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 2, "5").unwrap();
    model.flush_send_queue();

    model.merge_cells_center(&area(0, 2, 2, 2, 2)).unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 2)]);
    for (row, column) in [(2, 2), (2, 3), (3, 2), (3, 3)] {
        assert_eq!(
            model
                .get_cell_style(0, row, column)
                .unwrap()
                .alignment
                .unwrap_or_default()
                .horizontal,
            HorizontalAlignment::Center
        );
    }
    // merging and centering form a single history step...
    let queue: Vec<QueueDiffs> = decode(&model.flush_send_queue()).unwrap();
    assert_eq!(queue.len(), 1);

    // ...so a single undo reverts both
    model.undo().unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(model.get_cell_style(0, 2, 2).unwrap().alignment, None);
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("5".to_string()));

    model.redo().unwrap();
    assert_eq!(model.get_merged_cells(0).unwrap(), vec![merged(2, 2, 2, 2)]);
    assert_eq!(
        model
            .get_cell_style(0, 2, 2)
            .unwrap()
            .alignment
            .unwrap_or_default()
            .horizontal,
        HorizontalAlignment::Center
    );
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("5".to_string()));
}

#[test]
fn merge_center_replays_on_external_models() {
    let mut model1 = new_empty_user_model();
    let mut model2 = new_empty_user_model();

    model1.merge_cells_center(&area(0, 2, 2, 2, 2)).unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();
    assert_eq!(
        model2.get_merged_cells(0).unwrap(),
        vec![merged(2, 2, 2, 2)]
    );
    assert_eq!(
        model2
            .get_cell_style(0, 3, 3)
            .unwrap()
            .alignment
            .unwrap_or_default()
            .horizontal,
        HorizontalAlignment::Center
    );
}

#[test]
fn merge_across_undo_redo_is_a_single_step() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 2, 3, "top").unwrap();
    model.set_user_input(0, 4, 2, "bottom").unwrap();
    model.flush_send_queue();

    // B2:C4 becomes three one-row merges
    model.merge_cells_across(&area(0, 2, 2, 2, 3)).unwrap();
    assert_eq!(
        model.get_merged_cells(0).unwrap(),
        vec![merged(2, 2, 2, 1), merged(3, 2, 2, 1), merged(4, 2, 2, 1)]
    );
    // each row's single content cell moved to its own anchor
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 2),
        Ok("top".to_string())
    );
    assert_eq!(model.get_formatted_cell_value(0, 2, 3), Ok("".to_string()));
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 2),
        Ok("bottom".to_string())
    );
    // the three merges form a single history step...
    let queue: Vec<QueueDiffs> = decode(&model.flush_send_queue()).unwrap();
    assert_eq!(queue.len(), 1);

    // ...so a single undo reverts them all
    model.undo().unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 3),
        Ok("top".to_string())
    );
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("".to_string()));

    model.redo().unwrap();
    assert_eq!(
        model.get_merged_cells(0).unwrap(),
        vec![merged(2, 2, 2, 1), merged(3, 2, 2, 1), merged(4, 2, 2, 1)]
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 2),
        Ok("top".to_string())
    );
}

#[test]
fn merge_across_is_all_or_nothing() {
    let mut model = new_empty_user_model();
    // the second row has two cells with content: the whole operation fails
    model.set_user_input(0, 3, 2, "a").unwrap();
    model.set_user_input(0, 3, 3, "b").unwrap();
    model.flush_send_queue();

    assert_eq!(
        model.merge_cells_across(&area(0, 2, 2, 2, 3)),
        Err("Cannot merge cells: more than one cell has content".to_string())
    );
    // no row was merged and the history is clean
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(model.get_formatted_cell_value(0, 3, 2), Ok("a".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 3, 3), Ok("b".to_string()));
    let queue: Vec<QueueDiffs> = decode(&model.flush_send_queue()).unwrap();
    assert!(queue.is_empty());
}

#[test]
fn merge_across_a_single_column_fails() {
    let mut model = new_empty_user_model();
    // each row of a one-column range would be a single cell
    assert_eq!(
        model.merge_cells_across(&area(0, 2, 2, 1, 3)),
        Err("Cannot merge a single cell".to_string())
    );
    assert!(!model.can_undo());
}

#[test]
fn merge_down_undo_redo_is_a_single_step() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 3, 2, "left").unwrap();
    model.set_user_input(0, 2, 3, "right").unwrap();
    model.flush_send_queue();

    // B2:C4 becomes two one-column merges
    model.merge_cells_down(&area(0, 2, 2, 2, 3)).unwrap();
    assert_eq!(
        model.get_merged_cells(0).unwrap(),
        vec![merged(2, 2, 1, 3), merged(2, 3, 1, 3)]
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 2),
        Ok("left".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 3),
        Ok("right".to_string())
    );
    // the two merges form a single history step...
    let queue: Vec<QueueDiffs> = decode(&model.flush_send_queue()).unwrap();
    assert_eq!(queue.len(), 1);

    // ...so a single undo reverts them all
    model.undo().unwrap();
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(
        model.get_formatted_cell_value(0, 3, 2),
        Ok("left".to_string())
    );
    assert_eq!(model.get_formatted_cell_value(0, 2, 2), Ok("".to_string()));

    model.redo().unwrap();
    assert_eq!(
        model.get_merged_cells(0).unwrap(),
        vec![merged(2, 2, 1, 3), merged(2, 3, 1, 3)]
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 2),
        Ok("left".to_string())
    );
}

#[test]
fn merge_down_is_all_or_nothing() {
    let mut model = new_empty_user_model();
    // the second column has two cells with content: the whole operation fails
    model.set_user_input(0, 2, 3, "a").unwrap();
    model.set_user_input(0, 3, 3, "b").unwrap();
    model.flush_send_queue();

    assert_eq!(
        model.merge_cells_down(&area(0, 2, 2, 2, 3)),
        Err("Cannot merge cells: more than one cell has content".to_string())
    );
    assert!(model.get_merged_cells(0).unwrap().is_empty());
    let queue: Vec<QueueDiffs> = decode(&model.flush_send_queue()).unwrap();
    assert!(queue.is_empty());
}

#[test]
fn merge_down_a_single_row_fails() {
    let mut model = new_empty_user_model();
    // each column of a one-row range would be a single cell
    assert_eq!(
        model.merge_cells_down(&area(0, 2, 2, 3, 1)),
        Err("Cannot merge a single cell".to_string())
    );
    assert!(!model.can_undo());
}

#[test]
fn merge_across_replays_on_external_models() {
    let mut model1 = new_empty_user_model();
    let mut model2 = new_empty_user_model();

    model1.set_user_input(0, 2, 3, "hello").unwrap();
    model1.merge_cells_across(&area(0, 2, 2, 2, 3)).unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();
    assert_eq!(
        model2.get_merged_cells(0).unwrap(),
        vec![merged(2, 2, 2, 1), merged(3, 2, 2, 1), merged(4, 2, 2, 1)]
    );
    assert_eq!(
        model2.get_formatted_cell_value(0, 2, 2),
        Ok("hello".to_string())
    );
    assert_eq!(model2.get_formatted_cell_value(0, 2, 3), Ok("".to_string()));

    // the single-step undo also replays
    model1.undo().unwrap();
    model2
        .apply_external_diffs(&model1.flush_send_queue())
        .unwrap();
    assert!(model2.get_merged_cells(0).unwrap().is_empty());
    assert_eq!(
        model2.get_formatted_cell_value(0, 2, 3),
        Ok("hello".to_string())
    );
}

#[test]
fn merge_across_selects_the_whole_merged_area() {
    let mut model = new_empty_user_model();
    // select C3 and extend the selection to B2: C3 stays the selected cell
    model.set_selected_cell(3, 3).unwrap();
    model.on_area_selecting(2, 2).unwrap();

    model.merge_cells_across(&area(0, 2, 2, 2, 2)).unwrap();
    // the whole merged area stays selected (both row merges), with the
    // top-left anchor B2 as the selected cell
    let view = model.get_selected_view();
    assert_eq!((view.row, view.column), (2, 2));
    assert_eq!(view.range, [2, 2, 3, 3]);
}

#[test]
fn merge_down_selects_the_whole_merged_area() {
    let mut model = new_empty_user_model();
    model.set_selected_cell(4, 3).unwrap();
    model.on_area_selecting(2, 2).unwrap();

    model.merge_cells_down(&area(0, 2, 2, 2, 3)).unwrap();
    // the whole merged area stays selected (both column merges), with the
    // top-left anchor B2 as the selected cell
    let view = model.get_selected_view();
    assert_eq!((view.row, view.column), (2, 2));
    assert_eq!(view.range, [2, 2, 4, 3]);
}
