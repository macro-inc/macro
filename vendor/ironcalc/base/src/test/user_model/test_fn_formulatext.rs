#![allow(clippy::unwrap_used)]

use crate::test::user_model::util::new_empty_user_model;

#[test]
fn formulatext_english() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "=SUM(1, 2, 3)").unwrap();
    model.set_user_input(0, 1, 2, "=FORMULATEXT(A1)").unwrap();

    model.set_language("de").unwrap();

    assert_eq!(
        model.get_formatted_cell_value(0, 1, 2),
        Ok("=SUM(1,2,3)".to_string())
    );
}
