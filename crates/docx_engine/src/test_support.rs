//! Helpers for tests: in-memory packages and the bundled fonts.

use pptx_engine::font::FontDb;
use pptx_engine::zip::{WriteData, Writer};
use std::sync::OnceLock;

/// The bundled fonts, read from the PPTX engine's font directory.
pub fn fonts() -> &'static FontDb {
    static DB: OnceLock<FontDb> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = FontDb::new();
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../pptx_engine/fonts");
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .map(|d| d.filter_map(|e| e.ok()).map(|e| e.path()).collect())
            .unwrap_or_default();
        files.sort();
        for f in files {
            if f.extension().is_some_and(|e| e == "ttf") {
                if let Ok(bytes) = std::fs::read(&f) {
                    db.register(bytes);
                }
            }
        }
        db
    })
}

/// The namespaces test documents declare.
pub const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml""#;

/// Parts of a test document besides the body.
#[derive(Default)]
pub struct Parts<'a> {
    /// `w:styles` children.
    pub styles: Option<&'a str>,
    /// `w:numbering` children.
    pub numbering: Option<&'a str>,
    /// `w:settings` children.
    pub settings: Option<&'a str>,
    /// Header part body (`w:hdr` children), referenced as rIdH1.
    pub header: Option<&'a str>,
    /// Footnotes (`w:footnotes` children).
    pub footnotes: Option<&'a str>,
}

/// A `.docx` with `body` as the content of `w:body`.
pub fn docx(body: &str, parts: &Parts<'_>) -> Vec<u8> {
    let mut files: Vec<(String, String)> = Vec::new();
    let mut rels = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    let mut overrides = String::new();
    let mut add = |name: &str, rel_type: &str, id: &str, ct: &str, xml: String| {
        rels.push_str(&format!(
            r#"<Relationship Id="{id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{rel_type}" Target="{name}"/>"#
        ));
        overrides.push_str(&format!(
            r#"<Override PartName="/word/{name}" ContentType="{ct}"/>"#
        ));
        files.push((format!("word/{name}"), xml));
    };
    let ct = "application/vnd.openxmlformats-officedocument.wordprocessingml.";
    if let Some(s) = parts.styles {
        add(
            "styles.xml",
            "styles",
            "rIdS",
            &format!("{ct}styles+xml"),
            format!("<w:styles {NS}>{s}</w:styles>"),
        );
    }
    if let Some(s) = parts.numbering {
        add(
            "numbering.xml",
            "numbering",
            "rIdN",
            &format!("{ct}numbering+xml"),
            format!("<w:numbering {NS}>{s}</w:numbering>"),
        );
    }
    if let Some(s) = parts.settings {
        add(
            "settings.xml",
            "settings",
            "rIdT",
            &format!("{ct}settings+xml"),
            format!("<w:settings {NS}>{s}</w:settings>"),
        );
    }
    if let Some(s) = parts.header {
        add(
            "header1.xml",
            "header",
            "rIdH1",
            &format!("{ct}header+xml"),
            format!("<w:hdr {NS}>{s}</w:hdr>"),
        );
    }
    if let Some(s) = parts.footnotes {
        add(
            "footnotes.xml",
            "footnotes",
            "rIdF",
            &format!("{ct}footnotes+xml"),
            format!("<w:footnotes {NS}>{s}</w:footnotes>"),
        );
    }
    rels.push_str("</Relationships>");
    let content_types = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="{ct}document.main+xml"/>{overrides}</Types>"#
    );
    let package_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS}><w:body>{body}</w:body></w:document>"#
    );
    let mut w = Writer::new();
    let entries: Vec<(String, String)> = [
        ("[Content_Types].xml".to_owned(), content_types),
        ("_rels/.rels".to_owned(), package_rels.to_owned()),
        ("word/document.xml".to_owned(), document),
        ("word/_rels/document.xml.rels".to_owned(), rels),
    ]
    .into_iter()
    .chain(files)
    .collect();
    for (name, data) in &entries {
        w.add(
            name,
            WriteData::Fresh {
                data: data.as_bytes(),
                compress: true,
            },
        )
        .expect("zip entry");
    }
    w.finish().expect("zip")
}
