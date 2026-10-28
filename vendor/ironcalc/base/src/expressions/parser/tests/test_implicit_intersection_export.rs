use std::collections::HashMap;

use crate::expressions::{
    parser::{
        stringify::{to_excel_array_formula_string, to_excel_string},
        tests::utils::{new_parser, to_english_localized_string},
    },
    types::CellReferenceRC,
};

use crate::expressions::parser::static_analysis::add_implicit_intersection;

// Round-trips a formula the way an xlsx import/export does:
//   1. parse the Excel formula
//   2. add the automatic implicit intersection operators (the import step)
//   3. check the internal representation (where every II is shown as `@`)
//   4. stringify back to Excel and check we get `expected_excel`
//
// The interesting bit is step 4: an explicit `@` (`_xlfn.SINGLE`) sitting in a
// *vector* argument (GCD, LCM, SUM, ...) must be preserved, because on the next
// import nothing would re-insert it. An `@` in a *scalar* context (SIN, the
// formula root, ...) is dropped, because the import re-adds it automatically.
fn check(cases: &[(&str, &str, &str)]) {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };

    for (excel_input, internal, expected_excel) in cases {
        let mut t = parser.parse(excel_input, &cell_reference);
        add_implicit_intersection(&mut t, true);

        let r = to_english_localized_string(&t, &cell_reference);
        assert_eq!(&r, internal, "internal form of `{excel_input}`");

        let excel_formula = to_excel_string(&t, &cell_reference);
        assert_eq!(
            &excel_formula, expected_excel,
            "Excel export of `{excel_input}`"
        );
    }
}

// GCD/LCM accept ranges (vector arguments), so an explicit `@` on a range argument
// is meaningful and must survive the export. This is the regression behind the
// LCM_GCD_minimal calc test: dropping `_xlfn.SINGLE` turned `@J:J` into the whole
// column, making LCM collapse to 0 and GCD to 1.
#[test]
fn gcd_lcm_keep_explicit_intersection() {
    check(&[
        (
            "GCD(A1,B1,_xlfn.SINGLE(J1:J10))",
            "GCD(A1,B1,@J1:J10)",
            "GCD(A1,B1,_xlfn.SINGLE(J1:J10))",
        ),
        (
            "LCM(A1,B1,_xlfn.SINGLE(J1:J10))",
            "LCM(A1,B1,@J1:J10)",
            "LCM(A1,B1,_xlfn.SINGLE(J1:J10))",
        ),
        // Full-column form, exactly as in the failing workbook.
        (
            "LCM(A1,B1,_xlfn.SINGLE(J:J))",
            "LCM(A1,B1,@J:J)",
            "LCM(A1,B1,_xlfn.SINGLE(J:J))",
        ),
    ]);
}

// SUM is also a vector argument: the explicit operator must be preserved.
#[test]
fn sum_keeps_explicit_intersection() {
    check(&[
        (
            "SUM(_xlfn.SINGLE(A1:A10))",
            "SUM(@A1:A10)",
            "SUM(_xlfn.SINGLE(A1:A10))",
        ),
        (
            "SUM(A1:A10,_xlfn.SINGLE(B1:B10))",
            "SUM(A1:A10,@B1:B10)",
            "SUM(A1:A10,_xlfn.SINGLE(B1:B10))",
        ),
    ]);
}

// In a scalar context the operator is redundant: the import re-inserts it, so the
// export drops `_xlfn.SINGLE`. This is the behaviour we must NOT lose for vector
// arguments above.
#[test]
fn scalar_context_drops_redundant_intersection() {
    check(&[
        // SIN forces intersection on its argument anyway.
        ("SIN(_xlfn.SINGLE(A1:A10))", "SIN(@A1:A10)", "SIN(A1:A10)"),
        // The formula root is a scalar context.
        ("_xlfn.SINGLE(A1:A10)", "@A1:A10", "A1:A10"),
    ]);
}

// A `@` on something that is already a single cell is kept (Excel would not
// re-add it, and `add_implicit_intersection` does not either).
#[test]
fn explicit_intersection_on_single_cell_is_kept() {
    check(&[
        ("_xlfn.SINGLE(A1)", "@A1", "_xlfn.SINGLE(A1)"),
        ("SUM(_xlfn.SINGLE(A1))", "SUM(@A1)", "SUM(_xlfn.SINGLE(A1))"),
    ]);
}

// The same range `@J:J` is exported differently depending on the surrounding
// function: kept inside the vector argument of LCM, dropped inside the scalar
// argument of SIN.
#[test]
fn same_range_depends_on_context() {
    check(&[
        (
            "LCM(_xlfn.SINGLE(J:J))",
            "LCM(@J:J)",
            "LCM(_xlfn.SINGLE(J:J))",
        ),
        ("SIN(_xlfn.SINGLE(J:J))", "SIN(@J:J)", "SIN(J:J)"),
    ]);
}

#[test]
fn sumif_unique() {
    let test_str = r#"LARGE(SUMIF(E2:E7,UNIQUE(FILTER(E2:E7,E2:E7<>""))),B27)"#;
    let test_excel = r#"LARGE(SUMIF(E2:E7,_xlfn.UNIQUE(_xlfn._xlws.FILTER(E2:E7,E2:E7<>""))),B27)"#;
    check(&[(test_excel, test_str, test_excel)]);
}

// Nested redundant operators must collapse completely. After dropping the outer
// `@` in a scalar context the child is still in that same scalar context, so the
// cleanup must continue there: `_xlfn.SINGLE(_xlfn.SINGLE(A1:A10))` has to export
// as `A1:A10`, not `_xlfn.SINGLE(A1:A10)`.
//
// Note: this parses the formula directly (without `add_implicit_intersection`,
// which collapses double-`@` on its own) to exercise `to_excel_string`'s own
// normalization on a nested tree.
#[test]
fn nested_redundant_intersections_are_fully_removed() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let t = parser.parse("_xlfn.SINGLE(_xlfn.SINGLE(A1:A10))", &cell_reference);
    let excel_formula = to_excel_string(&t, &cell_reference);
    assert_eq!(excel_formula, "A1:A10");
}

// The formula of an array, CSE or dynamic, is read as it is written: no
// implicit intersection is added to it. So none is redundant there, and they
// are all exported. As the formula of a normal cell the same `@` would be
// dropped, to be added again when read.
#[test]
fn array_formulas_keep_every_intersection() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    // (the formula in Excel, in a normal cell, in an array)
    let cases = [
        (
            "POWER(_xlfn.SINGLE(A1:A3),3)",
            "POWER(A1:A3,3)",
            "POWER(_xlfn.SINGLE(A1:A3),3)",
        ),
        (
            "SIN(_xlfn.SINGLE(A1:A3))+B1:B3",
            "SIN(A1:A3)+B1:B3",
            "SIN(_xlfn.SINGLE(A1:A3))+B1:B3",
        ),
        ("_xlfn.SINGLE(A1:A3)", "A1:A3", "_xlfn.SINGLE(A1:A3)"),
        (
            "SUM(_xlfn.SINGLE(A1:A3))",
            "SUM(_xlfn.SINGLE(A1:A3))",
            "SUM(_xlfn.SINGLE(A1:A3))",
        ),
        // Nothing is added to a formula that has none
        ("POWER(A1:A3,3)", "POWER(A1:A3,3)", "POWER(A1:A3,3)"),
        ("A1:A3*2", "A1:A3*2", "A1:A3*2"),
    ];
    for (excel_input, normal_cell, array) in cases {
        let t = parser.parse(excel_input, &cell_reference);
        assert_eq!(
            to_excel_string(&t, &cell_reference),
            normal_cell,
            "`{excel_input}` in a normal cell"
        );
        assert_eq!(
            to_excel_array_formula_string(&t, &cell_reference),
            array,
            "`{excel_input}` in an array"
        );
    }
}
