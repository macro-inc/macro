#![allow(clippy::unwrap_used)]
#![allow(clippy::print_stdout)]
use crate::test::util::new_empty_model;

// These tests are grouped because in many cases XOR and OR have similar behaviour.

// Test specific to xor
#[test]
fn fn_xor() {
    let mut model = new_empty_model();

    model._set("A1", "=XOR(1, 1, 1, 0, 0)");
    model._set("A2", "=XOR(1, 1, 0, 0, 0)");
    model._set("A3", "=XOR(TRUE, TRUE, TRUE, FALSE, FALSE)");
    model._set("A4", "=XOR(TRUE, TRUE, FALSE, FALSE, FALSE)");
    model._set("A5", "=XOR(FALSE, FALSE, FALSE, FALSE, FALSE)");
    model._set("A6", "=XOR(TRUE, TRUE)");
    model._set("A7", "=XOR(0,0,0)");
    model._set("A8", "=XOR(0,0,1)");
    model._set("A9", "=XOR(0,1,0)");
    model._set("A10", "=XOR(0,1,1)");
    model._set("A11", "=XOR(1,0,0)");
    model._set("A12", "=XOR(1,0,1)");
    model._set("A13", "=XOR(1,1,0)");
    model._set("A14", "=XOR(1,1,1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"TRUE");
    assert_eq!(model._get_text("A2"), *"FALSE");
    assert_eq!(model._get_text("A3"), *"TRUE");
    assert_eq!(model._get_text("A4"), *"FALSE");
    assert_eq!(model._get_text("A5"), *"FALSE");
    assert_eq!(model._get_text("A6"), *"FALSE");
    assert_eq!(model._get_text("A7"), *"FALSE");
    assert_eq!(model._get_text("A8"), *"TRUE");
    assert_eq!(model._get_text("A9"), *"TRUE");
    assert_eq!(model._get_text("A10"), *"FALSE");
    assert_eq!(model._get_text("A11"), *"TRUE");
    assert_eq!(model._get_text("A12"), *"FALSE");
    assert_eq!(model._get_text("A13"), *"FALSE");
    assert_eq!(model._get_text("A14"), *"TRUE");
}

#[test]
fn fn_or() {
    let mut model = new_empty_model();

    model._set("A1", "=OR(1, 1, 1, 0, 0)");
    model._set("A2", "=OR(1, 1, 0, 0, 0)");
    model._set("A3", "=OR(TRUE, TRUE, TRUE, FALSE, FALSE)");
    model._set("A4", "=OR(TRUE, TRUE, FALSE, FALSE, FALSE)");
    model._set("A5", "=OR(FALSE, FALSE, FALSE, FALSE, FALSE)");
    model._set("A6", "=OR(TRUE, TRUE)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"TRUE");
    assert_eq!(model._get_text("A2"), *"TRUE");
    assert_eq!(model._get_text("A3"), *"TRUE");
    assert_eq!(model._get_text("A4"), *"TRUE");
    assert_eq!(model._get_text("A5"), *"FALSE");
    assert_eq!(model._get_text("A6"), *"TRUE");
}

#[test]
fn fn_or_xor() {
    inner("or");
    inner("xor");

    fn inner(func: &str) {
        println!("Testing function: {func}");

        let mut model = new_empty_model();

        // Text args
        model._set("A1", &format!(r#"={func}("")"#));
        model._set("A2", &format!(r#"={func}("", "")"#));
        model._set("A3", &format!(r#"={func}("", TRUE)"#));
        model._set("A4", &format!(r#"={func}("", FALSE)"#));

        model._set("A5", &format!("={func}(FALSE, TRUE)"));
        model._set("A6", &format!("={func}(FALSE, FALSE)"));
        model._set("A7", &format!("={func}(TRUE, FALSE)"));

        // Reference to empty cell, plus true argument
        model._set("A8", &format!("={func}(Z99, 1)"));

        // Reference to empty cell/range
        model._set("A9", &format!("={func}(Z99)"));
        model._set("A10", &format!("={func}(X99:Z99"));

        // Reference to text cell
        model._set("B13", "some_text");
        model._set("A13", &format!("={func}(B13)"));
        model._set("A14", &format!("={func}(B13, 0)"));
        model._set("A15", &format!("={func}(B13, 1)"));

        // Reference to Implicit intersection
        model._set("X16", "1");
        model._set("B16", "=@X15:X16");
        model._set("A16", &format!("={func}(B16)"));

        // Non-empty range
        model._set("B17", "1");
        model._set("A17", &format!("={func}(B17:C17)"));

        // Non-empty range with text
        model._set("B18", "text");
        model._set("A18", &format!("={func}(B18:C18)"));

        // Non-empty range with text and number
        model._set("B19", "text");
        model._set("C19", "1");
        model._set("A19", &format!("={func}(B19:C19)"));

        // range with error
        model._set("B20", "=1/0");
        model._set("A20", &format!("={func}(B20:C20)"));

        model.evaluate();

        assert_eq!(model._get_text("A1"), *"#VALUE!");
        assert_eq!(model._get_text("A2"), *"#VALUE!");
        assert_eq!(model._get_text("A3"), *"TRUE");
        assert_eq!(model._get_text("A4"), *"FALSE");

        assert_eq!(model._get_text("A5"), *"TRUE");
        assert_eq!(model._get_text("A6"), *"FALSE");
        assert_eq!(model._get_text("A7"), *"TRUE");

        assert_eq!(model._get_text("A8"), *"TRUE");

        assert_eq!(model._get_text("A9"), *"#VALUE!");
        assert_eq!(model._get_text("A10"), *"#VALUE!");

        assert_eq!(model._get_text("A13"), *"#VALUE!");
        assert_eq!(model._get_text("A14"), *"FALSE");
        assert_eq!(model._get_text("A15"), *"TRUE");

        assert_eq!(model._get_text("A17"), *"TRUE");

        assert_eq!(model._get_text("A18"), *"#VALUE!");

        assert_eq!(model._get_text("A19"), *"TRUE");

        assert_eq!(model._get_text("A20"), *"#DIV/0!");
    }
}

#[test]
fn fn_or_xor_arrays() {
    inner("or");
    inner("xor");

    fn inner(func: &str) {
        println!("Testing function: {func}");

        let mut model = new_empty_model();

        // Boolean array literals
        model._set("A1", &format!("={func}({{TRUE, FALSE, FALSE}})"));
        model._set("A2", &format!("={func}({{FALSE, FALSE, FALSE}})"));

        // Number array literals (0 is FALSE, anything else TRUE)
        model._set("A3", &format!("={func}({{0, 0, 1}})"));
        model._set("A4", &format!("={func}({{0, 0, 0}})"));

        // Strings in arrays are ignored
        model._set("A5", &format!(r#"={func}({{"text", TRUE}})"#));
        model._set("A6", &format!(r#"={func}({{"text", FALSE}})"#));

        // Two-dimensional array combined with a scalar argument
        model._set("A7", &format!("={func}({{FALSE; FALSE}}, TRUE)"));

        // Errors inside an array are propagated
        model._set("A8", &format!(r#"={func}({{#DIV/0!, TRUE}})"#));

        model.evaluate();

        assert_eq!(model._get_text("A1"), *"TRUE");
        assert_eq!(model._get_text("A2"), *"FALSE");
        assert_eq!(model._get_text("A3"), *"TRUE");
        assert_eq!(model._get_text("A4"), *"FALSE");
        assert_eq!(model._get_text("A5"), *"TRUE");
        assert_eq!(model._get_text("A6"), *"FALSE");
        assert_eq!(model._get_text("A7"), *"TRUE");
        assert_eq!(model._get_text("A8"), *"#DIV/0!");
    }
}

#[test]
fn fn_and_arrays() {
    let mut model = new_empty_model();

    model._set("A1", "=AND({TRUE, TRUE, TRUE})");
    model._set("A2", "=AND({TRUE, FALSE, TRUE})");
    model._set("A3", "=AND({1, 2, 3})");
    model._set("A4", "=AND({1, 0, 3})");
    // Strings ignored
    model._set("A5", r#"=AND({"text", TRUE})"#);
    // Error propagated
    model._set("A6", "=AND({TRUE, #N/A})");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"TRUE");
    assert_eq!(model._get_text("A2"), *"FALSE");
    assert_eq!(model._get_text("A3"), *"TRUE");
    assert_eq!(model._get_text("A4"), *"FALSE");
    assert_eq!(model._get_text("A5"), *"TRUE");
    assert_eq!(model._get_text("A6"), *"#N/A");
}

#[test]
#[ignore = "not yet implemented"]
fn spill_behaviour() {
    let mut model = new_empty_model();

    // Reference to cell with reference to empty range
    model._set("B11", "=X99:Z99");
    model._set("A11", "=OR(B11)");

    // Reference to cell with non-empty range
    model._set("X12", "1");
    model._set("B12", "=X12:Z12");
    model._set("A12", "=OR(B12)");

    model.evaluate();

    assert_eq!(model._get_text("A11"), *"FALSE");

    assert_eq!(model._get_text("A12"), *"TRUE");
}

#[test]
fn fn_or_xor_no_arguments() {
    inner("or");
    inner("xor");

    fn inner(func: &str) {
        println!("Testing function: {func}");

        let mut model = new_empty_model();
        model._set("A1", &format!("={func}()"));
        model.evaluate();
        assert_eq!(model._get_text("A1"), *"#ERROR!");
    }
}

#[test]
fn fn_or_xor_missing_arguments() {
    inner("or");
    inner("xor");

    fn inner(func: &str) {
        println!("Testing function: {func}");

        let mut model = new_empty_model();
        model._set("A1", &format!("={func}(,)"));
        model._set("A2", &format!("={func}(,1)"));
        model._set("A3", &format!("={func}(1,)"));
        model._set("A4", &format!("={func}(,B1)"));
        model._set("A5", &format!("={func}(,B1:B4)"));
        model.evaluate();
        assert_eq!(model._get_text("A1"), *"FALSE");
        assert_eq!(model._get_text("A2"), *"TRUE");
        assert_eq!(model._get_text("A3"), *"TRUE");
        assert_eq!(model._get_text("A4"), *"FALSE");
        assert_eq!(model._get_text("A5"), *"FALSE");
    }
}
