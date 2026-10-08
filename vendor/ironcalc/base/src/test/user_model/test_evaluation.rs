#![allow(clippy::unwrap_used)]

use crate::test::user_model::util::new_empty_user_model;

#[test]
fn model_evaluates_automatically() {
    let mut model = new_empty_user_model();
    model.set_user_input(0, 1, 1, "=1 + 1").unwrap();

    assert_eq!(model.get_formatted_cell_value(0, 1, 1), Ok("2".to_string()));
    assert_eq!(model.get_cell_content(0, 1, 1), Ok("=1+1".to_string()));
}

#[test]
fn pause_resume_evaluation() {
    let mut model = new_empty_user_model();
    model.pause_evaluation();
    model.set_user_input(0, 1, 1, "=1+1").unwrap();
    assert_eq!(
        model.get_formatted_cell_value(0, 1, 1),
        Ok("#ERROR!".to_string())
    );
    model.evaluate();

    assert_eq!(model.get_formatted_cell_value(0, 1, 1), Ok("2".to_string()));
    assert_eq!(model.get_cell_content(0, 1, 1), Ok("=1+1".to_string()));

    model.resume_evaluation();
    model.set_user_input(0, 2, 1, "=1+4").unwrap();
    assert_eq!(model.get_formatted_cell_value(0, 2, 1), Ok("5".to_string()));
}

//         ║    A    |        C         |
// ════════╬═════════╪══════════════════╪
//    1    ║ =C2     | =RANDARRAY(3,4)  |
// ────────╫─────────┼──────────────────┼
//    2    ║         |                  |
// ────────╫─────────┼──────────────────┼
//
// C1=RANDARRAY(3,4) spills random values into C1:F3.
// A1=C2 reads C2, which is in the spill area of C1.
// In natural order A1 is evaluated before C1 and reads 0 from empty C2.
// After correct evaluation A1 must equal exactly C2.
#[test]
fn randarray() {
    let mut model = new_empty_user_model();

    model.set_user_input(0, 1, 1, "=C2").unwrap();
    model.set_user_input(0, 1, 3, "=RANDARRAY(3,4)").unwrap();

    let a1 = model
        .get_formatted_cell_value(0, 1, 1)
        .unwrap()
        .parse::<f64>()
        .unwrap();
    let c2 = model
        .get_formatted_cell_value(0, 2, 3)
        .unwrap()
        .parse::<f64>()
        .unwrap();
    assert!((a1 - c2).abs() < 1e-6);
    assert!(a1 > 0.0 && a1 < 1.0);
}
