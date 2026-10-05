#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_formulas() {
    let mut model = new_empty_model();
    model
        .set_user_input(0, 1, 1, "$100.348".to_string())
        .unwrap();
    model
        .set_user_input(0, 1, 2, "=ISNUMBER(A1)".to_string())
        .unwrap();

    model.evaluate();

    assert_eq!(
        model.get_localized_cell_content(0, 1, 1).unwrap(),
        "100.348"
    );
    assert_eq!(
        model.get_localized_cell_content(0, 1, 2).unwrap(),
        "=ISNUMBER(A1)"
    );
    assert_eq!(model.get_localized_cell_content(0, 5, 5).unwrap(), "");

    assert!(model.get_localized_cell_content(1, 1, 2).is_err());
}
