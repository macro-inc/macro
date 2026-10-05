use crate::test::util::new_empty_model;

#[test]
fn fn_bin2dec() {
    let mut model = new_empty_model();
    model._set("A1", "=BIN2DEC(1100100)");
    model._set("A2", "=BIN2DEC(1111111111)");

    model._set("B1", "=BIN2DEC()");
    model._set("B2", "=BIN2DEC(1,2)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "100");
    assert_eq!(model._get_text("A2"), "-1");
    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_bin2hex() {
    let mut model = new_empty_model();
    model._set("A1", "=BIN2HEX(11111011, 4)");
    model._set("A2", "=BIN2HEX(1110)");
    model._set("A3", "=BIN2HEX(1111111111)");
    model._set("A4", "=BIN2HEX(1100011011)");

    model._set("B1", "=BIN2HEX()");
    model._set("B2", "=BIN2HEX(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "00FB");
    assert_eq!(model._get_text("A2"), "E");
    assert_eq!(model._get_text("A3"), "FFFFFFFFFF");
    assert_eq!(model._get_text("A4"), "FFFFFFFF1B");
    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_bin2oct() {
    let mut model = new_empty_model();
    model._set("A1", "=BIN2OCT(11111011, 4)");
    model._set("A2", "=BIN2OCT(1110)");
    model._set("A3", "=BIN2OCT(1111111111)");
    model._set("A4", "=BIN2OCT(1100011011)");

    model._set("B1", "=BIN2OCT()");
    model._set("B2", "=BIN2OCT(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "0373");
    assert_eq!(model._get_text("A2"), "16");
    assert_eq!(model._get_text("A3"), "7777777777");
    assert_eq!(model._get_text("A4"), "7777777433");
    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_dec2bin() {
    let mut model = new_empty_model();
    model._set("A1", "=DEC2BIN(9, 4)");
    model._set("A2", "=DEC2BIN(-100)");
    model._set("A3", "=DEC2BIN(-1)");
    model._set("A4", "=DEC2BIN(0, 3)");

    model._set("B1", "=DEC2BIN()");
    model._set("B2", "=DEC2BIN(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "1001");
    assert_eq!(model._get_text("A2"), "1110011100");
    assert_eq!(model._get_text("A3"), "1111111111");
    assert_eq!(model._get_text("A4"), "000");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_dec2hex() {
    let mut model = new_empty_model();
    model._set("A1", "=DEC2HEX(100, 4)");
    model._set("A2", "=DEC2HEX(-54)");
    model._set("A3", "=DEC2HEX(28)");
    model._set("A4", "=DEC2HEX(64, 1)");

    model._set("B1", "=DEC2HEX()");
    model._set("B2", "=DEC2HEX(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "0064");
    assert_eq!(model._get_text("A2"), "FFFFFFFFCA");
    assert_eq!(model._get_text("A3"), "1C");
    assert_eq!(model._get_text("A4"), "#NUM!");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_dec2oct() {
    let mut model = new_empty_model();
    model._set("A1", "=DEC2OCT(58, 3)");
    model._set("A2", "=DEC2OCT(-100)");

    model._set("B1", "=DEC2OCT()");
    model._set("B2", "=DEC2OCT(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "072");
    assert_eq!(model._get_text("A2"), "7777777634");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_hex2bin() {
    let mut model = new_empty_model();
    model._set("A1", r#"=HEX2BIN("F", 8)"#);
    model._set("A2", r#"=HEX2BIN("B7")"#);
    model._set("A3", r#"=HEX2BIN("FFFFFFFFFF")"#);

    model._set("B1", "=HEX2BIN()");
    model._set("B2", "=HEX2BIN(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "00001111");
    assert_eq!(model._get_text("A2"), "10110111");
    assert_eq!(model._get_text("A3"), "1111111111");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_hex2dec() {
    let mut model = new_empty_model();
    model._set("A1", r#"=HEX2DEC("A5")"#);
    model._set("A2", r#"=HEX2DEC("FFFFFFFF5B")"#);
    model._set("A3", r#"=HEX2DEC("3DA408B9")"#);
    model._set("A4", r#"=HEX2DEC("FE")"#);

    model._set("B1", "=HEX2DEC()");
    model._set("B2", "=HEX2DEC(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "165");
    assert_eq!(model._get_text("A2"), "-165");
    assert_eq!(model._get_text("A3"), "1034160313");
    assert_eq!(model._get_text("A4"), "254");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_hex2oct() {
    let mut model = new_empty_model();
    model._set("A1", r#"=HEX2OCT("F", 3)"#);
    model._set("A2", r#"=HEX2OCT("3B4E")"#);
    model._set("A3", r#"=HEX2OCT("FFFFFFFF00")"#);

    model._set("B1", "=HEX2OCT()");
    model._set("B2", "=HEX2OCT(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "017");
    assert_eq!(model._get_text("A2"), "35516");
    assert_eq!(model._get_text("A3"), "7777777400");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_oct2bin() {
    let mut model = new_empty_model();
    model._set("A1", r#"=OCT2BIN(3, 3)"#);
    model._set("A2", r#"=OCT2BIN(7777777000)"#);

    // bounds
    model._set("G1", r#"=OCT2BIN(777)"#);
    model._set("G2", r#"=OCT2BIN(778)"#);

    model._set("B1", "=OCT2BIN()");
    model._set("B2", "=OCT2BIN(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "011");
    assert_eq!(model._get_text("A2"), "1000000000");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");

    assert_eq!(model._get_text("G1"), "111111111");
    assert_eq!(model._get_text("G2"), "#NUM!");
}

#[test]
fn fn_oct2dec() {
    let mut model = new_empty_model();
    model._set("A1", r#"=OCT2DEC(54)"#);
    model._set("A2", r#"=OCT2DEC(7777777533)"#);

    model._set("B1", "=OCT2DEC()");
    model._set("B2", "=OCT2DEC(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "44");
    assert_eq!(model._get_text("A2"), "-165");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_oct2hex() {
    let mut model = new_empty_model();
    model._set("A1", r#"=OCT2HEX(100, 4)"#);
    model._set("A2", r#"=OCT2HEX(7777777533)"#);

    model._set("B1", "=OCT2HEX()");
    model._set("B2", "=OCT2HEX(1,2,3)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), "0040");
    assert_eq!(model._get_text("A2"), "FFFFFFFF5B");

    assert_eq!(model._get_text("B1"), *"#ERROR!");
    assert_eq!(model._get_text("B2"), *"#ERROR!");
}

#[test]
fn fn_bin2hex_misc() {
    let mut model = new_empty_model();
    model._set("A1", "=BIN2HEX(1100011011, -2)");
    model._set("A2", "=BIN2HEX(1100011011, 11)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#NUM!");
    assert_eq!(model._get_text("A2"), *"#NUM!");
}

#[test]
fn fn_bin2oct_misc() {
    let mut model = new_empty_model();
    model._set("A1", "=BIN2OCT(1100011011, -2)");
    model._set("A2", "=BIN2OCT(1100011011, 11)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"#NUM!");
    assert_eq!(model._get_text("A2"), *"#NUM!");
}

#[test]
fn fn_dec2oct_misc() {
    let mut model = new_empty_model();
    model._set("A1", "=DEC2OCT(-1213, 1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"7777775503");
}

#[test]
fn fn_dec2bin_misc() {
    let mut model = new_empty_model();
    model._set("A1", "=DEC2BIN(-511, 4)");
    model._set("A2", "=DEC2BIN(TRUE, -1)");
    model._set("A3", "=DEC2OCT(TRUE, -1)");
    model._set("A4", "=DEC2HEX(TRUE, -1)");

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"1000000001");
    // Note Excel here return #NUM! instead
    assert_eq!(model._get_text("A2"), *"#VALUE!");
    assert_eq!(model._get_text("A3"), *"#VALUE!");
    assert_eq!(model._get_text("A4"), *"#VALUE!");
}

#[test]
fn fn_hex2whatever_misc() {
    let mut model = new_empty_model();
    model._set("A1", r#"=HEX2BIN(TRUE, 4)"#);
    model._set("A2", r#"=HEX2DEC(TRUE, 4)"#);
    model._set("A3", r#"=HEX2OCT(TRUE, 4)"#);

    model.evaluate();
    // Note Excel here return #VALUE! instead
    assert_eq!(model._get_text("A1"), *"#NUM!");
    assert_eq!(model._get_text("A2"), *"#NUM!");
    assert_eq!(model._get_text("A3"), *"#NUM!");
}

#[test]
fn fn_oct2whatever_misc() {
    let mut model = new_empty_model();
    model._set("A1", r#"=OCT2BIN(TRUE, 4)"#);
    model._set("A2", r#"=OCT2DEC(TRUE, 4)"#);
    model._set("A3", r#"=OCT2HEX(TRUE, 4)"#);

    model.evaluate();
    // Note Excel here return #VALUE! instead
    assert_eq!(model._get_text("A1"), *"#NUM!");
    assert_eq!(model._get_text("A2"), *"#NUM!");
    assert_eq!(model._get_text("A3"), *"#NUM!");
}

#[test]
fn fn_oct2dec_misc() {
    let mut model = new_empty_model();
    model._set("A1", r#"=OCT2DEC(777)"#);
    model._set("A2", r#"=OCT2DEC("777")"#);
    model._set("A3", r#"=OCT2DEC("-1")"#);
    model._set("A4", r#"=OCT2BIN("-1")"#);
    model._set("A5", r#"=OCT2HEX("-1")"#);
    model._set("A6", r#"=OCT2DEC(4000000000)"#);

    model.evaluate();

    assert_eq!(model._get_text("A1"), *"511");
    assert_eq!(model._get_text("A1"), *"511");

    assert_eq!(model._get_text("A3"), *"#NUM!");
    assert_eq!(model._get_text("A4"), *"#NUM!");
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"-536870912");
}
