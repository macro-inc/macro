use super::*;

fn sample() -> Vec<u8> {
    let mut w = zip::Writer::new();
    let ct = br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>"#;
    let rels = br#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>"#;
    let pres_rels = br#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%201.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a&amp;b" TargetMode="External"/></Relationships>"#;
    for (name, data) in [
        ("[Content_Types].xml", &ct[..]),
        ("_rels/.rels", &rels[..]),
        ("ppt/presentation.xml", b"<p/>"),
        ("ppt/_rels/presentation.xml.rels", &pres_rels[..]),
        ("ppt/slides/slide 1.xml", b"<s/>"),
    ] {
        w.add(
            name,
            WriteData::Fresh {
                data,
                compress: true,
            },
        )
        .unwrap();
    }
    w.finish().unwrap()
}

#[test]
fn part_name_helpers() {
    assert_eq!(
        normalize_part_name("ppt/slides/../media/./a.png"),
        "/ppt/media/a.png"
    );
    assert_eq!(
        rels_part_name("/ppt/slides/slide1.xml"),
        "/ppt/slides/_rels/slide1.xml.rels"
    );
    assert_eq!(
        resolve_target("/ppt/slides/slide1.xml", "../media/image1.png"),
        "/ppt/media/image1.png"
    );
    assert_eq!(
        resolve_target("/ppt/slides/slide1.xml", "/ppt/media/x.png"),
        "/ppt/media/x.png"
    );
    assert_eq!(
        relative_target("/ppt/slides/slide1.xml", "/ppt/media/image1.png"),
        "../media/image1.png"
    );
    assert_eq!(
        relative_target("/ppt/presentation.xml", "/ppt/slides/slide2.xml"),
        "slides/slide2.xml"
    );
    assert_eq!(percent_decode("a%20b%zz%"), "a b%zz%");
}

#[test]
fn opens_and_resolves_relationships() {
    let pkg = Package::open(sample()).unwrap();
    assert_eq!(pkg.main_part().unwrap(), "/ppt/presentation.xml");
    let rels = pkg.rels("/ppt/presentation.xml").unwrap();
    assert_eq!(
        rels.target_part("rId2").as_deref(),
        Some("/ppt/slides/slide 1.xml")
    );
    assert!(
        pkg.has_part("/PPT/Slides/Slide 1.xml"),
        "lookups are case-insensitive"
    );
    assert_eq!(rels.get("rId9").unwrap().target, "https://example.com/a&b");
    assert_eq!(
        rels.target_part("rId9"),
        None,
        "external targets are not parts"
    );
    assert_eq!(
        pkg.content_type("/ppt/presentation.xml"),
        Some("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")
    );
    assert_eq!(
        pkg.content_type("/ppt/slides/slide 1.xml"),
        Some("application/xml")
    );
}

#[test]
fn unmodified_save_is_lossless() {
    let original = sample();
    let pkg = Package::open(original.clone()).unwrap();
    let saved = pkg.save().unwrap();
    let a = Archive::parse(&original).unwrap();
    let b = Archive::parse(&saved).unwrap();
    assert_eq!(a.entries().len(), b.entries().len());
    for (x, y) in a.entries().iter().zip(b.entries()) {
        assert_eq!(x.name, y.name);
        assert_eq!(
            a.raw_data(x),
            b.raw_data(y),
            "{} must be byte-identical",
            x.name
        );
    }
}

#[test]
fn writes_new_parts_and_relationships() {
    let mut pkg = Package::open(sample()).unwrap();
    let name = pkg.unique_part_name("/ppt/slides/slide", ".xml");
    assert_eq!(name, "/ppt/slides/slide1.xml");
    pkg.write(&name, b"<p:sld/>".to_vec(), Some(content_type::SLIDE));
    let mut rels = pkg.rels("/ppt/presentation.xml").unwrap();
    let id = rels.add_internal(rel_type::SLIDE, &name);
    assert_eq!(id, "rId1");
    pkg.write_rels(&rels);
    pkg.delete("/ppt/slides/slide 1.xml");
    let reopened = Package::open(pkg.save().unwrap()).unwrap();
    assert_eq!(reopened.content_type(&name), Some(content_type::SLIDE));
    assert!(!reopened.has_part("/ppt/slides/slide 1.xml"));
    let rels = reopened.rels("/ppt/presentation.xml").unwrap();
    assert_eq!(
        rels.target_part("rId1").as_deref(),
        Some("/ppt/slides/slide1.xml")
    );
    assert_eq!(&*reopened.read(&name).unwrap(), b"<p:sld/>");
}
