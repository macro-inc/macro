use super::*;
use crate::pdf::Name;

fn operators(ops: &[Op]) -> Vec<String> {
    ops.iter()
        .map(|op| String::from_utf8_lossy(&op.operator).into_owned())
        .collect()
}

fn ints(v: &[i64]) -> Vec<Object> {
    v.iter().map(|&i| Object::Int(i)).collect()
}

#[test]
fn operators_and_operands() {
    let ops = parse(
        b"q 1 0 0 1 10.5 -20 cm\n/F1 12 Tf (Hi) Tj [(A) -120 (B)] TJ 0 0 1 rg T* (x) ' 1 2 (y) \" Q",
    );
    assert_eq!(
        operators(&ops),
        ["q", "cm", "Tf", "Tj", "TJ", "rg", "T*", "'", "\"", "Q"]
    );
    assert!(ops[0].operands.is_empty());
    assert_eq!(ops[1].operands.len(), 6);
    assert_eq!((ops[1].num(4), ops[1].num(5)), (10.5, -20.0));
    assert_eq!(ops[2].operands, [Object::name("F1"), Object::Int(12)]);
    assert_eq!(ops[3].operands, [Object::String(b"Hi".to_vec())]);
    assert_eq!(
        ops[4].operands,
        [Object::Array(vec![
            Object::String(b"A".to_vec()),
            Object::Int(-120),
            Object::String(b"B".to_vec()),
        ])]
    );
    assert!(ops[1].is("cm") && !ops[1].is("c"));
    assert_eq!(ops[1].num(99), 0.0);
}

#[test]
fn spans_cover_operands_and_operator() {
    let src = b"  1 2 m\n3 4 l h % comment\nBT";
    let ops = parse(src);
    let spans: Vec<&[u8]> = ops.iter().map(|op| &src[op.span.clone()]).collect();
    assert_eq!(spans, [&b"1 2 m"[..], b"3 4 l", b"h", b"BT"]);
}

#[test]
fn marked_content_and_property_lists() {
    let ops = parse(b"/OC /MC0 BDC /Span <</ActualText (fi) /MCID 3>> BDC EMC EMC /P BMC");
    assert_eq!(operators(&ops), ["BDC", "BDC", "EMC", "EMC", "BMC"]);
    assert_eq!(ops[0].operands, [Object::name("OC"), Object::name("MC0")]);
    let props = ops[1].operands[1].as_dict().unwrap();
    assert_eq!(
        props.get("ActualText").and_then(Object::as_bytes),
        Some(&b"fi"[..])
    );
    assert_eq!(props.i64("MCID"), Some(3));
}

#[test]
fn damage_is_skipped() {
    // Stray closers and braces, an unclosed array, a reference that is not
    // one here, and operands with no operator at the end.
    let ops = parse(b"1 2 ] m 3 4 l } ) > 5 6 l [1 2 TJ 1 0 R 7 8");
    assert_eq!(operators(&ops), ["m", "l", "l", "TJ", "R"]);
    assert_eq!(ops[0].operands, ints(&[1, 2]));
    assert_eq!(ops[2].operands, ints(&[5, 6]));
    assert_eq!(ops[3].operands, [Object::Array(ints(&[1, 2]))]);
    assert_eq!(ops[4].operands, ints(&[1, 0]));
    assert!(parse(b"").is_empty());
    assert!(parse(b"(unterminated Tj").is_empty());
    assert!(parse(b"<< /A [ << /B").is_empty());
    // Binary junk does not stop what follows.
    let ops = parse(b"\x80\x81 1 2 m 3 4 l");
    assert_eq!(operators(&ops).last().map(String::as_str), Some("l"));
}

#[test]
fn inline_image_with_known_length() {
    // Unfiltered: 2×2 gray at 8 bits is 4 bytes, and the data itself
    // holds `EI` between whitespace.
    let src = b"q BI /W 2 /H 2 /BPC 8 /CS /G ID \nEI EI Q";
    let ops = parse(src);
    assert_eq!(operators(&ops), ["q", "BI", "Q"]);
    let image = ops[1].inline_image.as_ref().unwrap();
    assert_eq!(image.data, b"\nEI ");
    assert_eq!(image.dict.i64("W"), Some(2));
    assert!(image.dict.is("CS", "G"));
    assert_eq!(
        &src[ops[1].span.clone()],
        b"BI /W 2 /H 2 /BPC 8 /CS /G ID \nEI EI"
    );
    // An image mask: 1 bit per pixel, rows padded to whole bytes; the data
    // starts with an `EI` that content would follow.
    let src = b"BI /W 9 /H 2 /IM true ID EI\x00\x00 EI\nQ";
    let ops = parse(src);
    assert_eq!(operators(&ops), ["BI", "Q"]);
    assert_eq!(ops[0].inline_image.as_ref().unwrap().data, b"EI\x00\x00");
}

#[test]
fn inline_image_ended_by_the_ei_that_content_follows() {
    // Filtered: the first `EI` between whitespace is followed by binary,
    // not content; the second by operators.
    let src = b"BI /W 4 /H 4 /BPC 8 /CS /RGB /F /Fl ID x\x9c EI \x80\xfe\x07 more\nEI\n0 0 m Q";
    let ops = parse(src);
    assert_eq!(operators(&ops), ["BI", "m", "Q"]);
    let image = ops[0].inline_image.as_ref().unwrap();
    assert_eq!(image.data, b"x\x9c EI \x80\xfe\x07 more");
    assert!(image.dict.is("F", "Fl"));
    // ASCII data, CRLF after ID, and the stream ending right after `EI`.
    let ops = parse(b"BI /W 1 /H 1 /CS /RGB /BPC 8 /F /AHx ID\r\n00FF00>\r\nEI");
    assert_eq!(ops[0].inline_image.as_ref().unwrap().data, b"00FF00>");
    assert_eq!(ops.len(), 1);
    // A color space by resource name: the length is unknown, so the end is
    // searched for.
    let ops = parse(b"BI /W 1 /H 1 /CS /CS0 /BPC 8 ID \x05 EI Q");
    assert_eq!(ops[0].inline_image.as_ref().unwrap().data, b"\x05");
}

#[test]
fn inline_image_damage() {
    // No `EI`: the data runs to the end.
    let ops = parse(b"BI /W 1 /H 1 /F /AHx ID 0a0b");
    assert_eq!(ops[0].inline_image.as_ref().unwrap().data, b"0a0b");
    // No `ID`.
    let ops = parse(b"BI /W 1 /H 1");
    assert_eq!(ops[0].inline_image.as_ref().unwrap().data, b"");
    let ops = parse(b"BI /W 1 EI Q");
    assert_eq!(operators(&ops), ["BI", "Q"]);
    // A length past the end falls back to searching.
    let ops = parse(b"BI /W 100 /H 100 /BPC 8 /CS /G ID ab EI Q");
    assert_eq!(ops[0].inline_image.as_ref().unwrap().data, b"ab");
    assert_eq!(operators(&ops), ["BI", "Q"]);
}

#[test]
fn write_is_compact() {
    let ops = vec![
        Op::new(
            "cm",
            vec![
                Object::from(1.0),
                Object::Int(0),
                Object::Real(0.5),
                Object::Real(-0.333_333_333),
                Object::Real(100.0),
                Object::Real(1e-7),
            ],
        ),
        Op::new("Tj", vec![Object::String(b"a(b)\\c\n".to_vec())]),
        Op::new("Tj", vec![Object::String(vec![0, 1, 0x41, 0xff])]),
        Op::new(
            "Tf",
            vec![Object::Name(Name(b"F 1".to_vec())), Object::Real(-0.0)],
        ),
        Op::new(
            "TJ",
            vec![Object::Array(vec![
                Object::String(b"A".to_vec()),
                Object::Real(-120.25),
            ])],
        ),
        Op::new(
            "BDC",
            vec![Object::name("Span"), {
                let mut d = Dict::new();
                d.set("MCID", 0);
                d.set("On", true);
                Object::Dict(d)
            }],
        ),
        Op::new("Q", vec![]),
    ];
    let out = String::from_utf8(write(&ops)).unwrap();
    assert_eq!(
        out,
        "1 0 0.5 -0.33333 100 0.0000001 cm\n(a\\(b\\)\\\\c\\n) Tj\n<000141FF> Tj\n/F#201 0 Tf\n\
         [(A) -120.25] TJ\n/Span <</MCID 0 /On true>> BDC\nQ\n"
    );
}

#[test]
fn write_numbers() {
    let fmt = |v: f64| {
        let mut out = Vec::new();
        crate::pdf::write::number(v, &mut out);
        String::from_utf8(out).unwrap()
    };
    assert_eq!(fmt(12.0), "12");
    assert_eq!(fmt(-3.5), "-3.5");
    assert_eq!(fmt(0.123_456_789), "0.12346");
    assert_eq!(fmt(99.999_999_9), "100");
    assert_eq!(fmt(2.5e-5), "0.000025");
    assert_eq!(fmt(0.001_234_567), "0.001235");
    assert_eq!(fmt(-1e-12), "0");
    assert_eq!(fmt(1e20), "100000000000000000000");
    assert_eq!(fmt(f64::NAN), "0");
    assert_eq!(fmt(f64::INFINITY), "0");
}

#[test]
fn write_then_parse_round_trips() {
    let src: &[u8] = b"q 0.24 0 0 -0.24 12.5 700 cm /GS0 gs 0.5 0.2 0.1 0.05 k\n\
        BT /F1 1 Tf 12 0 0 12 72 720 Tm [(Hello) -250 (World)] TJ ET\n\
        /Layer /MC0 BDC 10 10 m 20 20 l 30 10 40 0 50 10 c h f* EMC\n\
        BI /W 4 /H 1 /BPC 8 /CS /RGB ID \x01EI\x02 \x03\x04EI\x05\x06\x07 EI\n\
        [3 1] 0 d /Im0 Do Q";
    let ops = parse(src);
    assert_eq!(operators(&ops).len(), 20);
    let again = parse(&write(&ops));
    assert_eq!(operators(&again), operators(&ops));
    for (a, b) in ops.iter().zip(&again) {
        assert_eq!(
            a.operands,
            b.operands,
            "{}",
            String::from_utf8_lossy(&a.operator)
        );
        assert_eq!(a.inline_image, b.inline_image);
    }
    let image = ops.iter().find_map(|op| op.inline_image.as_ref()).unwrap();
    assert_eq!(image.data, b"\x01EI\x02 \x03\x04EI\x05\x06\x07");
}
