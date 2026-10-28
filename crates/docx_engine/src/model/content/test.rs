use super::*;

fn bold() -> Attrs {
    Attrs::from_pairs([("r:w:b", "<w:b/>")])
}

#[test]
fn push_merges_equal_spans() {
    let mut c = Content::new();
    c.push("ab", Attrs::empty());
    c.push("cd", Attrs::empty());
    c.push("ef", bold());
    assert_eq!(c.spans().len(), 2);
    assert_eq!(c.text(), "abcdef");
    assert_eq!(c.len(), 6);
}

#[test]
fn insert_delete_and_split_use_utf16_offsets() {
    let mut c = Content::new();
    c.push("a\u{1F600}b", Attrs::empty());
    assert_eq!(c.len(), 4);
    c.insert(3, "X", bold());
    assert_eq!(c.text(), "a\u{1F600}Xb");
    assert_eq!(c.attrs_at(3), Some(&bold()));
    c.delete(1, 3);
    assert_eq!(c.text(), "aXb");
    let tail = c.split_off(1);
    assert_eq!(c.text(), "a");
    assert_eq!(tail.text(), "Xb");
}

#[test]
fn set_attr_splits_and_merges() {
    let mut c = Content::new();
    c.push("hello world", Attrs::empty());
    c.set_attr(0, 5, "r:w:b", Some("<w:b/>"));
    assert_eq!(c.spans().len(), 2);
    c.set_attr(0, 5, "r:w:b", None);
    assert_eq!(c.spans().len(), 1);
}

#[test]
fn deltas_round_trip() {
    let mut c = Content::new();
    c.push("Hello ", Attrs::empty());
    c.push("world", bold());
    let d = c.to_delta();
    assert_eq!(Content::from_delta(&d), c);
    let json = serde_json::to_string(&d).unwrap();
    let back: Vec<DeltaOp> = serde_json::from_str(&json).unwrap();
    assert_eq!(back, d);

    let mut edited = c.clone();
    edited.apply_delta(&insert_delta(6, "big ", &bold()));
    assert_eq!(edited.text(), "Hello big world");
    edited.apply_delta(&delete_delta(0, 6));
    assert_eq!(edited.text(), "big world");
    // Attribute changes as retains.
    let mut plain = edited.clone();
    plain.set_attr(0, 9, "r:w:b", None);
    let ad = attr_delta(&edited, &plain);
    let mut applied = edited.clone();
    applied.apply_delta(&ad);
    assert_eq!(applied, plain);
}

#[test]
fn typing_inherits_formatting_but_not_objects() {
    let mut c = Content::new();
    c.push("ab", bold());
    c.push("\u{FFFC}", bold().with(key::OBJ, Some("<w:fldChar/>")));
    assert_eq!(c.typing_attrs(3), bold());
    assert_eq!(c.typing_attrs(0), bold());
    assert_eq!(Content::new().typing_attrs(0), Attrs::empty());
}

#[test]
fn wrappers_round_trip() {
    let stack = vec![Wrapper {
        open: "<w:hyperlink r:id=\"rId1\">".into(),
        close: "</w:hyperlink>".into(),
    }];
    let encoded = encode_wrappers(&stack).unwrap();
    let attrs = Attrs::from_pairs([(key::WRAP, encoded)]);
    assert_eq!(attrs.wrappers(), stack);
    assert_eq!(stack[0].qname(), "w:hyperlink");
    assert_eq!(stack[0].local(), "hyperlink");
}
