#![allow(clippy::unwrap_used)]
use crate::types::Color;

use crate::constants::{LAST_COLUMN, LAST_ROW};
use crate::expressions::types::Area;
use crate::locale::get_locale;
use crate::test::util::new_empty_model;
use crate::UserModel;

#[test]
fn basic_tests() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 3, 1, "alpha").unwrap(); // A3

    // We autofill from A3 to A5
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 3,
                column: 1,
                width: 1,
                height: 1,
            },
            5,
        )
        .unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 1),
        Ok("alpha".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 5, 1),
        Ok("alpha".to_string())
    );
}

#[test]
fn one_cell_down() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "23").unwrap(); // A1
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 1,
            },
            2,
        )
        .unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 1), // A2
        Ok("23".to_string())
    );
}

#[test]
fn int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "40").unwrap(); // A1
    model.set_user_input(0, 2, 1, "41").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            5,
        )
        .unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 3, 1), // A3
        Ok("42".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 1), // A4
        Ok("43".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 5, 1), // A5
        Ok("44".to_string())
    );
}

#[test]
fn float_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "40.5").unwrap(); // A1
    model.set_user_input(0, 2, 1, "41.0").unwrap(); // A2
    model.set_user_input(0, 3, 1, "41.5").unwrap(); // A3
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 3,
            },
            6,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("42".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 5, 1), // A5
        Ok("42.5".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 6, 1), // A6
        Ok("43".to_string())
    );
}

#[test]
fn float_tolerance_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "40.000000000001").unwrap(); // A1
    model.set_user_input(0, 2, 1, "41.000000000001").unwrap(); // A2
    model.set_user_input(0, 3, 1, "42.000000000001").unwrap(); // A3
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 3,
            },
            6,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("43.000000000001".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 5, 1), // A5
        Ok("44.000000000001".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 6, 1), // A6
        Ok("45.000000000001".to_string())
    );
}

#[test]
fn float_progression_rounds() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "41.8").unwrap(); // A1
    model.set_user_input(0, 2, 1, "41.9").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 3, 1), // A3
        Ok("42".to_string())
    );
}

#[test]
fn constant_value_autofill() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "5").unwrap(); // A1
    model.set_user_input(0, 2, 1, "5").unwrap(); // A2
    model.set_user_input(0, 3, 1, "5").unwrap(); // A3
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 3,
            },
            6,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("5".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 5, 1), // A5
        Ok("5".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 6, 1), // A6
        Ok("5".to_string())
    );
}

#[test]
fn not_int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "4").unwrap(); // A1
    model.set_user_input(0, 2, 1, "2").unwrap(); // A2
    model.set_user_input(0, 3, 1, "4").unwrap(); // A3
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 3,
            },
            6,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("4".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 5, 1), // A5
        Ok("2".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 6, 1), // A6
        Ok("4".to_string())
    );
}

#[test]
fn suffixed_int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "Project1").unwrap(); // A1
    model.set_user_input(0, 2, 1, "Project2").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 3, 1), // A3
        Ok("Project3".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("Project4".to_string())
    );
}

#[test]
fn suffixed_float_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "Project1.8").unwrap(); // A1
    model.set_user_input(0, 2, 1, "Project1.9").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 3, 1), // A3
        Ok("Project1.10".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("Project1.11".to_string())
    );
}

#[test]
fn not_suffixed_int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "Project1").unwrap(); // A1
    model.set_user_input(0, 2, 1, "AProject2").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 3, 1), // A3
        Ok("Project1".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("AProject2".to_string())
    );
}

#[test]
fn suffixed_not_int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "Project1").unwrap(); // A1
    model.set_user_input(0, 2, 1, "Project1").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 3, 1), // A3
        Ok("Project1".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("Project1".to_string())
    );
}

#[test]
fn month_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "January").unwrap(); // A1
    model.set_user_input(0, 2, 1, "February").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 3, 1), // A3
        Ok("March".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("April".to_string())
    );
}

#[test]
fn rev_month_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "February").unwrap(); // A1
    model.set_user_input(0, 2, 1, "January").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 3, 1), // A3
        Ok("December".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("November".to_string())
    );
}

#[test]
fn de_locale_month_progression() {
    let mut model = new_empty_model();
    model.locale = get_locale("de").unwrap();
    let mut model = UserModel::from_model(model);

    model.set_user_input(0, 1, 1, "Januar").unwrap(); // A1
    model.set_user_input(0, 2, 1, "Februar").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 3, 1), // A3
        Ok("März".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("April".to_string())
    );
}

#[test]
fn short_month_progression_capitalized() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "Jan").unwrap(); // A1
    model.set_user_input(0, 2, 1, "Feb").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 3, 1), // A3
        Ok("Mar".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("Apr".to_string())
    );
}

#[test]
fn short_month_progression_lowercase() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "jan").unwrap(); // A1
    model.set_user_input(0, 2, 1, "feb").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 3, 1), // A3
        Ok("mar".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("apr".to_string())
    );
}

#[test]
fn short_month_progression_uppercase() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "JAN").unwrap(); // A1
    model.set_user_input(0, 2, 1, "FEB").unwrap(); // A2
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 3, 1), // A3
        Ok("MAR".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 4, 1), // A4
        Ok("APR".to_string())
    );
}

#[test]
fn short_month_progression_upwards_lowercase() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 10, 1, "jan").unwrap(); // A10
    model.set_user_input(0, 11, 1, "feb").unwrap(); // A11
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 10,
                column: 1,
                width: 1,
                height: 2,
            },
            8,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 9, 1), // A9
        Ok("dec".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 8, 1), // A8
        Ok("nov".to_string())
    );
}

#[test]
fn de_locale_month_progression_upwards_uppercase() {
    let mut model = new_empty_model();
    model.locale = get_locale("de").unwrap();
    let mut model = UserModel::from_model(model);

    model.set_user_input(0, 10, 1, "MÄRZ").unwrap(); // A10
    model.set_user_input(0, 11, 1, "april").unwrap(); // A11
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 10,
                column: 1,
                width: 1,
                height: 2,
            },
            8,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 9, 1), // A9
        Ok("FEBRUAR".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 8, 1), // A8
        Ok("JANUAR".to_string())
    );
}

#[test]
fn alpha_beta_gamma() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // cells A1:B3
    model.set_user_input(0, 1, 1, "Alpher").unwrap();
    model.set_user_input(0, 2, 1, "Bethe").unwrap();
    model.set_user_input(0, 3, 1, "Gamow").unwrap();
    model.set_user_input(0, 1, 2, "=A1").unwrap();
    model.set_user_input(0, 2, 2, "=A2").unwrap();
    model.set_user_input(0, 3, 2, "=A3").unwrap();
    // We autofill from A1:B3 to A9
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 3,
            },
            9,
        )
        .unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 4, 1),
        Ok("Alpher".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 5, 1),
        Ok("Bethe".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 6, 1),
        Ok("Gamow".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 7, 1),
        Ok("Alpher".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 8, 1),
        Ok("Bethe".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 9, 1),
        Ok("Gamow".to_string())
    );

    assert_eq!(
        model.get_formatted_cell_value(0, 4, 2),
        Ok("Alpher".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 5, 2),
        Ok("Bethe".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 6, 2),
        Ok("Gamow".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 7, 2),
        Ok("Alpher".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 8, 2),
        Ok("Bethe".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 9, 2),
        Ok("Gamow".to_string())
    );

    assert_eq!(model.get_cell_content(0, 4, 2), Ok("=A4".to_string()));
}

#[test]
fn styles() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // cells A1:A3
    model.set_user_input(0, 1, 1, "Alpher").unwrap();
    model.set_user_input(0, 2, 1, "Bethe").unwrap();
    model.set_user_input(0, 3, 1, "Gamow").unwrap();

    let a2 = Area {
        sheet: 0,
        row: 2,
        column: 1,
        width: 1,
        height: 1,
    };

    let a3 = Area {
        sheet: 0,
        row: 3,
        column: 1,
        width: 1,
        height: 1,
    };

    model.update_range_style(&a2, "font.i", "true").unwrap();
    model
        .update_range_style(&a3, "fill.color", "#334455")
        .unwrap();

    // We autofill from A1:A3 to A9
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 3,
            },
            9,
        )
        .unwrap();

    // Check that cell A5 has A2 style
    let style = model.get_cell_style(0, 5, 1).unwrap();
    assert!(style.font.i);
    // A6 would have the style of A3
    let style = model.get_cell_style(0, 6, 1).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#334455".to_string()));

    model.undo().unwrap();

    // A4
    assert_eq!(model.get_cell_content(0, 4, 1), Ok("".to_string()));
    // Check that cell A5 does NOT have A2 style
    let style = model.get_cell_style(0, 5, 1).unwrap();
    assert!(!style.font.i);

    // A6 would have NOT the style of A3
    let style = model.get_cell_style(0, 6, 1).unwrap();
    assert_eq!(style.fill.color, Color::None);

    model.redo().unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 1), // A4
        Ok("Alpher".to_string())
    );

    // Check that cell A5 has A2 style
    let style = model.get_cell_style(0, 5, 1).unwrap();
    assert!(style.font.i);

    // A6 would have the style of A3
    let style = model.get_cell_style(0, 6, 1).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#334455".to_string()));
}

#[test]
fn upwards() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // cells A10:A12
    model.set_user_input(0, 10, 1, "Alpher").unwrap();
    model.set_user_input(0, 11, 1, "Bethe").unwrap();
    model.set_user_input(0, 12, 1, "Gamow").unwrap();

    // We fill upwards to row 5
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 10,
                column: 1,
                width: 1,
                height: 3,
            },
            5,
        )
        .unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 9, 1),
        Ok("Gamow".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 8, 1),
        Ok("Bethe".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 7, 1),
        Ok("Alpher".to_string())
    );
}

#[test]
fn upwards_4() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // cells A10:A13
    model.set_user_input(0, 10, 1, "Margaret Burbidge").unwrap();
    model.set_user_input(0, 11, 1, "Geoffrey Burbidge").unwrap();
    model.set_user_input(0, 12, 1, "Willy Fowler").unwrap();
    model.set_user_input(0, 13, 1, "Fred Hoyle").unwrap();

    // We fill upwards to row 5
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 10,
                column: 1,
                width: 1,
                height: 4,
            },
            5,
        )
        .unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 9, 1),
        Ok("Fred Hoyle".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 8, 1),
        Ok("Willy Fowler".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 5, 1),
        Ok("Fred Hoyle".to_string())
    );
}

#[test]
fn upwards_int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 2, 1, "1").unwrap(); // A2
    model.set_user_input(0, 3, 1, "2").unwrap(); // A3

    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 2,
                column: 1,
                width: 1,
                height: 2,
            },
            1,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 1), // A1
        Ok("0".to_string())
    );
}

#[test]
fn errors() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 4, 1, "Margaret Burbidge").unwrap(); // A4

    // Invalid sheet
    assert_eq!(
        model.auto_fill_rows(
            &Area {
                sheet: 3,
                row: 4,
                column: 1,
                width: 1,
                height: 1,
            },
            10,
        ),
        Err("Invalid worksheet index: '3'".to_string())
    );

    // invalid row
    assert_eq!(
        model.auto_fill_rows(
            &Area {
                sheet: 0,
                row: -1,
                column: 1,
                width: 1,
                height: 1,
            },
            10,
        ),
        Err("Invalid row: '-1'".to_string())
    );

    // invalid row
    assert_eq!(
        model.auto_fill_rows(
            &Area {
                sheet: 0,
                row: LAST_ROW - 1,
                column: 1,
                width: 1,
                height: 10,
            },
            10,
        ),
        Err("Invalid row: '1048584'".to_string())
    );

    assert_eq!(
        model.auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: LAST_COLUMN + 1,
                width: 1,
                height: 10,
            },
            10,
        ),
        Err("Invalid column: '16385'".to_string())
    );

    assert_eq!(
        model.auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: LAST_COLUMN - 2,
                width: 10,
                height: 1,
            },
            10,
        ),
        Err("Invalid column: '16391'".to_string())
    );

    assert_eq!(
        model.auto_fill_rows(
            &Area {
                sheet: 0,
                row: 5,
                column: 1,
                width: 1,
                height: 10,
            },
            -10,
        ),
        Err("Invalid row: '-10'".to_string())
    );
}

#[test]
fn invalid_parameters() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "23").unwrap();
    assert_eq!(
        model.auto_fill_rows(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 1,
                height: 2,
            },
            2,
        ),
        Err("Invalid parameters for autofill".to_string())
    );
}

// When the fill target completely covers a CSE array formula the formula should be
// removed and the fill should proceed normally.
#[test]
fn extend_down_completely_covers_cse() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // CSE formula ={1,2,3} in C5:E5 (row 5, col 3, width=3, height=1)
    model
        .set_user_array_formula(0, 5, 3, 3, 1, "={1,2,3}")
        .unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 5, 3), Ok("1".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 5, 4), Ok("2".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 5, 5), Ok("3".to_string()));

    // Extend C2:E2 (empty) down to row 6.
    // Fill target row 3–6, cols 3–5 completely contains the CSE (row 5, cols 3–5).
    // The CSE must be deleted and the fill must succeed.
    model
        .auto_fill_rows(
            &Area {
                sheet: 0,
                row: 2,
                column: 3,
                width: 3,
                height: 1,
            },
            6,
        )
        .unwrap();

    // CSE is gone — C5:E5 are overwritten with the fill value (empty from C2:E2).
    assert_eq!(model.get_formatted_cell_value(0, 5, 3), Ok("".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 5, 4), Ok("".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 5, 5), Ok("".to_string()));
}

// When the fill target only partially covers a CSE array formula the operation must
// fail with an error.
#[test]
fn extend_down_partially_covers_cse_returns_error() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // CSE formula in C5:E6 (row 5, col 3, width=3, height=2) — spans two rows.
    model
        .set_user_array_formula(0, 5, 3, 3, 2, "={1,2,3;4,5,6}")
        .unwrap();

    // Extend C2:E2 down to row 5 only.
    // Fill target row 3–5, cols 3–5 hits row 5 of the CSE, but row 6 is outside → partial overlap.
    let result = model.auto_fill_rows(
        &Area {
            sheet: 0,
            row: 2,
            column: 3,
            width: 3,
            height: 1,
        },
        5,
    );
    assert!(
        result.is_err(),
        "expected error for partial CSE overlap, got Ok"
    );
    // CSE must be untouched.
    assert_eq!(model.get_formatted_cell_value(0, 5, 3), Ok("1".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 6, 3), Ok("4".to_string()));
}

// Regression test for: collect_and_clear_cse_in_fill_target mutates the worksheet before
// completing validation. If the first CSE is fully covered (gets cleared) and a later CSE
// is only partially covered (returns Err), the first CSE has already been deleted even
// though the overall operation failed.
//
// Setup: two CSEs in the fill target
//   CSE A — C4:E4 (row 4, w=3): fully inside fill target rows 3–7, cols 3–5 → would be cleared
//   CSE B — C6:F6 (row 6, w=4): anchor col+w-1=6 exceeds col_end=5 → partial → triggers Err
//
// After the failed call, CSE A must still be intact.
#[test]
fn failed_autofill_rows_does_not_corrupt_cse() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // CSE A: C4:E4 — values 10, 20, 30
    model
        .set_user_array_formula(0, 4, 3, 3, 1, "={10,20,30}")
        .unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 3),
        Ok("10".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 4),
        Ok("20".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 5),
        Ok("30".to_string())
    );

    // CSE B: C6:F6 — anchor at col 3, extends to col 6 which is outside the col band 3–5
    model
        .set_user_array_formula(0, 6, 3, 4, 1, "={1,2,3,4}")
        .unwrap();

    // Extend C2:E2 down to row 7 — fill target is rows 3–7, cols 3–5.
    // CSE A is fully covered; CSE B is partially covered (anchor col+w-1=6 > col_end=5) → must Err.
    let result = model.auto_fill_rows(
        &Area {
            sheet: 0,
            row: 2,
            column: 3,
            width: 3,
            height: 1,
        },
        7,
    );
    assert!(
        result.is_err(),
        "expected error for partial CSE overlap, got Ok"
    );

    // CSE A must be untouched — C4:E4 still hold 10, 20, 30
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 3),
        Ok("10".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 4),
        Ok("20".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 4, 5),
        Ok("30".to_string())
    );
}
