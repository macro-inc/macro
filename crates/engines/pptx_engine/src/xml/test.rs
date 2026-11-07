use super::*;

const SLIDE: &str = concat!(
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n",
    "<p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" ",
    "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
    "xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
    "<p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Title 1\"/></p:nvSpPr>",
    "<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang=\"en-US\" dirty=\"0\"/>",
    "<a:t>R&amp;D &lt;2024&gt; caf\u{e9}</a:t></a:r></a:p></p:txBody></p:sp>",
    "<!-- keep me --></p:spTree></p:cSld></p:sld>"
);

#[test]
fn round_trips_source_exactly() {
    let doc = XmlDoc::parse(SLIDE.as_bytes(), "slide1.xml").unwrap();
    assert_eq!(String::from_utf8(doc.to_bytes()).unwrap(), SLIDE);
}

#[test]
fn resolves_namespaces_independent_of_prefix() {
    let alt = SLIDE
        .replace("a:", "draw:")
        .replace("xmlns:a=", "xmlns:draw=");
    for src in [SLIDE.to_owned(), alt] {
        let doc = XmlDoc::parse(src.as_bytes(), "s").unwrap();
        let root = doc.root();
        assert!(doc.is(root, Ns::P, "sld"));
        let t = doc
            .descendants(root)
            .into_iter()
            .find(|&n| doc.is(n, Ns::A, "t"))
            .unwrap();
        assert_eq!(doc.text(t), "R&D <2024> caf\u{e9}");
        let rpr = doc
            .descendants(root)
            .into_iter()
            .find(|&n| doc.is(n, Ns::A, "rPr"))
            .unwrap();
        assert_eq!(doc.attr(rpr, "lang"), Some("en-US"));
        assert_eq!(doc.attr_bool(rpr, "dirty"), Some(false));
    }
}

#[test]
fn default_namespace_and_strict_uris() {
    let src = "<sld xmlns=\"http://purl.oclc.org/ooxml/presentationml/main\"><cSld/></sld>";
    let doc = XmlDoc::parse(src.as_bytes(), "s").unwrap();
    assert!(doc.is(doc.root(), Ns::P, "sld"));
    assert!(doc.child(doc.root(), Ns::P, "cSld").is_some());
}

#[test]
fn created_elements_reuse_in_scope_prefixes() {
    let mut doc = XmlDoc::parse(SLIDE.as_bytes(), "s").unwrap();
    let rpr = doc
        .descendants(doc.root())
        .into_iter()
        .find(|&n| doc.is(n, Ns::A, "rPr"))
        .unwrap();
    let fill = doc.create_element(Ns::A, "solidFill");
    let clr = doc.create_element(Ns::A, "srgbClr");
    doc.set_attr(clr, "val", "FF0000");
    doc.append_child(fill, clr);
    doc.append_child(rpr, fill);
    let blip = doc.create_element(Ns::A, "blip");
    doc.set_attr_ns(blip, Ns::R, "embed", "rId9");
    doc.append_child(rpr, blip);
    let out = String::from_utf8(doc.to_bytes()).unwrap();
    assert!(out.contains("<a:rPr lang=\"en-US\" dirty=\"0\"><a:solidFill><a:srgbClr val=\"FF0000\"/></a:solidFill><a:blip r:embed=\"rId9\"/></a:rPr>"), "{out}");
    // Output parses back to the same structure.
    let again = XmlDoc::parse(out.as_bytes(), "s").unwrap();
    assert_eq!(again.to_bytes(), doc.to_bytes());
}

#[test]
fn declares_missing_namespaces_on_demand() {
    let mut doc = XmlDoc::parse(b"<root xmlns=\"urn:x\"/>", "s").unwrap();
    let child = doc.create_element(Ns::P14, "creationId");
    doc.set_attr(child, "val", "1");
    doc.append_child(doc.root(), child);
    let plain = doc.create_element(Ns::NONE, "plain");
    doc.append_child(doc.root(), plain);
    let out = String::from_utf8(doc.to_bytes()).unwrap();
    assert!(out.contains("<p14:creationId xmlns:p14=\"http://schemas.microsoft.com/office/powerpoint/2010/main\" val=\"1\"/>"), "{out}");
    assert!(out.contains("<plain xmlns=\"\"/>"), "{out}");
}

#[test]
fn ensure_child_respects_schema_order() {
    let mut doc = XmlDoc::parse(
        b"<a:pPr xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><a:lnSpc/><a:buNone/></a:pPr>",
        "s",
    )
    .unwrap();
    const ORDER: &[&str] = &["lnSpc", "spcBef", "spcAft", "buClrTx", "buClr", "buNone"];
    let root = doc.root();
    doc.ensure_child(root, Ns::A, "spcAft", ORDER);
    let names: Vec<_> = doc
        .children(root)
        .map(|c| doc.local(c).to_owned())
        .collect();
    assert_eq!(names, ["lnSpc", "spcAft", "buNone"]);
}

#[test]
fn entities_cdata_and_whitespace() {
    let doc = XmlDoc::parse(
        "<r a=\"x&#10;y\tz\"><![CDATA[<raw>]]>&#x1F600;&#65;\r\nb</r>".as_bytes(),
        "s",
    )
    .unwrap();
    assert_eq!(doc.attr(doc.root(), "a"), Some("x\ny z"));
    assert_eq!(doc.text(doc.root()), "<raw>\u{1F600}A\nb");
    let out = String::from_utf8(doc.to_bytes()).unwrap();
    assert_eq!(out, "<r a=\"x&#10;y z\"><![CDATA[<raw>]]>\u{1F600}A\nb</r>");
}

#[test]
fn utf16_input_is_transcoded() {
    let src = "<?xml version=\"1.0\" encoding=\"UTF-16\"?><r>\u{3b1}</r>";
    let mut bytes = vec![0xFF, 0xFE];
    for u in src.encode_utf16() {
        bytes.extend_from_slice(&u.to_le_bytes());
    }
    let doc = XmlDoc::parse(&bytes, "s").unwrap();
    assert_eq!(doc.text(doc.root()), "\u{3b1}");
    let out = String::from_utf8(doc.to_bytes()).unwrap();
    assert!(out.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\""));
}

#[test]
fn rejects_malformed_documents() {
    for bad in [
        "",
        "<a>",
        "<a></b>",
        "<a x=1/>",
        "<a x=\"1\" x=\"2\"/>",
        "<a>&bogus;</a>",
        "<a/><b/>",
        "text",
    ] {
        assert!(
            XmlDoc::parse(bad.as_bytes(), "s").is_err(),
            "{bad:?} should fail"
        );
    }
}

#[test]
fn doctype_entities_are_not_expanded() {
    let src = "<!DOCTYPE r [<!ENTITY x \"boom\">]><r>&x;</r>";
    assert!(XmlDoc::parse(src.as_bytes(), "s").is_err());
}

#[test]
fn import_maps_namespaces_between_documents() {
    let src = XmlDoc::parse(
        b"<x:sp xmlns:x=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:y=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><y:off x=\"1\"/></x:sp>",
        "a",
    )
    .unwrap();
    let mut dst = XmlDoc::parse(SLIDE.as_bytes(), "b").unwrap();
    let copy = dst.import(&src, src.root());
    let tree = dst
        .descendants(dst.root())
        .into_iter()
        .find(|&n| dst.is(n, Ns::P, "spTree"))
        .unwrap();
    dst.append_child(tree, copy);
    let out = String::from_utf8(dst.to_bytes()).unwrap();
    assert!(out.contains("<p:sp><a:off x=\"1\"/></p:sp>"), "{out}");
}

#[test]
fn deep_clone_and_detach() {
    let mut doc = XmlDoc::parse(SLIDE.as_bytes(), "s").unwrap();
    let sp = doc
        .descendants(doc.root())
        .into_iter()
        .find(|&n| doc.is(n, Ns::P, "sp"))
        .unwrap();
    let copy = doc.deep_clone(sp);
    doc.insert_after(sp, copy);
    let tree = doc.parent(sp).unwrap();
    assert_eq!(doc.children_named(tree, Ns::P, "sp").count(), 2);
    doc.detach(sp);
    assert_eq!(doc.children_named(tree, Ns::P, "sp").count(), 1);
    assert_eq!(doc.index_in_parent(copy), Some(0));
}
