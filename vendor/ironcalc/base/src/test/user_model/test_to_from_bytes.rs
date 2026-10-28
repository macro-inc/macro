#![allow(clippy::unwrap_used)]

use crate::{test::util::new_empty_model, UserModel};

#[test]
fn basic() {
    let mut model1 = UserModel::from_model(new_empty_model());
    let width = model1.get_column_width(0, 3).unwrap() * 3.0;
    model1.set_columns_width(0, 3, 3, width).unwrap();
    model1.set_user_input(0, 1, 2, "Hello IronCalc!").unwrap();

    let model_bytes = model1.to_bytes();

    let model2 = UserModel::from_bytes(&model_bytes, "en").unwrap();

    assert_eq!(model2.get_column_width(0, 3), Ok(width));
    assert_eq!(
        model2.get_formatted_cell_value(0, 1, 2),
        Ok("Hello IronCalc!".to_string())
    );
}

#[test]
fn errors() {
    let model_bytes = "Early in the morning, late in the century, Cricklewood Broadway.".as_bytes();
    assert_eq!(
        &UserModel::from_bytes(model_bytes, "en").unwrap_err(),
        "Error parsing workbook: invalid packing"
    );
}

#[test]
fn language() {
    let mut model = UserModel::from_model(new_empty_model());
    model.set_user_input(0, 1, 1, "=NOW()").unwrap();
    model
        .set_user_input(0, 1, 2, "=SUM(1.234, 3.4, T1:T3, {1,2.4,3})")
        .unwrap();
    model.set_language("fr").unwrap();
    model.set_locale("fr").unwrap();
    let model_bytes = model.to_bytes();

    let model2 = UserModel::from_bytes(&model_bytes, "es").unwrap();
    // Check that the formula has been localized to Spanish
    assert_eq!(model2.get_cell_content(0, 1, 1), Ok("=AHORA()".to_string()));
    assert_eq!(
        model2.get_cell_content(0, 1, 2),
        Ok("=SUMA(1,234;3,4;T1:T3;{1;2,4;3})".to_string())
    );
}

#[test]
fn formulatext_english() {
    let mut model = UserModel::from_model(new_empty_model());
    model.set_user_input(0, 1, 1, "=SUM(1, 2, 3)").unwrap();
    model.set_user_input(0, 1, 2, "=FORMULATEXT(A1)").unwrap();

    model.set_language("de").unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 1, 2),
        Ok("=SUM(1,2,3)".to_string())
    );
}
