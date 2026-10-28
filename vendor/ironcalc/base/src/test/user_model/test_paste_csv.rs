#![allow(clippy::unwrap_used)]

use crate::expressions::types::Area;
use crate::test::user_model::util::new_empty_user_model;

#[test]
fn csv_paste() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 7, 7, "=SUM(B4:D7)").unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 7, 7), Ok("0".to_string()));

    // paste some numbers in B4:C7
    let csv = "1\t2\t3\n4\t5\t6";
    let area = Area {
        sheet: 0,
        row: 4,
        column: 2,
        width: 1,
        height: 1,
    };
    model.set_selected_cell(4, 2).unwrap();
    model.paste_csv_string(&area, csv).unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 7, 7),
        Ok("21".to_string())
    );
    assert_eq!([4, 2, 5, 4], model.get_selected_view().range);
}

#[test]
fn csv_paste_formula() {
    let mut model = new_empty_user_model();

    let csv = "=YEAR(TODAY())";
    let area = Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 1,
        height: 1,
    };
    model.set_selected_cell(1, 1).unwrap();
    model.paste_csv_string(&area, csv).unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("2022".to_string())
    );
    assert_eq!([1, 1, 1, 1], model.get_selected_view().range);
}

#[test]
fn tsv_crlf_paste() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 7, 7, "=SUM(B4:D7)").unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 7, 7), Ok("0".to_string()));

    // paste some numbers in B4:C7
    let csv = "1\t2\t3\r\n4\t5\t6";
    let area = Area {
        sheet: 0,
        row: 4,
        column: 2,
        width: 1,
        height: 1,
    };
    model.set_selected_cell(4, 2).unwrap();
    model.paste_csv_string(&area, csv).unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 7, 7),
        Ok("21".to_string())
    );
    assert_eq!([4, 2, 5, 4], model.get_selected_view().range);
}

#[test]
fn cut_paste() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "42").unwrap();
    model.set_user_input(0, 1, 2, "=A1*3+1").unwrap();

    // set A1 bold
    let range = Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 1,
        height: 1,
    };
    model.update_range_style(&range, "font.b", "true").unwrap();

    model
        .set_user_input(0, 2, 1, "A season of faith\t \"perfection\"")
        .unwrap();

    // Select A1:B2 and copy
    model.set_selected_range(1, 1, 2, 2).unwrap();
    let copy = model.copy_to_clipboard().unwrap();

    model.set_selected_cell(4, 4).unwrap();

    // paste in cell D4 (4, 4)
    model
        .paste_from_clipboard(0, (1, 1, 2, 2), &copy.data, true)
        .unwrap();

    assert_eq!(model.get_cell_content(0, 4, 4), Ok("42".to_string()));
    assert_eq!(model.get_cell_content(0, 4, 5), Ok("=D4*3+1".to_string()));
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 5),
        Ok("127".to_string())
    );
    // cell D4 must be bold
    let style_d4 = model.get_cell_style(0, 4, 4).unwrap();
    assert!(style_d4.font.b);

    // range A1:B2 must be empty
    assert_eq!(model.get_cell_content(0, 1, 1), Ok("".to_string()));
    assert_eq!(model.get_cell_content(0, 1, 2), Ok("".to_string()));
    assert_eq!(model.get_cell_content(0, 2, 1), Ok("".to_string()));
    assert_eq!(model.get_cell_content(0, 2, 2), Ok("".to_string()));
}

#[test]
fn cut_paste_different_sheet() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "42").unwrap();

    model.set_selected_range(1, 1, 1, 1).unwrap();
    let copy = model.copy_to_clipboard().unwrap();
    model.new_sheet().unwrap();
    model.set_selected_sheet(1).unwrap();
    model.set_selected_cell(4, 4).unwrap();

    // paste in cell D4 (4, 4) of Sheet2
    model
        .paste_from_clipboard(0, (1, 1, 1, 1), &copy.data, true)
        .unwrap();

    assert_eq!(model.get_cell_content(1, 4, 4), Ok("42".to_string()));
    assert_eq!(model.get_cell_content(0, 1, 1), Ok("".to_string()));
}

#[test]
fn copy_paste_internal() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "42").unwrap();
    model.set_user_input(0, 1, 2, "=A1*3+1").unwrap();

    // set A1 bold
    let range = Area {
        sheet: 0,
        row: 1,
        column: 1,
        width: 1,
        height: 1,
    };
    model.update_range_style(&range, "font.b", "true").unwrap();

    model
        .set_user_input(0, 2, 1, "A season of faith\t \"perfection\"")
        .unwrap();

    // Select A1:B2 and copy
    model.set_selected_range(1, 1, 2, 2).unwrap();
    let copy = model.copy_to_clipboard().unwrap();
    assert_eq!(
        copy.csv,
        "42\t127\n\"A season of faith\t \"\"perfection\"\"\""
    );
    assert_eq!(copy.range, (1, 1, 2, 2));

    model.set_selected_cell(4, 4).unwrap();

    // paste in cell D4 (4, 4)
    model
        .paste_from_clipboard(0, (1, 1, 2, 2), &copy.data, false)
        .unwrap();

    assert_eq!(model.get_cell_content(0, 4, 4), Ok("42".to_string()));
    assert_eq!(model.get_cell_content(0, 4, 5), Ok("=D4*3+1".to_string()));
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 5),
        Ok("127".to_string())
    );
    // cell D4 must be bold
    let style_d4 = model.get_cell_style(0, 4, 4).unwrap();
    assert!(style_d4.font.b);

    model.undo().unwrap();

    assert_eq!(model.get_cell_content(0, 4, 4), Ok("".to_string()));
    assert_eq!(model.get_cell_content(0, 4, 5), Ok("".to_string()));
    // cell D4 must not be bold
    let style_d4 = model.get_cell_style(0, 4, 4).unwrap();
    assert!(!style_d4.font.b);

    model.redo().unwrap();

    assert_eq!(model.get_cell_content(0, 4, 4), Ok("42".to_string()));
    assert_eq!(model.get_cell_content(0, 4, 5), Ok("=D4*3+1".to_string()));
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 5),
        Ok("127".to_string())
    );
    // cell D4 must be bold
    let style_d4 = model.get_cell_style(0, 4, 4).unwrap();
    assert!(style_d4.font.b);
}
