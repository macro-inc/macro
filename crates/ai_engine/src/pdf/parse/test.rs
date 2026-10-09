use super::*;

fn obj(s: &[u8]) -> Option<Object> {
    Parser::new(s, 0, Mode::Object).object(0)
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
fn simple_objects() {
    assert_eq!(obj(b"true"), Some(Object::Bool(true)));
    assert_eq!(obj(b"false"), Some(Object::Bool(false)));
    assert_eq!(obj(b"null"), Some(Object::Null));
    assert_eq!(obj(b"-12"), Some(Object::Int(-12)));
    assert_eq!(obj(b"1.5"), Some(Object::Real(1.5)));
    assert_eq!(obj(b"(s)"), Some(Object::String(b"s".to_vec())));
    assert_eq!(obj(b"/N"), Some(Object::name("N")));
    assert_eq!(obj(b"12 0 R"), Some(Object::Ref(ObjRef::new(12, 0))));
    assert_eq!(obj(b""), None);
    assert_eq!(obj(b")"), None);
}

#[test]
fn arrays_and_references() {
    assert_eq!(
        obj(b"[549 2.75 false (Ralph) /SomeName 1 0 R 2 1 3 0 R [] [[1]]]"),
        Some(Object::Array(vec![
            Object::Int(549),
            Object::Real(2.75),
            Object::Bool(false),
            Object::String(b"Ralph".to_vec()),
            Object::name("SomeName"),
            Object::Ref(ObjRef::new(1, 0)),
            Object::Int(2),
            Object::Int(1),
            Object::Ref(ObjRef::new(3, 0)),
            Object::Array(Vec::new()),
            Object::Array(vec![Object::Array(vec![Object::Int(1)])]),
        ]))
    );
    // Not references: a negative number, a generation past 65535, no `R`.
    assert_eq!(
        obj(b"[-1 0 R 1 70000 R 4 5]"),
        Some(Object::Array(vec![
            Object::Int(-1),
            Object::Int(0),
            Object::Int(1),
            Object::Int(70000),
            Object::Int(4),
            Object::Int(5),
        ]))
    );
}

#[test]
fn dictionaries() {
    let d = obj(
        b"<</Type /Example /Subtype /DictionaryExample /Version 0.01 /IntegerItem 12 \
        /StringItem (a string) /Subdictionary << /Item1 0.4 /Item2 true /LastItem (not!) \
        /VeryLastItem (OK) >> /Ref 7 0 R>>",
    )
    .unwrap();
    let d = d.as_dict().unwrap();
    assert_eq!(d.len(), 7);
    assert!(d.is("Type", "Example"));
    assert_eq!(d.f64("Version"), Some(0.01));
    assert_eq!(d.get("Ref"), Some(&Object::Ref(ObjRef::new(7, 0))));
    let sub = d.get("Subdictionary").unwrap().as_dict().unwrap();
    assert_eq!(sub.get("Item2"), Some(&Object::Bool(true)));
    assert_eq!(
        sub.get("VeryLastItem").and_then(Object::as_bytes),
        Some(&b"OK"[..])
    );
    assert_eq!(obj(b"<<>>"), Some(Object::Dict(Dict::new())));
    // Names next to each other, no whitespace.
    assert_eq!(
        obj(b"<</Type/Page/Count 3>>"),
        Some(Object::Dict(dict(&[
            ("Type", Object::name("Page")),
            ("Count", Object::Int(3))
        ])))
    );
}

#[test]
fn duplicate_keys_keep_the_last_value() {
    assert_eq!(
        obj(b"<</A 1 /B 2 /A 3>>"),
        Some(Object::Dict(dict(&[
            ("A", Object::Int(3)),
            ("B", Object::Int(2))
        ])))
    );
}

#[test]
fn damage_is_tolerated() {
    // Junk tokens are skipped; a key without a value is dropped.
    assert_eq!(
        obj(b"<</A ) /B 2 } /C>>"),
        Some(Object::Dict(dict(&[("B", Object::Int(2))])))
    );
    assert_eq!(
        obj(b"[1 ) 2 >]"),
        Some(Object::Array(vec![Object::Int(1), Object::Int(2)]))
    );
    // Unclosed containers end at the end, or where the object does.
    assert_eq!(
        obj(b"[1 2"),
        Some(Object::Array(vec![Object::Int(1), Object::Int(2)]))
    );
    assert_eq!(
        obj(b"<</A [1 2 >> endobj"),
        Some(Object::Dict(dict(&[(
            "A",
            Object::Array(vec![Object::Int(1), Object::Int(2)])
        )])))
    );
    assert_eq!(
        obj(b"<</A 1 endobj"),
        Some(Object::Dict(dict(&[("A", Object::Int(1))])))
    );
}

#[test]
fn deep_nesting_is_bounded() {
    let deep = [vec![b'['; 100_000], vec![b']'; 100_000]].concat();
    assert!(matches!(obj(&deep), Some(Object::Array(_))));
    let deep = b"<</A ".repeat(50_000);
    assert!(matches!(obj(&deep), Some(Object::Dict(_))));
}

#[test]
fn content_mode_has_no_references_and_stops_at_operators() {
    assert_eq!(
        Parser::new(b"1 0 R", 0, Mode::Content).object(0),
        Some(Object::Int(1))
    );
    // `R` is an operator here, so it ends the array.
    let mut p = Parser::new(b"[1 0 R]", 0, Mode::Content);
    assert_eq!(
        p.object(0),
        Some(Object::Array(vec![Object::Int(1), Object::Int(0)]))
    );
    assert_eq!(p.next().map(|t| t.token), Some(Token::Keyword(b"R")));
    let mut p = Parser::new(b"[1 0] <</A 1 BT", 0, Mode::Content);
    assert_eq!(
        p.object(0),
        Some(Object::Array(vec![Object::Int(1), Object::Int(0)]))
    );
    assert_eq!(
        p.object(0),
        Some(Object::Dict(dict(&[("A", Object::Int(1))])))
    );
    assert_eq!(p.object(0), None);
    assert_eq!(p.next().map(|t| t.token), Some(Token::Keyword(b"BT")));
}

fn no_length(_: ObjRef) -> Option<i64> {
    None
}

#[test]
fn indirect_objects() {
    let data = b"  12 0 obj\n<</A 1>>\nendobj\n13 0 obj 5 endobj";
    let ind = indirect(data, 0, &no_length).unwrap();
    assert_eq!((ind.num, ind.generation), (12, 0));
    assert_eq!(ind.object, Object::Dict(dict(&[("A", Object::Int(1))])));
    assert_eq!(ind.stream, None);
    assert_eq!(&data[..ind.end], b"  12 0 obj\n<</A 1>>\nendobj");
    let ind = indirect(data, ind.end, &no_length).unwrap();
    assert_eq!((ind.num, ind.object), (13, Object::Int(5)));
    // Missing `endobj`, an empty object, and something that is not one.
    let ind = indirect(b"1 0 obj (x) 2 0 obj", 0, &no_length).unwrap();
    assert_eq!(ind.object, Object::String(b"x".to_vec()));
    assert_eq!(
        indirect(b"1 0 obj endobj", 0, &no_length).unwrap().object,
        Object::Null
    );
    assert!(indirect(b"1 0 R", 0, &no_length).is_none());
    assert!(indirect(b"<<>>", 0, &no_length).is_none());
}

fn stream_data(data: &[u8], length: &dyn Fn(ObjRef) -> Option<i64>) -> (Vec<u8>, bool) {
    let ind = indirect(data, 0, length).unwrap();
    let range = ind.stream.expect("a stream");
    (data[range].to_vec(), ind.stream_ended)
}

#[test]
fn streams() {
    // Length direct, data ending in an end-of-line that is part of it.
    let s = b"1 0 obj <</Length 6>> stream\r\nab\ncd\n\nendstream endobj";
    assert_eq!(stream_data(s, &no_length), (b"ab\ncd\n".to_vec(), true));
    // Length indirect.
    let s = b"1 0 obj <</Length 9 0 R>> stream\nabc\nendstream\nendobj";
    let length = |r: ObjRef| (r.num == 9).then_some(3);
    assert_eq!(stream_data(s, &length), (b"abc".to_vec(), true));
    // Length wrong or missing: the data runs to `endstream`, less its EOL.
    for s in [
        &b"1 0 obj <</Length 99>> stream\nabc\r\nendstream endobj"[..],
        b"1 0 obj <</Length 1>> stream\nabc\nendstream endobj",
        b"1 0 obj <<>> stream\nabc\rendstream endobj",
        b"1 0 obj <</Length -4>> stream\r\nabcendstream endobj",
        b"1 0 obj <</Length 9 0 R>> stream\nabc\nendstream endobj",
    ] {
        assert_eq!(stream_data(s, &no_length), (b"abc".to_vec(), true));
    }
    // No `endstream`: up to `endobj`, or the end.
    assert_eq!(
        stream_data(b"1 0 obj <<>> stream\nabc\nendobj", &no_length),
        (b"abc".to_vec(), false)
    );
    assert_eq!(
        stream_data(b"1 0 obj <<>> stream\nabc", &no_length),
        (b"abc".to_vec(), false)
    );
    // `stream` followed by a lone CR, or spaces and then LF.
    assert_eq!(
        stream_data(b"1 0 obj <</Length 2>> stream\rab endstream", &no_length).0,
        b"ab"
    );
    assert_eq!(
        stream_data(b"1 0 obj <</Length 2>> stream  \nab endstream", &no_length).0,
        b"ab"
    );
    // After the stream, parsing resumes past `endobj`.
    let s = b"1 0 obj <</Length 3>> stream\nabc\nendstream\nendobj\n2 0 obj";
    let ind = indirect(s, 0, &no_length).unwrap();
    assert_eq!(&s[ind.end..], b"\n2 0 obj");
}

#[test]
fn object_stream_index() {
    let data = b"10 0 11 4 12 9 (aa) [1] <<>>";
    let d = dict(&[("N", Object::Int(3)), ("First", Object::Int(15))]);
    assert_eq!(objstm_index(&d, data), [(10, 15), (11, 19), (12, 24)]);
    // `N` larger than the pairs before `First`, and offsets past the end.
    let d = dict(&[("N", Object::Int(9)), ("First", Object::Int(15))]);
    assert_eq!(objstm_index(&d, data).len(), 3);
    let d = dict(&[("N", Object::Int(1)), ("First", Object::Int(4))]);
    assert_eq!(objstm_index(&d, b"1 99"), []);
    assert_eq!(objstm_index(&Dict::new(), data), []);
}
