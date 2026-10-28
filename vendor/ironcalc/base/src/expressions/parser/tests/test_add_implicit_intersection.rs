use std::collections::HashMap;

use crate::expressions::{
    parser::{
        stringify::to_excel_string,
        tests::utils::{new_parser, to_english_localized_string},
    },
    types::CellReferenceRC,
};

use crate::expressions::parser::static_analysis::add_implicit_intersection;

#[test]
fn simple_test() {
    let worksheets = vec!["Sheet1".to_string()];
    let mut parser = new_parser(worksheets, vec![], HashMap::new());

    // Reference cell is Sheet1!A1
    let cell_reference = CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    };
    let cases = vec![
        ("A1:A10*SUM(A1:A10)", "@A1:A10*SUM(A1:A10)"),
        ("A1:A10", "@A1:A10"),
        // Math and trigonometry functions
        ("SUM(A1:A10)", "SUM(A1:A10)"),
        ("SIN(A1:A10)", "SIN(@A1:A10)"),
        ("COS(A1:A10)", "COS(@A1:A10)"),
        ("TAN(A1:A10)", "TAN(@A1:A10)"),
        ("ASIN(A1:A10)", "ASIN(@A1:A10)"),
        ("ACOS(A1:A10)", "ACOS(@A1:A10)"),
        ("ATAN(A1:A10)", "ATAN(@A1:A10)"),
        ("SINH(A1:A10)", "SINH(@A1:A10)"),
        ("COSH(A1:A10)", "COSH(@A1:A10)"),
        ("TANH(A1:A10)", "TANH(@A1:A10)"),
        ("ASINH(A1:A10)", "ASINH(@A1:A10)"),
        ("ACOSH(A1:A10)", "ACOSH(@A1:A10)"),
        ("ATANH(A1:A10)", "ATANH(@A1:A10)"),
        ("ATAN2(A1:A10,B1:B10)", "ATAN2(@A1:A10,@B1:B10)"),
        ("ATAN2(A1:A10,A1)", "ATAN2(@A1:A10,A1)"),
        ("SQRT(A1:A10)", "SQRT(@A1:A10)"),
        ("SQRTPI(A1:A10)", "SQRTPI(@A1:A10)"),
        ("POWER(A1:A10,A1)", "POWER(@A1:A10,A1)"),
        ("POWER(A1:A10,B1:B10)", "POWER(@A1:A10,@B1:B10)"),
        ("MAX(A1:A10)", "MAX(A1:A10)"),
        ("MIN(A1:A10)", "MIN(A1:A10)"),
        ("ABS(A1:A10)", "ABS(@A1:A10)"),
        ("FALSE()", "FALSE()"),
        ("TRUE()", "TRUE()"),
        // Defined names
        ("BADNMAE", "@BADNMAE"),
        // Logical
        ("AND(A1:A10)", "AND(A1:A10)"),
        ("OR(A1:A10)", "OR(A1:A10)"),
        ("NOT(A1:A10)", "NOT(@A1:A10)"),
        ("IF(A1:A10,B1:B10,C1:C10)", "IF(@A1:A10,@B1:B10,@C1:C10)"),
        // CHOOSE value args pass references through: no `@` on the arms. In a
        // scalar position the whole call is wrapped instead; in a range
        // position (e.g. inside SUM) nothing is wrapped.
        ("CHOOSE(2,A1:A10,B1:B10)", "@CHOOSE(2,A1:A10,B1:B10)"),
        (
            "SUM(CHOOSE(2,A1:A10,B1:B10))",
            "SUM(CHOOSE(2,A1:A10,B1:B10))",
        ),
        ("CHOOSE(2,A1,B1)", "CHOOSE(2,A1,B1)"),
        // ROW and COLUMN of a range are vectors: the whole call is wrapped in
        // a scalar position, and nothing is wrapped in a range position.
        ("ROW(A1:A10)", "@ROW(A1:A10)"),
        ("COLUMN(A1:J1)", "@COLUMN(A1:J1)"),
        ("ROW(A1:J1)", "ROW(A1:J1)"),
        ("COLUMN(A1:A10)", "COLUMN(A1:A10)"),
        ("ROW(A1)", "ROW(A1)"),
        ("COLUMN()", "COLUMN()"),
        ("SUM(ROW(A1:A10))", "SUM(ROW(A1:A10))"),
        ("SIN(ROW(A1:A10))", "SIN(@ROW(A1:A10))"),
        // INDIRECT takes one text and gives a reference
        ("INDIRECT(A1:A10)", "@INDIRECT(@A1:A10)"),
        ("INDIRECT(A1:A10,FALSE)", "@INDIRECT(@A1:A10,FALSE)"),
        ("SUM(INDIRECT(A1,FALSE))", "SUM(INDIRECT(A1,FALSE))"),
        // Information
        // ("ISBLANK(A1:A10)", "ISBLANK(A1:A10)"),
        // ("ISERR(A1:A10)", "ISERR(A1:A10)"),
        // ("ISERROR(A1:A10)", "ISERROR(A1:A10)"),
        // ("ISEVEN(A1:A10)", "ISEVEN(A1:A10)"),
        // ("ISLOGICAL(A1:A10)", "ISLOGICAL(A1:A10)"),
        // ("ISNA(A1:A10)", "ISNA(A1:A10)"),
        // ("ISNONTEXT(A1:A10)", "ISNONTEXT(A1:A10)"),
        // ("ISNUMBER(A1:A10)", "ISNUMBER(A1:A10)"),
        // ("ISODD(A1:A10)", "ISODD(A1:A10)"),
        // ("ISREF(A1:A10)", "ISREF(A1:A10)"),
        // ("ISTEXT(A1:A10)", "ISTEXT(A1:A10)"),
    ];
    for (formula, expected) in cases {
        let mut t = parser.parse(formula, &cell_reference);
        add_implicit_intersection(&mut t, true);
        let r = to_english_localized_string(&t, &cell_reference);
        assert_eq!(r, expected);
        let excel_formula = to_excel_string(&t, &cell_reference);
        assert_eq!(excel_formula, formula);
    }
}
