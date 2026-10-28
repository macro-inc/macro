#![allow(clippy::unwrap_used)]

use crate::{cell::CellValue, test::util::new_empty_model};

#[test]
fn fn_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=PMT()");
    model._set("A2", "=PMT(1,1)");
    model._set("A3", "=PMT(1,1,1,1,1,1)");

    model._set("B1", "=FV()");
    model._set("B2", "=FV(1,1)");
    model._set("B3", "=FV(1,1,1,1,1,1)");

    model._set("C1", "=PV()");
    model._set("C2", "=PV(1,1)");
    model._set("C3", "=PV(1,1,1,1,1,1)");

    model._set("D1", "=NPER()");
    model._set("D2", "=NPER(1,1)");
    model._set("D3", "=NPER(1,1,1,1,1,1)");

    model._set("E1", "=RATE()");
    model._set("E2", "=RATE(1,1)");
    model._set("E3", "=RATE(1,1,1,1,1,1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
    assert_eq!(model._get_text("C3"), *"#ERROR!");

    assert_eq!(model._get_text("D1"), *"#ERROR!");
    assert_eq!(model._get_text("D2"), *"#ERROR!");
    assert_eq!(model._get_text("D3"), *"#ERROR!");

    assert_eq!(model._get_text("E1"), *"#ERROR!");
    assert_eq!(model._get_text("E2"), *"#ERROR!");
    assert_eq!(model._get_text("E3"), *"#ERROR!");
}

#[test]
fn fn_impmt_ppmt_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=IPMT()");
    model._set("A2", "=IPMT(1,1,1)");
    model._set("A3", "=IPMT(1,1,1,1,1,1,1)");

    model._set("B1", "=PPMT()");
    model._set("B2", "=PPMT(1,1,1)");
    model._set("B3", "=PPMT(1,1,1,1,1,1,1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

#[test]
fn fn_irr_npv_arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=NPV()");
    model._set("A2", "=NPV(1,1)");

    model._set("C1", "-2"); // v0
    model._set("C2", "5"); // v1
    model._set("B1", "=IRR()");
    model._set("B3", "=IRR(1, 2, 3, 4)");
    // r such that v0 + v1/(1+r) = 0
    // r = -v1/v0 - 1
    model._set("B4", "=IRR(C1:C2)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"$0.50");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
    // r = 5/2-1 = 1.5
    assert_eq!(model._get_text("B4"), *"150%");
}

#[test]
fn fn_mirr() {
    let mut model = new_empty_model();
    model._set("A2", "-120000");
    model._set("A3", "39000");
    model._set("A4", "30000");
    model._set("A5", "21000");
    model._set("A6", "37000");
    model._set("A7", "46000");
    model._set("A8", "0.1");
    model._set("A9", "0.12");

    model._set("B1", "=MIRR(A2:A7, A8, A9)");
    model._set("B2", "=MIRR(A2:A5, A8, A9)");

    model.evaluate();
    assert_eq!(
        model.get_cell_value_by_ref("Sheet1!B1"),
        Ok(CellValue::Number(0.1260941303659051))
    );
    assert_eq!(model._get_text("B1"), "13%");
    assert_eq!(model._get_text("B2"), "-5%");
}

#[test]
fn fn_mirr_div_0() {
    // This test produces #DIV/0! in Excel (but it is incorrect)
    let mut model = new_empty_model();
    model._set("A2", "-30");
    model._set("A3", "-20");
    model._set("A4", "-10");
    model._set("A5", "5");
    model._set("A6", "5");
    model._set("A7", "5");
    model._set("A8", "-1");
    model._set("A9", "2");

    model._set("B1", "=MIRR(A2:A7, A8, A9)");

    model.evaluate();
    assert_eq!(
        model.get_cell_value_by_ref("Sheet1!B1"),
        Ok(CellValue::Number(-1.0))
    );
    assert_eq!(model._get_text("B1"), "-100%");
}

#[test]
fn fn_ispmt() {
    let mut model = new_empty_model();
    model._set("A1", "1"); // rate
    model._set("A2", "2"); // per
    model._set("A3", "5"); // nper
    model._set("A4", "4"); // pv

    model._set("B1", "=ISPMT(A1, A2, A3, A4)");
    model._set("B2", "=ISPMT(A1, A2, A3, A4, 1)");
    model._set("B3", "=ISPMT(A1, A2, A3)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "-2.4");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

#[test]
fn fn_rri() {
    let mut model = new_empty_model();
    model._set("A1", "1"); // nper
    model._set("A2", "2"); // pv
    model._set("A3", "3"); // fv

    model._set("B1", "=RRI(A1, A2, A3)");
    model._set("B2", "=RRI(A1, A2)");
    model._set("B3", "=RRI(A1, A2, A3, 1)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "0.5");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

#[test]
fn fn_sln() {
    let mut model = new_empty_model();
    model._set("A1", "1"); // cost
    model._set("A2", "2"); // salvage
    model._set("A3", "3"); // life

    model._set("B1", "=SLN(A1, A2, A3)");
    model._set("B2", "=SLN(A1, A2)");
    model._set("B3", "=SLN(A1, A2, A3, 1)");

    model.evaluate();

    assert_eq!(
        model.get_cell_value_by_ref("Sheet1!B1"),
        Ok(CellValue::Number(-1.0 / 3.0))
    );
    assert_eq!(model._get_text("B1"), "-$0.33");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

#[test]
fn fn_syd() {
    let mut model = new_empty_model();
    model._set("A1", "100"); // cost
    model._set("A2", "5"); // salvage
    model._set("A3", "20"); // life
    model._set("A4", "10"); // periods

    model._set("B1", "=SYD(A1, A2, A3, A4)");
    model._set("B2", "=SYD(A1, A2, A3)");
    model._set("B3", "=SYD(A1, A2, A3, A4, 1)");

    model.evaluate();

    assert_eq!(
        model.get_cell_value_by_ref("Sheet1!B1"),
        Ok(CellValue::Number(4.976190476190476))
    );
    assert_eq!(model._get_text("B1"), "$4.98");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

#[test]
fn fn_effect() {
    let mut model = new_empty_model();
    model._set("A1", "2"); // rate
    model._set("A2", "1"); // periods

    model._set("B1", "=EFFECT(A1, A2)");
    model._set("B2", "=EFFECT(A1)");
    model._set("B3", "=EFFECT(A1, A2, A3)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

#[test]
fn fn_nominal() {
    let mut model = new_empty_model();
    model._set("A1", "2"); // rate
    model._set("A2", "1"); // periods

    model._set("B1", "=NOMINAL(A1, A2)");
    model._set("B2", "=NOMINAL(A1)");
    model._set("B3", "=NOMINAL(A1, A2, A3)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "2");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

#[test]
fn fn_db() {
    let mut model = new_empty_model();
    model._set("A2", "$1,000,000"); // cost
    model._set("A3", "$100,000"); // salvage
    model._set("A4", "6"); // life

    model._set("B1", "=DB(A2,A3,A4,1,7)");
    model._set("B2", "=DB(A2,A3,A4,2,7)");
    model._set("B3", "=DB(A2,A3,A4,3,7)");
    model._set("B4", "=DB(A2,A3,A4,4,7)");
    model._set("B5", "=DB(A2,A3,A4,5,7)");
    model._set("B6", "=DB(A2,A3,A4,6,7)");
    model._set("B7", "=DB(A2,A3,A4,7,7)");

    model._set("C1", "=DB(A2,A3,A4,7,7,1)");
    model._set("C2", "=DB(A2,A3,A4)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "$186,083.33");
    assert_eq!(model._get_text("B2"), "$259,639.42");
    assert_eq!(model._get_text("B3"), "$176,814.44");
    assert_eq!(model._get_text("B4"), "$120,410.64");
    assert_eq!(model._get_text("B5"), "$81,999.64");
    assert_eq!(model._get_text("B6"), "$55,841.76");
    assert_eq!(model._get_text("B7"), "$15,845.10");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
}

#[test]
fn fn_ddb() {
    let mut model = new_empty_model();
    model._set("A2", "$2,400"); // cost
    model._set("A3", "$300"); // salvage
    model._set("A4", "10"); // life

    model._set("B1", "=DDB(A2,A3,A4*365,1)");
    model._set("B2", "=DDB(A2,A3,A4*12,1,2)");
    model._set("B3", "=DDB(A2,A3,A4,1,2)");
    model._set("B4", "=DDB(A2,A3,A4,2,1.5)");
    model._set("B5", "=DDB(A2,A3,A4,10)");

    model._set("C1", "=DB(A2,A3,A4,7,7,1)");
    model._set("C2", "=DB(A2,A3,A4)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "$1.32");
    assert_eq!(model._get_text("B2"), "$40.00");
    assert_eq!(model._get_text("B3"), "$480.00");
    assert_eq!(model._get_text("B4"), "$306.00");
    assert_eq!(model._get_text("B5"), "$22.12");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
}

#[test]
fn fn_tbilleq() {
    let mut model = new_empty_model();
    model._set("A2", "=DATE(2008, 3, 31)"); // settlement date
    model._set("A3", "=DATE(2008, 6, 1)"); // maturity date
    model._set("A4", "9.14%");

    model._set("B1", "=TBILLEQ(A2,A3,A4)");

    model._set("C1", "=TBILLEQ(A2,A3)");
    model._set("C2", "=TBILLEQ(A2,A3,A4,1)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "9.42%");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
}

#[test]
fn fn_tbillprice() {
    let mut model = new_empty_model();
    model._set("A2", "=DATE(2008, 3, 31)"); // settlement date
    model._set("A3", "=DATE(2008, 6, 1)"); // maturity date
    model._set("A4", "9.0%");

    model._set("B1", "=TBILLPRICE(A2,A3,A4)");

    model._set("C1", "=TBILLPRICE(A2,A3)");
    model._set("C2", "=TBILLPRICE(A2,A3,A4,1)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "$98.45");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
}

#[test]
fn fn_tbillyield() {
    let mut model = new_empty_model();
    model._set("A2", "=DATE(2008, 3, 31)"); // settlement date
    model._set("A3", "=DATE(2008, 6, 1)"); // maturity date
    model._set("A4", "$98.45");

    model._set("B1", "=TBILLYIELD(A2,A3,A4)");

    model._set("C1", "=TBILLYIELD(A2,A3)");
    model._set("C2", "=TBILLYIELD(A2,A3,A4,1)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "9.14%");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
}

#[test]
fn fn_dollarde() {
    let mut model = new_empty_model();
    model._set("A1", "=DOLLARDE(1.02, 16)");
    model._set("A2", "=DOLLARDE(1.1, 32)");

    model._set("C1", "=DOLLARDE(1.1)");
    model._set("C2", "=DOLLARDE(1.1, 32, 1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "1.125");
    assert_eq!(model._get_text("A2"), "1.3125");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
}

#[test]
fn fn_dollarfr() {
    let mut model = new_empty_model();
    model._set("A1", "=DOLLARFR(1.125,16)");
    model._set("A2", "=DOLLARFR(1.125,32)");

    model._set("C1", "=DOLLARFR(1.1)");
    model._set("C2", "=DOLLARFR(1.1, 32, 1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "1.02");
    assert_eq!(model._get_text("A2"), "1.04");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
}

#[test]
fn fn_cumipmt() {
    let mut model = new_empty_model();
    model._set("A2", "9%"); // annual interest rate
    model._set("A3", "30"); // years of the load
    model._set("A4", "$125,000"); // present value

    model._set("B1", "=CUMIPMT(A2/12,A3*12,A4,13,24,0)");
    model._set("B2", "=CUMIPMT(A2/12,A3*12,A4,1,1,0)");

    model._set("C1", "=CUMIPMT(A2/12,A3*12,A4,1,1,0,1)");
    model._set("C2", "=CUMIPMT(A2/12,A3*12,A4,1,1)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "-$11,135.23");
    assert_eq!(model._get_text("B2"), "-$937.50");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
}

#[test]
fn fn_cumprinc() {
    let mut model = new_empty_model();
    model._set("A2", "9%"); // annual interest rate
    model._set("A3", "30"); // years of the load
    model._set("A4", "$125,000"); // present value

    model._set("B1", "=CUMPRINC(A2/12,A3*12,A4,13,24,0)");
    model._set("B2", "=CUMPRINC(A2/12,A3*12,A4,1,1,0)");

    model._set("C1", "=CUMPRINC(A2/12,A3*12,A4,1,1,0,1)");
    model._set("C2", "=CUMPRINC(A2/12,A3*12,A4,1,1)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "-$934.11");
    assert_eq!(model._get_text("B2"), "-$68.28");

    assert_eq!(model._get_text("C1"), *"#ERROR!");
    assert_eq!(model._get_text("C2"), *"#ERROR!");
}

#[test]
fn fn_db_misc() {
    let mut model = new_empty_model();

    model._set("B1", "=DB(0,10,1,2,2)");

    model.evaluate();

    assert_eq!(model._get_text("B1"), "$0.00");
}

// ── whole-column range and a spill beyond the used area ─────────────────────

// A whole-column range is clipped to the sheet's used area before it is
// walked. Inside an anchor, the column may be spilled on demand during the
// walk, past the bound the walk was clipped to. The skipped part is on
// record, so the spill restarts the pass and the second run sees it all.
#[test]
fn fn_npv_whole_column_sees_a_spill_beyond_the_used_area() {
    let mut model = new_empty_model();
    model._set("A1", "=SEQUENCE(1,1,NPV(0.1,D:D))");
    model._set("C1", "=SEQUENCE(3,1,10)");
    model._set("D1", "=SEQUENCE(5)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "10.652588311");
    assert_eq!(model.evaluation.restarts_in_last_evaluation, 1);

    model.evaluate();
    assert_eq!(model._get_text("A1"), "10.652588311");
    assert_eq!(model.evaluation.restarts_in_last_evaluation, 0);
}
