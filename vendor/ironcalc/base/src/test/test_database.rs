#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;
use crate::Model;

#[test]
fn arguments() {
    let mut model = new_empty_model();
    model._set("A1", "=DMIN()");
    model._set("A2", "=DMIN(2)");
    model._set("A3", "=DMIN(1, 2)");
    model._set("A4", "=DMIN(1, 2, 3, 4)");

    model._set("A5", "=DMAX()");
    model._set("A6", "=DMAX(2)");
    model._set("A7", "=DMAX(1, 2)");
    model._set("A8", "=DMAX(1, 2, 3, 4)");

    model._set("A9", "=DAVERAGE()");
    model._set("A10", "=DAVERAGE(2)");
    model._set("A11", "=DAVERAGE(1, 2)");
    model._set("A12", "=DAVERAGE(1, 2, 3, 4)");

    model._set("A13", "=DSUM()");
    model._set("A14", "=DSUM(2)");
    model._set("A15", "=DSUM(1, 2)");
    model._set("A16", "=DSUM(1, 2, 3, 4)");

    model._set("A17", "=DCOUNT()");
    model._set("A18", "=DCOUNT(2)");
    model._set("A19", "=DCOUNT(1, 2)");
    model._set("A20", "=DCOUNT(1, 2, 3, 4)");

    model._set("A21", "=DCOUNTA()");
    model._set("A22", "=DCOUNTA(2)");
    model._set("A23", "=DCOUNTA(1, 2)");
    model._set("A24", "=DCOUNTA(1, 2, 3, 4)");

    model._set("B1", "=DGET()");
    model._set("B2", "=DGET(2)");
    model._set("B3", "=DGET(1, 2)");
    model._set("B4", "=DGET(1, 2, 3, 4)");

    model._set("B5", "=DPRODUCT()");
    model._set("B6", "=DPRODUCT(2)");
    model._set("B7", "=DPRODUCT(1, 2)");
    model._set("B8", "=DPRODUCT(1, 2, 3, 4)");

    model._set("B9", "=DVAR()");
    model._set("B10", "=DVAR(2)");
    model._set("B11", "=DVAR(1, 2)");
    model._set("B12", "=DVAR(1, 2, 3, 4)");

    model._set("B13", "=DVARP()");
    model._set("B14", "=DVARP(2)");
    model._set("B15", "=DVARP(1, 2)");
    model._set("B16", "=DVARP(1, 2, 3, 4)");

    model._set("B17", "=DSTDEV()");
    model._set("B18", "=DSTDEV(2)");
    model._set("B19", "=DSTDEV(1, 2)");
    model._set("B20", "=DSTDEV(1, 2, 3, 4)");

    model._set("B21", "=DSTDEVP()");
    model._set("B22", "=DSTDEVP(2)");
    model._set("B23", "=DSTDEVP(1, 2)");
    model._set("B24", "=DSTDEVP(1, 2, 3, 4)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");

    assert_eq!(model._get_text("A5"), *"#ERROR!");
    assert_eq!(model._get_text("A6"), *"#ERROR!");
    assert_eq!(model._get_text("A7"), *"#ERROR!");
    assert_eq!(model._get_text("A8"), *"#ERROR!");

    assert_eq!(model._get_text("A9"), *"#ERROR!");
    assert_eq!(model._get_text("A10"), *"#ERROR!");
    assert_eq!(model._get_text("A11"), *"#ERROR!");
    assert_eq!(model._get_text("A12"), *"#ERROR!");

    assert_eq!(model._get_text("A13"), *"#ERROR!");
    assert_eq!(model._get_text("A14"), *"#ERROR!");
    assert_eq!(model._get_text("A15"), *"#ERROR!");
    assert_eq!(model._get_text("A16"), *"#ERROR!");

    assert_eq!(model._get_text("A17"), *"#ERROR!");
    assert_eq!(model._get_text("A18"), *"#ERROR!");
    assert_eq!(model._get_text("A19"), *"#ERROR!");
    assert_eq!(model._get_text("A20"), *"#ERROR!");

    assert_eq!(model._get_text("A21"), *"#ERROR!");
    assert_eq!(model._get_text("A22"), *"#ERROR!");
    assert_eq!(model._get_text("A23"), *"#ERROR!");
    assert_eq!(model._get_text("A24"), *"#ERROR!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
    assert_eq!(model._get_text("B3"), *"#ERROR!");
    assert_eq!(model._get_text("B4"), *"#ERROR!");

    assert_eq!(model._get_text("B5"), *"#ERROR!");
    assert_eq!(model._get_text("B6"), *"#ERROR!");
    assert_eq!(model._get_text("B7"), *"#ERROR!");
    assert_eq!(model._get_text("B8"), *"#ERROR!");

    assert_eq!(model._get_text("B9"), *"#ERROR!");
    assert_eq!(model._get_text("B10"), *"#ERROR!");
    assert_eq!(model._get_text("B11"), *"#ERROR!");
    assert_eq!(model._get_text("B12"), *"#ERROR!");

    assert_eq!(model._get_text("B13"), *"#ERROR!");
    assert_eq!(model._get_text("B14"), *"#ERROR!");
    assert_eq!(model._get_text("B15"), *"#ERROR!");
    assert_eq!(model._get_text("B16"), *"#ERROR!");

    assert_eq!(model._get_text("B17"), *"#ERROR!");
    assert_eq!(model._get_text("B18"), *"#ERROR!");
    assert_eq!(model._get_text("B19"), *"#ERROR!");
    assert_eq!(model._get_text("B20"), *"#ERROR!");

    assert_eq!(model._get_text("B21"), *"#ERROR!");
    assert_eq!(model._get_text("B22"), *"#ERROR!");
    assert_eq!(model._get_text("B23"), *"#ERROR!");
    assert_eq!(model._get_text("B24"), *"#ERROR!");
}

#[test]
fn locale_iso_format() {
    // ISO format with YYYY-MM-DD format. Works with any locale.
    let mut model = Model::new_empty("model", "en", "UTC", "en").unwrap();

    // Create database
    model._set("A1", "ID");
    model._set("B1", "Date");
    model._set("C1", "Amount");
    model._set("A2", "1");
    model._set("B2", "2026-01-15");
    model._set("C2", "1200");
    model._set("A3", "2");
    model._set("B3", "2026-03-15");
    model._set("C3", "900");
    model._set("A4", "3");
    model._set("B4", "2026-06-15");
    model._set("C4", "2100");

    // Define criteria
    model._set("A6", "Date");
    model._set("A7", ">=2026-03-01");
    model._set("B6", "Date");
    model._set("B7", "2026-01-15"); // DGET needs an exact match

    // Test functions
    model._set("A9", "=DMIN(A1:C4, C1, A6:A7)");
    model._set("A10", "=DMAX(A1:C4, C1, A6:A7)");
    model._set("A11", "=DAVERAGE(A1:C4, C1, A6:A7)");
    model._set("A12", "=DSUM(A1:C4, C1, A6:A7)");
    model._set("A13", "=DPRODUCT(A1:C4, C1, A6:A7)");
    model._set("A14", "=DGET(A1:C4, C1, B6:B7)");
    model._set("A15", "=DCOUNT(A1:C4, C1, A6:A7)");
    model._set("A16", "=DCOUNTA(A1:C4, C1, A6:A7)");
    model._set("A17", "=DVAR(A1:C4, C1, A6:A7)");
    model._set("A18", "=DVARP(A1:C4, C1, A6:A7)");
    model._set("A19", "=DSTDEV(A1:C4, C1, A6:A7)");
    model._set("A20", "=DSTDEVP(A1:C4, C1, A6:A7)");

    model.evaluate();

    assert_eq!(model._get_text("A9"), *"900");
    assert_eq!(model._get_text("A10"), *"2100");
    assert_eq!(model._get_text("A11"), *"1500");
    assert_eq!(model._get_text("A12"), *"3000");
    assert_eq!(model._get_text("A13"), *"1890000");
    assert_eq!(model._get_text("A14"), *"1200");
    assert_eq!(model._get_text("A15"), *"2");
    assert_eq!(model._get_text("A16"), *"2");
    assert_eq!(model._get_text("A17"), *"720000");
    assert_eq!(model._get_text("A18"), *"360000");
    assert_eq!(model._get_text("A19"), *"848.528137424");
    assert_eq!(model._get_text("A20"), *"600");
}

#[test]
fn locale_uk() {
    // en-GB locale with DD/MM/YYYY format
    let mut model = Model::new_empty("model", "en-GB", "UTC", "en").unwrap();

    // Create database
    model._set("A1", "ID");
    model._set("B1", "Date");
    model._set("C1", "Amount");
    model._set("A2", "1");
    model._set("B2", "15/01/2026");
    model._set("C2", "1200");
    model._set("A3", "2");
    model._set("B3", "15/03/2026");
    model._set("C3", "900");
    model._set("A4", "3");
    model._set("B4", "15/06/2026");
    model._set("C4", "2100");

    // Define criteria
    model._set("A6", "Date");
    model._set("A7", ">=01/03/2026");
    model._set("B6", "Date");
    model._set("B7", "15/01/2026"); // DGET needs an exact match

    // Test functions
    model._set("A9", "=DMIN(A1:C4, C1, A6:A7)");
    model._set("A10", "=DMAX(A1:C4, C1, A6:A7)");
    model._set("A11", "=DAVERAGE(A1:C4, C1, A6:A7)");
    model._set("A12", "=DSUM(A1:C4, C1, A6:A7)");
    model._set("A13", "=DPRODUCT(A1:C4, C1, A6:A7)");
    model._set("A14", "=DGET(A1:C4, C1, B6:B7)");
    model._set("A15", "=DCOUNT(A1:C4, C1, A6:A7)");
    model._set("A16", "=DCOUNTA(A1:C4, C1, A6:A7)");
    model._set("A17", "=DVAR(A1:C4, C1, A6:A7)");
    model._set("A18", "=DVARP(A1:C4, C1, A6:A7)");
    model._set("A19", "=DSTDEV(A1:C4, C1, A6:A7)");
    model._set("A20", "=DSTDEVP(A1:C4, C1, A6:A7)");

    model.evaluate();

    assert_eq!(model._get_text("A9"), *"900");
    assert_eq!(model._get_text("A10"), *"2100");
    assert_eq!(model._get_text("A11"), *"1500");
    assert_eq!(model._get_text("A12"), *"3000");
    assert_eq!(model._get_text("A13"), *"1890000");
    assert_eq!(model._get_text("A14"), *"1200");
    assert_eq!(model._get_text("A15"), *"2");
    assert_eq!(model._get_text("A16"), *"2");
    assert_eq!(model._get_text("A17"), *"720000");
    assert_eq!(model._get_text("A18"), *"360000");
    assert_eq!(model._get_text("A19"), *"848.528137424");
    assert_eq!(model._get_text("A20"), *"600");
}

#[test]
fn locale_us() {
    // en-US locale with MM/DD/YY format
    let mut model = Model::new_empty("model", "en", "UTC", "en").unwrap();

    // Create database
    model._set("A1", "ID");
    model._set("B1", "Date");
    model._set("C1", "Amount");
    model._set("A2", "1");
    model._set("B2", "1/15/26");
    model._set("C2", "1200");
    model._set("A3", "2");
    model._set("B3", "3/15/26");
    model._set("C3", "900");
    model._set("A4", "3");
    model._set("B4", "6/15/26");
    model._set("C4", "2100");

    // Define criteria
    model._set("A6", "Date");
    model._set("A7", ">=3/1/26");
    model._set("B6", "Date");
    model._set("B7", "1/15/26"); // DGET needs an exact match

    // Test functions
    model._set("A9", "=DMIN(A1:C4, C1, A6:A7)");
    model._set("A10", "=DMAX(A1:C4, C1, A6:A7)");
    model._set("A11", "=DAVERAGE(A1:C4, C1, A6:A7)");
    model._set("A12", "=DSUM(A1:C4, C1, A6:A7)");
    model._set("A13", "=DPRODUCT(A1:C4, C1, A6:A7)");
    model._set("A14", "=DGET(A1:C4, C1, B6:B7)");
    model._set("A15", "=DCOUNT(A1:C4, C1, A6:A7)");
    model._set("A16", "=DCOUNTA(A1:C4, C1, A6:A7)");
    model._set("A17", "=DVAR(A1:C4, C1, A6:A7)");
    model._set("A18", "=DVARP(A1:C4, C1, A6:A7)");
    model._set("A19", "=DSTDEV(A1:C4, C1, A6:A7)");
    model._set("A20", "=DSTDEVP(A1:C4, C1, A6:A7)");

    model.evaluate();

    assert_eq!(model._get_text("A9"), *"900");
    assert_eq!(model._get_text("A10"), *"2100");
    assert_eq!(model._get_text("A11"), *"1500");
    assert_eq!(model._get_text("A12"), *"3000");
    assert_eq!(model._get_text("A13"), *"1890000");
    assert_eq!(model._get_text("A14"), *"1200");
    assert_eq!(model._get_text("A15"), *"2");
    assert_eq!(model._get_text("A16"), *"2");
    assert_eq!(model._get_text("A17"), *"720000");
    assert_eq!(model._get_text("A18"), *"360000");
    assert_eq!(model._get_text("A19"), *"848.528137424");
    assert_eq!(model._get_text("A20"), *"600");
}

#[test]
fn locale_de() {
    // de-DE locale with D.M.YYYY format
    let mut model = Model::new_empty("model", "de", "UTC", "en").unwrap();

    // Create database
    model._set("A1", "ID");
    model._set("B1", "Date");
    model._set("C1", "Amount");
    model._set("A2", "1");
    model._set("B2", "15.1.2026");
    model._set("C2", "1200");
    model._set("A3", "2");
    model._set("B3", "15.3.2026");
    model._set("C3", "900");
    model._set("A4", "3");
    model._set("B4", "15.6.2026");
    model._set("C4", "2100");

    // Define criteria
    model._set("A6", "Date");
    model._set("A7", ">=1.3.2026");
    model._set("B6", "Date");
    model._set("B7", "15.1.2026"); // DGET needs an exact match

    // Test functions
    model._set("A9", "=DMIN(A1:C4; C1; A6:A7)");
    model._set("A10", "=DMAX(A1:C4; C1; A6:A7)");
    model._set("A11", "=DAVERAGE(A1:C4; C1; A6:A7)");
    model._set("A12", "=DSUM(A1:C4; C1; A6:A7)");
    model._set("A13", "=DPRODUCT(A1:C4; C1; A6:A7)");
    model._set("A14", "=DGET(A1:C4; C1; B6:B7)");
    model._set("A15", "=DCOUNT(A1:C4; C1; A6:A7)");
    model._set("A16", "=DCOUNTA(A1:C4; C1; A6:A7)");
    model._set("A17", "=DVAR(A1:C4; C1; A6:A7)");
    model._set("A18", "=DVARP(A1:C4; C1; A6:A7)");
    model._set("A19", "=DSTDEV(A1:C4; C1; A6:A7)");
    model._set("A20", "=DSTDEVP(A1:C4; C1; A6:A7)");

    model.evaluate();

    assert_eq!(model._get_text("A9"), *"900");
    assert_eq!(model._get_text("A10"), *"2100");
    assert_eq!(model._get_text("A11"), *"1500");
    assert_eq!(model._get_text("A12"), *"3000");
    assert_eq!(model._get_text("A13"), *"1890000");
    assert_eq!(model._get_text("A14"), *"1200");
    assert_eq!(model._get_text("A15"), *"2");
    assert_eq!(model._get_text("A16"), *"2");
    assert_eq!(model._get_text("A17"), *"720000");
    assert_eq!(model._get_text("A18"), *"360000");
    assert_eq!(model._get_text("A19"), *"848,528137424");
    assert_eq!(model._get_text("A20"), *"600");
}

#[test]
fn locale_wrong_format() {
    // en-US locale with incorrect D.M.YYYY format
    let mut model = Model::new_empty("model", "en", "UTC", "en").unwrap();

    // Create database
    model._set("A1", "ID");
    model._set("B1", "Date");
    model._set("C1", "Amount");
    model._set("A2", "1");
    model._set("B2", "10.1.2026");
    model._set("C2", "1200");
    model._set("A3", "2");
    model._set("B3", "10.3.2026");
    model._set("C3", "900");
    model._set("A4", "3");
    model._set("B4", "10.6.2026");
    model._set("C4", "2100");

    // Define criteria
    model._set("A6", "Date");
    model._set("A7", ">=1.3.2026");
    model._set("B6", "Date");
    model._set("B7", "10.1.2026"); // DGET needs an exact match

    // Test functions - results should be the same as using empty criteria
    model._set("A9", "=DMIN(A1:C4, C1, A6:A7)");
    model._set("A10", "=DMAX(A1:C4, C1, A6:A7)");
    model._set("A11", "=DAVERAGE(A1:C4, C1, A6:A7)");
    model._set("A12", "=DSUM(A1:C4, C1, A6:A7)");
    model._set("A13", "=DPRODUCT(A1:C4, C1, A6:A7)");
    model._set("A14", "=DGET(A1:C4, C1, B6:B7)");
    model._set("A15", "=DCOUNT(A1:C4, C1, A6:A7)");
    model._set("A16", "=DCOUNTA(A1:C4, C1, A6:A7)");
    model._set("A17", "=DVAR(A1:C4, C1, A6:A7)");
    model._set("A18", "=DVARP(A1:C4, C1, A6:A7)");
    model._set("A19", "=DSTDEV(A1:C4, C1, A6:A7)");
    model._set("A20", "=DSTDEVP(A1:C4, C1, A6:A7)");

    // Test functions with empty criteria - range C6:C7 is empty
    model._set("B9", "=DMIN(A1:C4, C1, C6:C7)");
    model._set("B10", "=DMAX(A1:C4, C1, C6:C7)");
    model._set("B11", "=DAVERAGE(A1:C4, C1, C6:C7)");
    model._set("B12", "=DSUM(A1:C4, C1, C6:C7)");
    model._set("B13", "=DPRODUCT(A1:C4, C1, C6:C7)");
    model._set("B14", "=DGET(A1:C4, C1, B6:B7)");
    model._set("B15", "=DCOUNT(A1:C4, C1, C6:C7)");
    model._set("B16", "=DCOUNTA(A1:C4, C1, C6:C7)");
    model._set("B17", "=DVAR(A1:C4, C1, C6:C7)");
    model._set("B18", "=DVARP(A1:C4, C1, C6:C7)");
    model._set("B19", "=DSTDEV(A1:C4, C1, C6:C7)");
    model._set("B20", "=DSTDEVP(A1:C4, C1, C6:C7)");

    model.evaluate();

    assert_eq!(model._get_text("A9"), *"900");
    assert_eq!(model._get_text("A10"), *"2100");
    assert_eq!(model._get_text("A11"), *"1400");
    assert_eq!(model._get_text("A12"), *"4200");
    assert_eq!(model._get_text("A13"), *"2268000000");
    assert_eq!(model._get_text("A14"), *"1200");
    assert_eq!(model._get_text("A15"), *"3");
    assert_eq!(model._get_text("A16"), *"3");
    assert_eq!(model._get_text("A17"), *"390000");
    assert_eq!(model._get_text("A18"), *"260000");
    assert_eq!(model._get_text("A19"), *"624.49979984");
    assert_eq!(model._get_text("A20"), *"509.901951359");

    assert_eq!(model._get_text("B9"), *"900");
    assert_eq!(model._get_text("B10"), *"2100");
    assert_eq!(model._get_text("B11"), *"1400");
    assert_eq!(model._get_text("B12"), *"4200");
    assert_eq!(model._get_text("B13"), *"2268000000");
    assert_eq!(model._get_text("B14"), *"1200");
    assert_eq!(model._get_text("B15"), *"3");
    assert_eq!(model._get_text("B16"), *"3");
    assert_eq!(model._get_text("B17"), *"390000");
    assert_eq!(model._get_text("B18"), *"260000");
    assert_eq!(model._get_text("B19"), *"624.49979984");
    assert_eq!(model._get_text("B20"), *"509.901951359");
}

// The database and criteria arguments go through `get_reference`, whose
// fallback arm evaluates non-literal references (OFFSET, INDIRECT) in
// reference context. The computed ranges must arrive whole.
#[test]
fn computed_database_and_criteria_references() {
    let mut model = new_empty_model();
    model._set("A1", "ID");
    model._set("B1", "Amount");
    model._set("A2", "1");
    model._set("B2", "1200");
    model._set("A3", "2");
    model._set("B3", "900");
    model._set("A4", "3");
    model._set("B4", "2100");

    model._set("A6", "Amount");
    model._set("A7", ">1000");

    // OFFSET(A1,0,0,4,2) -> A1:B4; INDIRECT("A6:A7") -> the criteria range.
    model._set(
        "D1",
        "=DSUM(OFFSET(A1, 0, 0, 4, 2), B1, INDIRECT(\"A6:A7\"))",
    );
    model._set("D2", "=DCOUNT(OFFSET(A1, 0, 0, 4, 2), B1, A6:A7)");
    model._set("D3", "=DMAX(OFFSET(A1, 0, 0, 4, 2), B1, A6:A7)");
    model.evaluate();

    assert_eq!(model._get_text("D1"), *"3300");
    assert_eq!(model._get_text("D2"), *"2");
    assert_eq!(model._get_text("D3"), *"2100");
}
