//! Excel stores LAMBDA/LET variable names with an `_xlpm.` prefix, both at the
//! declaration and at every use site:
//!   `=LET(x,1,x*2)` → `_xlfn.LET(_xlpm.x,1,_xlpm.x*2)`
//! These tests check that `to_excel_string` produces that form and that the
//! parser reads it back into the bare internal names.

use crate::expressions::parser::stringify::{to_english_string, to_excel_string};
use crate::expressions::parser::tests::utils::new_parser;
use crate::expressions::types::CellReferenceRC;
use std::collections::HashMap;

fn cell() -> CellReferenceRC {
    CellReferenceRC {
        sheet: "Sheet1".to_string(),
        row: 1,
        column: 1,
    }
}

fn parser() -> crate::expressions::parser::Parser<'static> {
    new_parser(vec!["Sheet1".to_string()], vec![], HashMap::new())
}

#[test]
fn let_exports_variables_with_xlpm_prefix() {
    let mut p = parser();
    let t = p.parse("LET(x,1,adam,2,x+adam)", &cell());
    assert_eq!(
        to_excel_string(&t, &cell()),
        "_xlfn.LET(_xlpm.x,1,_xlpm.adam,2,_xlpm.x+_xlpm.adam)"
    );
}

#[test]
fn lambda_exports_parameter_uses_with_xlpm_prefix() {
    let mut p = parser();
    let t = p.parse("LAMBDA(a,b,SQRT(a*a+b*b))(3,4)", &cell());
    assert_eq!(
        to_excel_string(&t, &cell()),
        "_xlfn.LAMBDA(_xlpm.a,_xlpm.b,SQRT(_xlpm.a*_xlpm.a+_xlpm.b*_xlpm.b))(3,4)"
    );
}

#[test]
fn unbound_names_are_not_prefixed() {
    let mut p = parser();
    let t = p.parse("LAMBDA(a,a+bogus)", &cell());
    assert_eq!(
        to_excel_string(&t, &cell()),
        "_xlfn.LAMBDA(_xlpm.a,_xlpm.a+bogus)"
    );
}

#[test]
fn let_bound_lambda_call_is_prefixed() {
    let mut p = parser();
    let t = p.parse("LET(x,LAMBDA(a,a*a),x(2))", &cell());
    assert_eq!(
        to_excel_string(&t, &cell()),
        "_xlfn.LET(_xlpm.x,_xlfn.LAMBDA(_xlpm.a,_xlpm.a*_xlpm.a),_xlpm.x(2))"
    );
}

#[test]
fn lambda_with_let_body_exports_and_round_trips() {
    let mut p = parser();
    let internal = "LAMBDA(mo,LET(anchor,DATE(cal_year,mo,1),first_mon,anchor-(WEEKDAY(anchor,2)-1),IF(MONTH(first_mon)=mo,DAY(first_mon),\"\")))";
    let t = p.parse(internal, &cell());
    let excel = to_excel_string(&t, &cell());
    assert_eq!(
        excel,
        "_xlfn.LAMBDA(_xlpm.mo,_xlfn.LET(_xlpm.anchor,DATE(cal_year,_xlpm.mo,1),_xlpm.first_mon,_xlpm.anchor-(WEEKDAY(_xlpm.anchor,2)-1),IF(MONTH(_xlpm.first_mon)=_xlpm.mo,DAY(_xlpm.first_mon),\"\")))"
    );
    // Importing the Excel form gives back the bare internal names.
    let t = p.parse(&excel, &cell());
    assert_eq!(to_english_string(&t, &cell()), internal);
}

#[test]
fn shadowed_variables_are_prefixed_in_both_scopes() {
    let mut p = parser();
    let t = p.parse("LAMBDA(x,LET(x,x+1,x*2))", &cell());
    assert_eq!(
        to_excel_string(&t, &cell()),
        "_xlfn.LAMBDA(_xlpm.x,_xlfn.LET(_xlpm.x,_xlpm.x+1,_xlpm.x*2))"
    );
}
