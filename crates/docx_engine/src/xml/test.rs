use super::*;

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

fn doc(body: &str) -> String {
    format!(
        "<?xml version=\"1.0\"?><w:document xmlns:w=\"{W}\" xmlns:x=\"urn:x\"><w:body>{body}</w:body></w:document>"
    )
}

#[test]
fn resolves_namespaces_and_keeps_raw_spans() {
    let src =
        doc("<w:p w:rsidR=\"01\"><w:r><w:t xml:space=\"preserve\"> a &amp; b </w:t></w:r></w:p>");
    let t = XmlTree::parse(src.as_bytes(), "t").unwrap();
    let body = t.w_child(t.root(), "body").unwrap();
    let p = t.w_child(body, "p").unwrap();
    assert!(t.is_w(p, "p"));
    assert_eq!(t.w_attr(p, "rsidR"), Some("01"));
    assert_eq!(t.raw_attrs(p), " w:rsidR=\"01\"");
    let r = t.w_child(p, "r").unwrap();
    let text = t.w_child(r, "t").unwrap();
    assert_eq!(t.text(text), " a & b ");
    assert_eq!(t.raw(text), "<w:t xml:space=\"preserve\"> a &amp; b </w:t>");
    assert_eq!(t.attr(text, Ns::XML, "space"), Some("preserve"));
}

#[test]
fn snippets_carry_inner_declarations() {
    let src = doc("<w:p><w:r xmlns:y=\"urn:y\"><y:thing/></w:r></w:p>");
    let t = XmlTree::parse(src.as_bytes(), "t").unwrap();
    let body = t.w_child(t.root(), "body").unwrap();
    let p = t.w_child(body, "p").unwrap();
    let r = t.w_child(p, "r").unwrap();
    let thing = t.children(r).next().unwrap();
    // The declaration on <w:r> is copied onto the snippet; root ones are not.
    assert_eq!(t.snippet(thing), "<y:thing xmlns:y=\"urn:y\"/>");
    let ctx = SnippetContext::new(t.root_decls());
    let again = ctx.parse(&t.snippet(thing)).unwrap();
    assert_eq!(again.ns_uri(again.ns(again.root())), Some("urn:y"));
}

#[test]
fn parses_snippets_in_root_context() {
    let ctx = SnippetContext::new(&[Decl {
        prefix: "w".into(),
        uri: W.into(),
    }]);
    let t = ctx.parse("<w:sz w:val=\"24\"/>").unwrap();
    assert!(t.is_w(t.root(), "sz"));
    assert_eq!(t.val(t.root()), Some("24"));
    let (tree, kids) = ctx
        .parse_many("<w:tblPr/><w:tblGrid><w:gridCol w:w=\"10\"/></w:tblGrid>")
        .unwrap();
    assert_eq!(kids.len(), 2);
    assert!(tree.is_w(kids[1], "tblGrid"));
}

#[test]
fn rejects_malformed_xml() {
    assert!(XmlTree::parse(b"<a><b></a>", "t").is_err());
    assert!(XmlTree::parse(b"<a attr=x/>", "t").is_err());
    assert!(XmlTree::parse(b"", "t").is_err());
}

#[test]
fn decodes_entities_and_utf16() {
    let t = XmlTree::parse(b"<a v=\"&#x41;&#66;&lt;\">&#x1F600;</a>", "t").unwrap();
    assert_eq!(t.attr(t.root(), Ns::NONE, "v"), Some("AB<"));
    assert_eq!(t.text(t.root()), "\u{1F600}");
    let utf16: Vec<u8> = "\u{FEFF}<a>é</a>"
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();
    let t = XmlTree::parse(&utf16, "t").unwrap();
    assert_eq!(t.text(t.root()), "é");
}

#[test]
fn on_off_values() {
    assert!(parse_on_off(None));
    assert!(parse_on_off(Some("1")));
    assert!(parse_on_off(Some("true")));
    assert!(!parse_on_off(Some("0")));
    assert!(!parse_on_off(Some("false")));
    assert_eq!(parse_int(" +12 "), Some(12));
    assert_eq!(parse_int("12.6"), Some(13));
}
