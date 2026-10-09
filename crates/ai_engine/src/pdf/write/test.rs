use super::*;
use crate::pdf::test::{Builder, objstm, one_page};
use crate::pdf::{Pdf, filter};
use std::sync::Arc;

fn syntax(o: &Object) -> String {
    let mut out = Vec::new();
    object(o, &mut out);
    String::from_utf8_lossy(&out).into_owned()
}

fn dict(pairs: &[(&str, Object)]) -> Dict {
    Dict(
        pairs
            .iter()
            .map(|(k, v)| (Name::new(k), v.clone()))
            .collect(),
    )
}

#[test]
fn object_syntax() {
    assert_eq!(syntax(&Object::Null), "null");
    assert_eq!(syntax(&Object::Bool(true)), "true");
    assert_eq!(syntax(&Object::Int(-42)), "-42");
    assert_eq!(syntax(&Object::Int(i64::MIN)), "-9223372036854775808");
    assert_eq!(syntax(&Object::Real(0.1)), "0.1");
    assert_eq!(syntax(&Object::Real(-2.0)), "-2");
    assert_eq!(syntax(&Object::Real(1.0 / 3.0)), "0.3333333333333333");
    assert_eq!(syntax(&Object::Real(1e-20)), "0");
    assert_eq!(syntax(&Object::Real(f64::NAN)), "0");
    assert_eq!(syntax(&Object::Real(1e21)), "1000000000000000000000");
    assert_eq!(
        syntax(&Object::String(b"a (b) \\".to_vec())),
        "(a \\(b\\) \\\\)"
    );
    assert_eq!(syntax(&Object::String(b"caf\xe9".to_vec())), "(caf\\351)");
    assert_eq!(
        syntax(&Object::String(vec![0xfe, 0xff, 0, 0x41])),
        "<FEFF0041>"
    );
    assert_eq!(syntax(&Object::String(Vec::new())), "()");
    assert_eq!(syntax(&Object::name("Type")), "/Type");
    assert_eq!(
        syntax(&Object::Name(Name(b"A B#(c)/\xff".to_vec()))),
        "/A#20B#23#28c#29#2F#FF"
    );
    assert_eq!(syntax(&Object::Name(Name(Vec::new()))), "/");
    assert_eq!(syntax(&Object::Ref(ObjRef::new(12, 3))), "12 3 R");
    assert_eq!(
        syntax(&Object::Array(vec![
            Object::Int(1),
            Object::name("N"),
            Object::Array(vec![])
        ])),
        "[1 /N []]"
    );
    assert_eq!(
        syntax(&Object::Dict(dict(&[
            ("Type", Object::name("Page")),
            ("Parent", Object::Ref(ObjRef::new(2, 0))),
            (
                "Box",
                Object::Array(vec![Object::Int(0), Object::Real(0.5)])
            ),
        ]))),
        "<</Type /Page /Parent 2 0 R /Box [0 0.5]>>"
    );
    // A stream's `Length` comes from its data, replacing what it said.
    let stream = Stream::new(
        dict(&[("Length", Object::Ref(ObjRef::new(9, 0)))]),
        b"abc".to_vec(),
    );
    assert_eq!(
        syntax(&Object::Stream(stream)),
        "<</Length 3>>\nstream\nabc\nendstream"
    );
}

#[test]
fn written_objects_read_back() {
    let objects = [
        Object::Real(0.1 + 0.2),
        Object::Real(-123_456.789_012_5),
        Object::String((0..=255).collect()),
        Object::String(b"line\r\nbreaks\tand (parens".to_vec()),
        Object::Name(Name(b"odd name/#()".to_vec())),
        Object::Dict(dict(&[(
            "K",
            Object::Array(vec![Object::Null, Object::Bool(false)]),
        )])),
    ];
    for o in objects {
        let mut out = Vec::new();
        object(&o, &mut out);
        let parsed =
            crate::pdf::parse::Parser::new(&out, 0, crate::pdf::parse::Mode::Object).object(0);
        assert_eq!(parsed, Some(o));
    }
}

/// A document of every kind of object, numbered from 1.
fn document() -> Vec<(ObjRef, Object)> {
    let r = |n| Object::Ref(ObjRef::new(n, 0));
    let content = filter::deflate(b"q 1 0 0 1 50 50 cm 0 0 m 10 10 l S Q");
    vec![
        (
            ObjRef::new(1, 0),
            Object::Dict(dict(&[("Type", Object::name("Catalog")), ("Pages", r(2))])),
        ),
        (
            ObjRef::new(2, 0),
            Object::Dict(dict(&[
                ("Type", Object::name("Pages")),
                ("Kids", Object::Array(vec![r(3)])),
                ("Count", Object::Int(1)),
            ])),
        ),
        (
            ObjRef::new(3, 0),
            Object::Dict(dict(&[
                ("Type", Object::name("Page")),
                ("Parent", r(2)),
                (
                    "MediaBox",
                    Object::Array(vec![
                        0.into(),
                        0.into(),
                        Object::Real(595.276),
                        Object::Real(841.89),
                    ]),
                ),
                ("Contents", r(4)),
            ])),
        ),
        (
            ObjRef::new(4, 0),
            Object::Stream(Stream::new(
                dict(&[
                    ("Filter", Object::name("FlateDecode")),
                    ("Length", Object::Int(3)),
                ]),
                content,
            )),
        ),
        (
            ObjRef::new(5, 0),
            Object::Dict(dict(&[
                ("Title", Object::String(crate::pdf::encode_text("Café ☕"))),
                ("Binary", Object::String(vec![0, 1, 2, 255])),
                ("Odd Name", Object::Name(Name(b"a#b c".to_vec()))),
                ("Real", Object::Real(-0.000_123)),
                (
                    "Nested",
                    Object::Array(vec![Object::Dict(dict(&[("X", Object::Null)]))]),
                ),
            ])),
        ),
        (
            ObjRef::new(7, 2),
            Object::Array(vec![Object::Bool(true), Object::Int(-7)]),
        ),
    ]
}

/// What a stream reads back as: its dictionary gains the data's `Length`.
fn as_written(o: &Object) -> Object {
    match o {
        Object::Stream(s) => {
            let mut s = s.clone();
            s.dict.set("Length", s.data.len() as i64);
            Object::Stream(s)
        }
        o => o.clone(),
    }
}

#[test]
fn files_read_back() {
    let objects = document();
    let trailer = dict(&[
        ("Root", Object::Ref(ObjRef::new(1, 0))),
        ("Info", Object::Ref(ObjRef::new(5, 0))),
        ("Prev", Object::Int(99)),
        ("XRefStm", Object::Int(99)),
    ]);
    let bytes = file("1.6", &objects, &trailer);
    assert!(bytes.starts_with(b"%PDF-1.6\n%\xe2\xe3\xcf\xd3\n"));
    assert!(bytes.ends_with(b"%%EOF\n"));
    let pdf = Pdf::open(Arc::from(bytes.as_slice())).unwrap();
    assert!(!pdf.repaired());
    assert_eq!(pdf.version(), "1.6");
    for (r, o) in &objects {
        assert_eq!(pdf.get(*r).as_ref(), Some(&as_written(o)), "{r:?}");
    }
    assert_eq!(
        pdf.object_refs(),
        [(1, 0), (2, 0), (3, 0), (4, 0), (5, 0), (7, 2)].map(|(n, g)| ObjRef::new(n, g))
    );
    assert_eq!(pdf.trailer().i64("Size"), Some(8));
    assert_eq!(pdf.trailer().get("Prev"), None);
    assert_eq!(pdf.trailer().get("XRefStm"), None);
    assert_eq!(pdf.pages().len(), 1);
    // One subsection with 20-byte entries; object 6 is free, the head
    // (object 0) pointing at it.
    let table = &bytes[crate::pdf::lexer::rfind(&bytes, b"\nxref\n", usize::MAX).unwrap() + 1..];
    assert!(table.starts_with(b"xref\n0 8\n0000000006 65535 f\r\n"));
    let entries = &table[9..9 + 8 * 20];
    assert!(
        entries
            .chunks(20)
            .all(|e| e.ends_with(b"\r\n") && (e[17] == b'n' || e[17] == b'f'))
    );
    assert_eq!(&entries[6 * 20..7 * 20], b"0000000000 00000 f\r\n");
}

#[test]
fn sparse_numbers_use_subsections() {
    let objects = vec![
        (
            ObjRef::new(1, 0),
            Object::Dict(dict(&[
                ("Type", Object::name("Catalog")),
                ("Pages", Object::Ref(ObjRef::new(100_000, 0))),
            ])),
        ),
        (
            ObjRef::new(100_000, 0),
            Object::Dict(dict(&[
                ("Type", Object::name("Pages")),
                ("Kids", Object::Array(vec![])),
            ])),
        ),
        (ObjRef::new(0, 0), Object::Int(0)),
        (
            ObjRef::new(1, 0),
            Object::Dict(dict(&[
                ("Type", Object::name("Catalog")),
                ("Pages", Object::Ref(ObjRef::new(100_000, 0))),
            ])),
        ),
    ];
    let bytes = file(
        "1.4",
        &objects,
        &dict(&[("Root", Object::Ref(ObjRef::new(1, 0)))]),
    );
    assert!(bytes.len() < 1000);
    let pdf = Pdf::open(Arc::from(bytes.as_slice())).unwrap();
    assert!(!pdf.repaired());
    assert_eq!(pdf.trailer().i64("Size"), Some(100_001));
    assert_eq!(pdf.object_refs().len(), 2);
    // The second definition of object 1 is the one written.
    assert_eq!(
        crate::pdf::lexer::find(&bytes, b"1 0 obj", 0),
        crate::pdf::lexer::rfind(&bytes, b"1 0 obj", usize::MAX)
    );
}

#[test]
fn incremental_updates_read_back() {
    let objects = document();
    let trailer = dict(&[("Root", Object::Ref(ObjRef::new(1, 0)))]);
    let original = file("1.4", &objects, &trailer);
    let pdf = Pdf::open(Arc::from(original.as_slice())).unwrap();
    let mut catalog = pdf.catalog().unwrap();
    catalog.set("PageMode", Object::name("UseNone"));
    let added = Object::String(b"new object".to_vec());
    let update = [
        (ObjRef::new(1, 0), Object::Dict(catalog.clone())),
        (ObjRef::new(9, 0), added.clone()),
    ];
    let bytes = incremental(&original, &update, pdf.trailer());
    assert!(bytes.starts_with(&original));
    let tail = &bytes[original.len()..];
    assert!(tail.starts_with(b"1 0 obj\n"));
    assert!(crate::pdf::lexer::find(tail, b"xref\n1 1\n", 0).is_some());
    assert!(crate::pdf::lexer::find(tail, b"9 1\n", 0).is_some());
    let reopened = Pdf::open(Arc::from(bytes.as_slice())).unwrap();
    assert!(!reopened.repaired());
    assert_eq!(reopened.catalog(), Some(catalog));
    assert_eq!(reopened.get(ObjRef::new(9, 0)), Some(added));
    for (r, o) in objects.iter().skip(1) {
        assert_eq!(reopened.get(*r).as_ref(), Some(&as_written(o)));
    }
    assert_eq!(reopened.trailer().i64("Size"), Some(10));
    assert_eq!(reopened.pages().len(), 1);
    // And again, on top of the update.
    let again = incremental(
        &bytes,
        &[(ObjRef::new(9, 0), Object::Int(2))],
        reopened.trailer(),
    );
    let pdf = Pdf::open(Arc::from(again.as_slice())).unwrap();
    assert!(!pdf.repaired());
    assert_eq!(pdf.get(ObjRef::new(9, 0)), Some(Object::Int(2)));
    assert_eq!(
        pdf.catalog().unwrap().name("PageMode"),
        Some(&Name::new("UseNone"))
    );
}

#[test]
fn incremental_updates_over_cross_reference_streams() {
    let mut b = Builder::new("1.5");
    b.obj(1, "<</Type /Catalog /Pages 2 0 R>>");
    let (d, data) = objstm(&[
        (2, "<</Type /Pages /Kids [3 0 R] /Count 1>>"),
        (3, "<</Type /Page /Parent 2 0 R>>"),
    ]);
    b.stream(4, &d, &data);
    let rows = [b.row(1), (2, 4, 0), (2, 4, 1), b.row(4)];
    b.xref_stream(5, &[(1, 4)], &rows, "/Size 6 /Root 1 0 R", true);
    let original = b.out.clone();
    let pdf = b.open();
    let page = Object::Dict(dict(&[
        ("Type", Object::name("Page")),
        ("Parent", Object::Ref(ObjRef::new(2, 0))),
        ("Rotate", Object::Int(90)),
    ]));
    let bytes = incremental(
        &original,
        &[(ObjRef::new(3, 0), page.clone())],
        pdf.trailer(),
    );
    // The section is a cross-reference stream too, numbered after the
    // rest.
    let tail = &bytes[original.len()..];
    assert!(crate::pdf::lexer::find(tail, b"6 0 obj\n<</Size 7 /Root 1 0 R /Prev ", 0).is_some());
    assert!(crate::pdf::lexer::find(tail, b"/Type /XRef", 0).is_some());
    let reopened = Pdf::open(Arc::from(bytes.as_slice())).unwrap();
    assert!(!reopened.repaired());
    assert_eq!(reopened.get(ObjRef::new(3, 0)), Some(page));
    let pages = reopened.pages();
    assert_eq!(pages.len(), 1);
    assert_eq!(pages[0].dict.i64("Rotate"), Some(90));
    assert_eq!(reopened.trailer().i64("Size"), Some(7));
}

#[test]
fn incremental_updates_of_damaged_files_index_the_whole_file() {
    // No cross-reference at all: the update's table lists every object.
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    let original = b.out.clone();
    let trailer = dict(&[("Root", Object::Ref(ObjRef::new(1, 0)))]);
    let bytes = incremental(&original, &[(ObjRef::new(5, 0), Object::Int(5))], &trailer);
    let tail = &bytes[original.len()..];
    assert!(crate::pdf::lexer::find(tail, b"/Prev", 0).is_none());
    assert!(crate::pdf::lexer::find(tail, b"xref\n1 5\n", 0).is_some());
    let pdf = Pdf::open(Arc::from(bytes.as_slice())).unwrap();
    assert!(!pdf.repaired());
    assert_eq!(pdf.get(ObjRef::new(5, 0)), Some(Object::Int(5)));
    assert_eq!(pdf.pages().len(), 1);

    // A cross-reference stream file whose `startxref` is wrong: the update
    // is a cross-reference stream listing the compressed objects too.
    let mut b = Builder::new("1.5");
    b.obj(1, "<</Type /Catalog /Pages 2 0 R>>");
    let (d, data) = objstm(&[
        (2, "<</Type /Pages /Kids [3 0 R] /Count 1>>"),
        (3, "<</Type /Page /Parent 2 0 R>>"),
    ]);
    b.stream(4, &d, &data);
    let rows = [b.row(1), (2, 4, 0), (2, 4, 1), b.row(4)];
    let at = b.xref_stream(5, &[(1, 4)], &rows, "/Size 6 /Root 1 0 R", true);
    let mut original = b.out.clone();
    let tail = format!("startxref\n{at}\n%%EOF\n");
    original.truncate(original.len() - tail.len());
    original.extend_from_slice(b"startxref\n3\n%%EOF\n");
    let bytes = incremental(&original, &[(ObjRef::new(6, 0), Object::Int(6))], &trailer);
    let pdf = Pdf::open(Arc::from(bytes.as_slice())).unwrap();
    assert!(!pdf.repaired());
    assert_eq!(pdf.get(ObjRef::new(6, 0)), Some(Object::Int(6)));
    assert_eq!(pdf.pages().len(), 1);
}
