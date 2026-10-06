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
    // This is cell A3
    model.set_user_input(0, 3, 1, "alpha").unwrap();
    // We autofill from A3 to C3
    model
        .auto_fill_columns(
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
    // B3
    assert_eq!(
        model.get_formatted_cell_value(0, 3, 2),
        Ok("alpha".to_string())
    );
    // C3
    assert_eq!(
        model.get_formatted_cell_value(0, 3, 3),
        Ok("alpha".to_string())
    );
}

#[test]
fn one_cell_right() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "23").unwrap(); // A1
    model
        .auto_fill_columns(
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
    // B1
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 2), // B1
        Ok("23".to_string())
    );
}

#[test]
fn int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "40").unwrap(); // A1
    model.set_user_input(0, 1, 2, "41").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            5,
        )
        .unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 1, 3), // C1
        Ok("42".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 4), // D1
        Ok("43".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 5), // E1
        Ok("44".to_string())
    );
}

#[test]
fn float_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "40.5").unwrap(); // A1
    model.set_user_input(0, 1, 2, "41.0").unwrap(); // B1
    model.set_user_input(0, 1, 3, "41.5").unwrap(); // C1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 3,
                height: 1,
            },
            6,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("42".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 5), // E1
        Ok("42.5".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 6), // F1
        Ok("43".to_string())
    );
}

#[test]
fn float_tolerance_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "40.000000000001").unwrap(); // A1
    model.set_user_input(0, 1, 2, "41.000000000001").unwrap(); // B1
    model.set_user_input(0, 1, 3, "42.000000000001").unwrap(); // C1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 3,
                height: 1,
            },
            6,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("43.000000000001".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 5), // E1
        Ok("44.000000000001".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 6), // F1
        Ok("45.000000000001".to_string())
    );
}

#[test]
fn float_progression_rounds() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "41.8").unwrap(); // A1
    model.set_user_input(0, 1, 2, "41.9").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 3), // C1
        Ok("42".to_string())
    );
}

#[test]
fn constant_value_autofill() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "5").unwrap(); // A1
    model.set_user_input(0, 1, 2, "5").unwrap(); // B1
    model.set_user_input(0, 1, 3, "5").unwrap(); // C1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 3,
                height: 1,
            },
            6,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("5".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 5), // E1
        Ok("5".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 6), // F1
        Ok("5".to_string())
    );
}

#[test]
fn not_int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "4").unwrap(); // A1
    model.set_user_input(0, 1, 2, "2").unwrap(); // B1
    model.set_user_input(0, 1, 3, "4").unwrap(); // C1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 3,
                height: 1,
            },
            6,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("4".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 5), // E1
        Ok("2".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 6), // F1
        Ok("4".to_string())
    );
}

#[test]
fn suffixed_int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "Project1").unwrap(); // A1
    model.set_user_input(0, 1, 2, "Project2").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 3), // C1
        Ok("Project3".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("Project4".to_string())
    );
}

#[test]
fn suffixed_float_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "Project1.8").unwrap(); // A1
    model.set_user_input(0, 1, 2, "Project1.9").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 3), // C1
        Ok("Project1.10".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("Project1.11".to_string())
    );
}

#[test]
fn not_suffixed_int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "Project1").unwrap(); // A1
    model.set_user_input(0, 1, 2, "AProject2").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 3), // C1
        Ok("Project1".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("AProject2".to_string())
    );
}

#[test]
fn suffixed_not_int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "Project1").unwrap(); // A1
    model.set_user_input(0, 1, 2, "Project1").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 3), // C1
        Ok("Project1".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("Project1".to_string())
    );
}

#[test]
fn month_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "January").unwrap(); // A1
    model.set_user_input(0, 1, 2, "February").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 3), // C1
        Ok("March".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("April".to_string())
    );
}

#[test]
fn rev_month_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "February").unwrap(); // A1
    model.set_user_input(0, 1, 2, "January").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 3), // C1
        Ok("December".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("November".to_string())
    );
}

#[test]
fn de_locale_month_progression() {
    let mut model = new_empty_model();
    model.locale = get_locale("de").unwrap();
    let mut model = UserModel::from_model(model);

    model.set_user_input(0, 1, 1, "Januar").unwrap(); // A1
    model.set_user_input(0, 1, 2, "Februar").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 3), // C1
        Ok("März".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("April".to_string())
    );
}

#[test]
fn short_month_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "Jan").unwrap(); // A1
    model.set_user_input(0, 1, 2, "Feb").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 3), // C1
        Ok("Mar".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("Apr".to_string())
    );
}

#[test]
fn short_month_progression_lowercase() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "jan").unwrap(); // A1
    model.set_user_input(0, 1, 2, "feb").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 3), // C1
        Ok("mar".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("apr".to_string())
    );
}

#[test]
fn short_month_progression_uppercase() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "JAN").unwrap(); // A1
    model.set_user_input(0, 1, 2, "FEB").unwrap(); // B1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            4,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 3), // C1
        Ok("MAR".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 4), // D1
        Ok("APR".to_string())
    );
}

#[test]
fn short_month_progression_left_uppercase() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 10, "JAN").unwrap(); // J1
    model.set_user_input(0, 1, 11, "FEB").unwrap(); // K1
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 10,
                width: 2,
                height: 1,
            },
            8,
        )
        .unwrap();

    assert_eq!(
        model.get_cell_content(0, 1, 9), // I1
        Ok("DEC".to_string())
    );
    assert_eq!(
        model.get_cell_content(0, 1, 8), // H1
        Ok("NOV".to_string())
    );
}

#[test]
fn alpha_beta_gamma() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // cells A1:B3
    model.set_user_input(0, 1, 1, "Alpher").unwrap(); // A1
    model.set_user_input(0, 1, 2, "Bethe").unwrap(); // B1
    model.set_user_input(0, 1, 3, "Gamow").unwrap(); // C1
    model.set_user_input(0, 2, 1, "=A1").unwrap(); // A2
    model.set_user_input(0, 2, 2, "=B1").unwrap(); // B2
    model.set_user_input(0, 2, 3, "=C1").unwrap(); // C2

    // We autofill from A1:C2 to I2
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 3,
                height: 2,
            },
            9,
        )
        .unwrap();

    // D1
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 4),
        Ok("Alpher".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 5),
        Ok("Bethe".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 6),
        Ok("Gamow".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 7),
        Ok("Alpher".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 8),
        Ok("Bethe".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 9),
        Ok("Gamow".to_string())
    );

    assert_eq!(
        model.get_formatted_cell_value(0, 2, 4),
        Ok("Alpher".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 5),
        Ok("Bethe".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 6),
        Ok("Gamow".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 7),
        Ok("Alpher".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 8),
        Ok("Bethe".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 2, 9),
        Ok("Gamow".to_string())
    );

    assert_eq!(model.get_cell_content(0, 2, 4), Ok("=D1".to_string()));
}

#[test]
fn styles() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // cells A1:C1
    model.set_user_input(0, 1, 1, "Alpher").unwrap();
    model.set_user_input(0, 2, 1, "Bethe").unwrap();
    model.set_user_input(0, 3, 1, "Gamow").unwrap();

    let b1 = Area {
        sheet: 0,
        row: 1,
        column: 2,
        width: 1,
        height: 1,
    };

    let c1 = Area {
        sheet: 0,
        row: 1,
        column: 3,
        width: 1,
        height: 1,
    };

    model.update_range_style(&b1, "font.i", "true").unwrap();
    model
        .update_range_style(&c1, "fill.color", "#334455")
        .unwrap();

    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 3,
                height: 1,
            },
            9,
        )
        .unwrap();

    // Check that cell E1 has B1 style
    let style = model.get_cell_style(0, 1, 5).unwrap();
    assert!(style.font.i);
    // A6 would have the style of A3
    let style = model.get_cell_style(0, 1, 6).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#334455".to_string()));

    model.undo().unwrap();

    assert_eq!(model.get_cell_content(0, 1, 4), Ok("".to_string()));
    // Check that cell A5 has A2 style
    let style = model.get_cell_style(0, 1, 5).unwrap();
    assert!(!style.font.i);
    // A6 would have the style of A3
    let style = model.get_cell_style(0, 1, 6).unwrap();
    assert_eq!(style.fill.color, Color::None);

    model.redo().unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 4),
        Ok("Alpher".to_string())
    );
    // Check that cell A5 has A2 style
    let style = model.get_cell_style(0, 1, 5).unwrap();
    assert!(style.font.i);
    // A6 would have the style of A3
    let style = model.get_cell_style(0, 1, 6).unwrap();
    assert_eq!(style.fill.color, Color::Rgb("#334455".to_string()));
}

#[test]
fn left() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // cells A10:A12
    model.set_user_input(0, 1, 10, "Alpher").unwrap();
    model.set_user_input(0, 1, 11, "Bethe").unwrap();
    model.set_user_input(0, 1, 12, "Gamow").unwrap();

    // We fill upwards to row 5
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 10,
                width: 3,
                height: 1,
            },
            5,
        )
        .unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 1, 9),
        Ok("Gamow".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 8),
        Ok("Bethe".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 7),
        Ok("Alpher".to_string())
    );
}

#[test]
fn left_4() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // cells A10:A13
    model.set_user_input(0, 1, 10, "Margaret Burbidge").unwrap();
    model.set_user_input(0, 1, 11, "Geoffrey Burbidge").unwrap();
    model.set_user_input(0, 1, 12, "Willy Fowler").unwrap();
    model.set_user_input(0, 1, 13, "Fred Hoyle").unwrap();

    // We fill left to row 5
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 10,
                width: 4,
                height: 1,
            },
            5,
        )
        .unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 1, 9),
        Ok("Fred Hoyle".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 8),
        Ok("Willy Fowler".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 5),
        Ok("Fred Hoyle".to_string())
    );
}

#[test]
fn left_int_progression() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 2, "1").unwrap(); // B1
    model.set_user_input(0, 1, 3, "2").unwrap(); // C1

    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 2,
                width: 2,
                height: 1,
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

    model.set_user_input(0, 1, 4, "Margaret Burbidge").unwrap();

    // Invalid sheet
    assert_eq!(
        model.auto_fill_columns(
            &Area {
                sheet: 3,
                row: 1,
                column: 4,
                width: 1,
                height: 1,
            },
            10,
        ),
        Err("Invalid worksheet index: '3'".to_string())
    );

    // invalid column
    assert_eq!(
        model.auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: -1,
                width: 1,
                height: 1,
            },
            10,
        ),
        Err("Invalid column: '-1'".to_string())
    );

    // invalid column
    assert_eq!(
        model.auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: LAST_COLUMN - 1,
                width: 10,
                height: 1,
            },
            10,
        ),
        Err("Invalid column: '16392'".to_string())
    );

    assert_eq!(
        model.auto_fill_columns(
            &Area {
                sheet: 0,
                row: LAST_ROW + 1,
                column: 1,
                width: 10,
                height: 1,
            },
            10,
        ),
        Err("Invalid row: '1048577'".to_string())
    );

    assert_eq!(
        model.auto_fill_columns(
            &Area {
                sheet: 0,
                row: LAST_ROW - 2,
                column: 1,
                width: 1,
                height: 10,
            },
            10,
        ),
        Err("Invalid row: '1048583'".to_string())
    );

    assert_eq!(
        model.auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 5,
                width: 10,
                height: 1,
            },
            -10,
        ),
        Err("Invalid column: '-10'".to_string())
    );
}

#[test]
fn invalid_parameters() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    model.set_user_input(0, 1, 1, "23").unwrap();
    assert_eq!(
        model.auto_fill_columns(
            &Area {
                sheet: 0,
                row: 1,
                column: 1,
                width: 2,
                height: 1,
            },
            2,
        ),
        Err("Invalid parameters for autofill".to_string())
    );
}

// When the fill target completely covers a CSE array formula the formula should be
// removed and the fill should proceed normally.
#[test]
fn extend_left_completely_covers_cse() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // CSE formula ={1;2;3} in F8:F10 (row 8, col 6, width=1, height=3)
    model
        .set_user_array_formula(0, 8, 6, 1, 3, "={1;2;3}")
        .unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 8, 6), Ok("1".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 9, 6), Ok("2".to_string()));
    assert_eq!(
        model.get_formatted_cell_value(0, 10, 6),
        Ok("3".to_string())
    );

    // Extend H8:H10 (empty) left to column D (4).
    // Fill target rows 8–10, cols 4–7 completely contains the CSE (rows 8–10, col 6).
    // The CSE must be deleted and the fill must succeed.
    model
        .auto_fill_columns(
            &Area {
                sheet: 0,
                row: 8,
                column: 8,
                width: 1,
                height: 3,
            },
            4,
        )
        .unwrap();

    // CSE is gone — F8:F10 are now overwritten with the fill value (empty from H8:H10).
    assert_eq!(model.get_formatted_cell_value(0, 8, 6), Ok("".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 9, 6), Ok("".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 10, 6), Ok("".to_string()));
}

// When the fill target only partially covers a CSE array formula the operation must
// fail with an error — a partial overwrite of a CSE formula is not allowed.
#[test]
fn extend_left_partially_covers_cse_returns_error() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);
    // CSE formula in E8:G10 (row 8, col 5, width=3, height=3) — cols E, F, G.
    model
        .set_user_array_formula(0, 8, 5, 3, 3, "={1,2,3;4,5,6;7,8,9}")
        .unwrap();

    // Extend H8:H10 left to column G (7).
    // Fill target rows 8–10, col 7 (G) only — hits G8:G10 (SpillArray of E8:G10),
    // but anchor E (col 5) is outside the fill target → partial overlap → must error.
    let result = model.auto_fill_columns(
        &Area {
            sheet: 0,
            row: 8,
            column: 8,
            width: 1,
            height: 3,
        },
        7,
    );
    assert!(
        result.is_err(),
        "expected error for partial CSE overlap, got Ok"
    );
    // CSE must be untouched.
    assert_eq!(model.get_formatted_cell_value(0, 8, 5), Ok("1".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 8, 6), Ok("2".to_string()));
    assert_eq!(model.get_formatted_cell_value(0, 8, 7), Ok("3".to_string()));
}

// Regression test for: collect_and_clear_cse_in_fill_target mutates the worksheet before
// completing validation. If the first CSE is fully covered (gets cleared) and a later CSE
// is only partially covered (returns Err), the first CSE has already been deleted even
// though the overall operation failed.
//
// Setup: two CSEs in the fill target
//   CSE A — D8:D10 (col 4, h=3): fully inside fill target cols 3–7, rows 8–10 → would be cleared
//   CSE B — E6:E10 (col 5, h=5): anchor row 6 is above fill rows 8–10 → partial → triggers Err
//
// After the failed call, CSE A must still be intact.
#[test]
fn failed_autofill_columns_does_not_corrupt_cse() {
    let model = new_empty_model();
    let mut model = UserModel::from_model(model);

    // CSE A: D8:D10 — values 10, 20, 30
    model
        .set_user_array_formula(0, 8, 4, 1, 3, "={10;20;30}")
        .unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 8, 4),
        Ok("10".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 9, 4),
        Ok("20".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 10, 4),
        Ok("30".to_string())
    );

    // CSE B: E6:E10 — anchor at row 6, extends outside the row band 8–10
    model
        .set_user_array_formula(0, 6, 5, 1, 5, "={1;2;3;4;5}")
        .unwrap();

    // Extend H8:H10 left to col 3 — fill target is rows 8–10, cols 3–7.
    // CSE A is fully covered; CSE B is partially covered (anchor row 6 < 8) → must Err.
    let result = model.auto_fill_columns(
        &Area {
            sheet: 0,
            row: 8,
            column: 8,
            width: 1,
            height: 3,
        },
        3,
    );
    assert!(
        result.is_err(),
        "expected error for partial CSE overlap, got Ok"
    );

    // CSE A must be untouched — D8:D10 still hold 10, 20, 30
    assert_eq!(
        model.get_formatted_cell_value(0, 8, 4),
        Ok("10".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 9, 4),
        Ok("20".to_string())
    );
    assert_eq!(
        model.get_formatted_cell_value(0, 10, 4),
        Ok("30".to_string())
    );
}
