#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

//         ║    A    |   B   |    C     |
// ════════╬═════════╪═══════╪══════════╪
//    1    ║ =C2*4   |   4   | =B1:B2   |
// ────────╫─────────┼───────┼──────────┼
//    2    ║         |   5   |          |
// ────────╫─────────┼───────┼──────────┼
//
// C1=B1:B2 spills to C1=B1=4 and C2=B2=5.
// A1=C2*4 reads C2, which is the spill area of C1.
// In natural order A1 is evaluated before C1 and gets the wrong result.
#[test]
fn wrong_order() {
    let mut model = new_empty_model();

    model._set("A1", "=C2*4");
    model._set("B1", "4");
    model._set("B2", "5");
    model._set("C1", "=B1:B2");

    model.evaluate();

    assert_eq!(model._get_text("C1"), "4");
    assert_eq!(model._get_text("C2"), "5");
    assert_eq!(model._get_text("A1"), "20");
}

//         ║    A     |    B    |    D    |   E   |
// ════════╬══════════╪═════════╪═════════╪═══════╪
//    1    ║ =B2+D2   | =D1:D2  | =E1:E2  |  10   |
// ────────╫──────────┼─────────┼─────────┼───────┼
//    2    ║          |         |         |  20   |
// ────────╫──────────┼─────────┼─────────┼───────┼
//
// D1=E1:E2 spills to D1=10, D2=20.
// B1=D1:D2 spills to B1=D1=10, B2=D2=20 (reads D's spill area).
// A1=B2+D2 reads both spill areas; should be 20+20=40.
// In natural order A is evaluated before B and D, giving wrong results.
#[test]
fn dependency_chain() {
    let mut model = new_empty_model();

    model._set("A1", "=B2+D2");
    model._set("B1", "=D1:D2");
    model._set("D1", "=E1:E2");
    model._set("E1", "10");
    model._set("E2", "20");

    model.evaluate();

    assert_eq!(model._get_text("D1"), "10");
    assert_eq!(model._get_text("D2"), "20");
    assert_eq!(model._get_text("B1"), "10");
    assert_eq!(model._get_text("B2"), "20");
    assert_eq!(model._get_text("A1"), "40");
}
