#![allow(clippy::unwrap_used)]

use crate::model::Model;
use crate::test::util::new_empty_model;

#[test]
fn test_fn_sumifs_arguments() {
    let mut model = new_empty_model();

    // Incorrect number of arguments
    model._set("A1", "=SUMIFS()");
    model._set("A2", "=SUMIFS(B2:B9)");
    model._set("A3", "=SUMIFS(B2:B9,C2:C9)");
    model._set("A4", "=SUMIFS(B2:B9,C2:C9,\"=A*\",D2:D9)");

    // Correct (Sum everything in column 'B' if column 'C' starts with "A")
    model._set("A5", "=SUMIFS(B2:B9,C2:C9,\"=A*\")");

    // Data
    model._set("B2", "5");
    model._set("B3", "4");
    model._set("B4", "15");
    model._set("B5", "22");
    model._set("B6", "=NA()");
    model._set("C2", "Apples");
    model._set("C3", "Bananas");
    model._set("C4", "Almonds");
    model._set("C5", "Yoni");
    model._set("C6", "Mandarin");

    model.evaluate();

    // Error (Incorrect number of arguments)
    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");

    // Correct
    assert_eq!(model._get_text("A5"), *"20");
}

// Date-string criteria reach build_criteria via two distinct paths:
//   * fn_countifs has its own criteria loop (covered by test_fn_count.rs)
//   * apply_ifs is the shared path behind SUMIF, SUMIFS, AVERAGEIF,
//     AVERAGEIFS, MAXIFS, MINIFS — exercised here.
//
// Layout:
//   B2..B8  = 45131..45137 (2023-07-24 .. 2023-07-30, all "<7/31/2023")
//   B9      = 45138        (2023-07-31, the criterion target)
//   B10..B11= 45139, 45200 (after 7/31/2023)
//   C2..C8  = 1..7         (matches "<7/31/2023")
//   C9      = 100          (matches "7/31/2023")
//   C10..C11= 99, 50       (matches ">7/31/2023")
fn populate_date_apply_ifs_data(model: &mut Model) {
    let date_serials = [45131, 45132, 45133, 45134, 45135, 45136, 45137];
    let values = [1, 2, 3, 4, 5, 6, 7];
    for (idx, (serial, value)) in date_serials.iter().zip(values.iter()).enumerate() {
        let row = idx + 2;
        model._set(&format!("B{row}"), &serial.to_string());
        model._set(&format!("C{row}"), &value.to_string());
    }
    model._set("B9", "45138");
    model._set("C9", "100");
    model._set("B10", "45139");
    model._set("C10", "99");
    model._set("B11", "45200");
    model._set("C11", "50");
}

#[test]
fn test_apply_ifs_date_criterion_covers_all_consumers() {
    // One worksheet, one criterion shape, every apply_ifs consumer probed.
    // If a future change drops the locale at the apply_ifs call site, every
    // assertion below collapses to 0 / DIV-by-0 and the test fails loudly.
    let mut model = new_empty_model();
    populate_date_apply_ifs_data(&mut model);

    // SUMIF / SUMIFS — sum of C where B "<7/31/2023" is 1+2+3+4+5+6+7 = 28
    model._set("A1", "=SUMIF(B2:B11, \"<7/31/2023\", C2:C11)");
    model._set("A2", "=SUMIFS(C2:C11, B2:B11, \"<7/31/2023\")");
    // AVERAGEIF / AVERAGEIFS — 28 / 7 = 4
    model._set("A3", "=AVERAGEIF(B2:B11, \"<7/31/2023\", C2:C11)");
    model._set("A4", "=AVERAGEIFS(C2:C11, B2:B11, \"<7/31/2023\")");
    // MAXIFS / MINIFS over the same range
    model._set("A5", "=MAXIFS(C2:C11, B2:B11, \"<7/31/2023\")");
    model._set("A6", "=MINIFS(C2:C11, B2:B11, \"<7/31/2023\")");

    // Use a different operator (>=) on SUMIFS / MAXIFS / MINIFS to exercise
    // a second branch of build_criteria through the apply_ifs path.
    // C cells where B >= 7/31/2023 are C9=100, C10=99, C11=50 -> sum 249
    model._set("A7", "=SUMIFS(C2:C11, B2:B11, \">=7/31/2023\")");
    model._set("A8", "=MAXIFS(C2:C11, B2:B11, \">=7/31/2023\")");
    model._set("A9", "=MINIFS(C2:C11, B2:B11, \">=7/31/2023\")");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"28");
    assert_eq!(model._get_text("A2"), *"28");
    assert_eq!(model._get_text("A3"), *"4");
    assert_eq!(model._get_text("A4"), *"4");
    assert_eq!(model._get_text("A5"), *"7");
    assert_eq!(model._get_text("A6"), *"1");
    assert_eq!(model._get_text("A7"), *"249");
    assert_eq!(model._get_text("A8"), *"100");
    assert_eq!(model._get_text("A9"), *"50");
}

#[test]
fn test_apply_ifs_date_criterion_respects_locale() {
    // Build the same workbook under en-GB (D/M/Y). "31/7/2023" is only a
    // valid date under a D/M/Y locale; if apply_ifs ever stops forwarding
    // self.locale to build_criteria, en's M/D/Y rules would reject this
    // string and SUMIFS would collapse to 0.
    let mut model = Model::new_empty("model", "en-GB", "UTC", "en").unwrap();
    populate_date_apply_ifs_data(&mut model);

    model._set("A1", "=SUMIFS(C2:C11, B2:B11, \"<31/7/2023\")");
    model._set("A2", "=AVERAGEIFS(C2:C11, B2:B11, \"<31/7/2023\")");
    model._set("A3", "=MAXIFS(C2:C11, B2:B11, \"<31/7/2023\")");
    model._set("A4", "=MINIFS(C2:C11, B2:B11, \"<31/7/2023\")");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"28");
    assert_eq!(model._get_text("A2"), *"4");
    assert_eq!(model._get_text("A3"), *"7");
    assert_eq!(model._get_text("A4"), *"1");
}

// ── whole-column range and a spill beyond the used area ─────────────────────

// A whole-column range is clipped to the sheet's used area before it is
// walked. Inside an anchor, the column may be spilled on demand during the
// walk, past the bound the walk was clipped to. The skipped part is on
// record, so the spill restarts the pass and the second run sees it all.
#[test]
fn test_fn_sumifs_whole_column_sees_a_spill_beyond_the_used_area() {
    let cases = [
        ("SUMIF(D:D,\">2\")", "12"),
        ("SUMIFS(D:D,D:D,\">2\")", "12"),
    ];
    for (formula, expected) in cases {
        let mut model = new_empty_model();
        model._set("A1", &format!("=SEQUENCE(1,1,{formula})"));
        model._set("C1", "=SEQUENCE(3,1,10)");
        model._set("D1", "=SEQUENCE(5)");
        model.evaluate();
        assert_eq!(model._get_text("A1"), expected, "{formula}");
        assert_eq!(model.evaluation.restarts_in_last_evaluation, 1, "{formula}");
    }
}
