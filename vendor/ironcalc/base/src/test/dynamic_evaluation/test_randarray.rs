#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

//         ║    A    |        C         |
// ════════╬═════════╪══════════════════╪
//    1    ║ =C2*4   | =RANDARRAY(3,4)  |
// ────────╫─────────┼──────────────────┼
//    2    ║         |                  |
// ────────╫─────────┼──────────────────┼
//
// C1=RANDARRAY(3,4) spills random values into C1:F3.
// A1=C2*4 reads C2, which is in the spill area of C1.
// In natural order A1 is evaluated before C1 and reads 0 from empty C2.
// After correct evaluation A1 must equal exactly C2*4.
#[test]
fn randarray() {
    let mut model = new_empty_model();

    model._set("A1", "=C2*4");
    model._set("C1", "=RANDARRAY(3,4)");

    model.evaluate();

    let a1 = model._get_text("A1").parse::<f64>().unwrap();
    let c2 = model._get_text("C2").parse::<f64>().unwrap();
    assert!((a1 - c2 * 4.0).abs() < 1e-6);
}
