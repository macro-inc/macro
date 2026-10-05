//! Helpers for tests: in-memory packages, the bundled fonts and comparing
//! layouts.

use crate::layout::{Item, Layout, Page, PlacedDrawing, PlacedLine};
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
            if f.extension().is_some_and(|e| e == "ttf")
                && let Ok(bytes) = std::fs::read(&f)
            {
                db.register(bytes);
            }
        }
        db
    })
}

/// The namespaces test documents declare.
pub const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:v="urn:schemas-microsoft-com:vml""#;

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
    /// Endnotes (`w:endnotes` children).
    pub endnotes: Option<&'a str>,
    /// Comments (`w:comments` children).
    pub comments: Option<&'a str>,
    /// Comment threads (`w15:commentsEx` children).
    pub comments_extended: Option<&'a str>,
}

/// A `.docx` with `body` as the content of `w:body`.
pub fn docx(body: &str, parts: &Parts<'_>) -> Vec<u8> {
    let mut files: Vec<(String, String)> = Vec::new();
    let mut rels = String::from(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
    );
    let mut overrides = String::new();
    let mut add = |name: &str, rel_type: &str, id: &str, ct: &str, xml: String| {
        let rel_type = if rel_type.contains("://") {
            rel_type.to_owned()
        } else {
            format!(
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/{rel_type}"
            )
        };
        rels.push_str(&format!(
            r#"<Relationship Id="{id}" Type="{rel_type}" Target="{name}"/>"#
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
    if let Some(s) = parts.endnotes {
        add(
            "endnotes.xml",
            "endnotes",
            "rIdE",
            &format!("{ct}endnotes+xml"),
            format!("<w:endnotes {NS}>{s}</w:endnotes>"),
        );
    }
    if let Some(s) = parts.comments {
        add(
            "comments.xml",
            "comments",
            "rIdC",
            &format!("{ct}comments+xml"),
            format!("<w:comments {NS}>{s}</w:comments>"),
        );
    }
    if let Some(s) = parts.comments_extended {
        add(
            "commentsExtended.xml",
            "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
            "rIdCX",
            &format!("{ct}commentsExtended+xml"),
            format!(
                r#"<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">{s}</w15:commentsEx>"#
            ),
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

/// A paragraph anchoring a 200x100pt shape positioned `from` at (x, y)
/// points, holding the text `text` when given.
pub fn shape_paragraph(from: &str, x: i64, y: i64, text: Option<&str>) -> String {
    const EMU: i64 = 12_700;
    let txbx = text.map_or(String::new(), |t| {
        format!("<wps:txbx><w:txbxContent><w:p><w:r><w:t>{t}</w:t></w:r></w:p></w:txbxContent></wps:txbx>")
    });
    format!(
        r#"<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="{from}"><wp:posOffset>{}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="{from}"><wp:posOffset>{}</wp:posOffset></wp:positionV><wp:extent cx="{}" cy="{}"/><wp:wrapNone/><wp:docPr id="1" name="Box"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></wps:spPr>{txbx}<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>"#,
        x * EMU,
        y * EMU,
        200 * EMU,
        100 * EMU
    )
}

/// Where two layouts differ, if they do: page geometry and every item, a
/// line with its clusters, their positions and run styles.
pub fn layout_diff(a: &Layout, b: &Layout) -> Option<String> {
    if a.pages.len() != b.pages.len() {
        return Some(format!("{} pages, then {}", a.pages.len(), b.pages.len()));
    }
    for (i, (pa, pb)) in a.pages.iter().zip(&b.pages).enumerate() {
        let (ga, gb) = (page_key(pa), page_key(pb));
        if ga != gb {
            return Some(format!("page {i}: {ga} then {gb}"));
        }
        let lists = [
            ("behind", &pa.behind, &pb.behind),
            ("items", &pa.items, &pb.items),
            ("front", &pa.front, &pb.front),
        ];
        for (name, xa, xb) in lists {
            if xa.len() != xb.len() {
                return Some(format!(
                    "page {i} {name}: {} items, then {}",
                    xa.len(),
                    xb.len()
                ));
            }
            for (k, (ia, ib)) in xa.iter().zip(xb).enumerate() {
                let (sa, sb) = (item_key(ia), item_key(ib));
                if sa != sb {
                    return Some(format!("page {i} {name} {k}: {sa}\nthen\n{sb}"));
                }
            }
        }
    }
    None
}

fn page_key(p: &Page) -> String {
    format!(
        "{:?} {:?} {:?} {:?} {:?} {:?} {:?}",
        p.width, p.height, p.section, p.number, p.body, p.header, p.footer
    )
}

fn item_key(item: &Item) -> String {
    match item {
        Item::Line(l) => line_key(l),
        Item::Drawing(d) => drawing_key(d),
        other => format!("{other:?}"),
    }
}

fn line_key(l: &PlacedLine) -> String {
    let pb = &l.para;
    let line = l.line();
    let mut out = format!(
        "{:?} {:?} line {} at ({:?}, {:?}) clip {:?} {line:?}",
        pb.story, pb.block, l.line, l.x, l.y, l.clip
    );
    for c in line.start..line.end {
        let cl = &pb.inline.clusters[c];
        out.push_str(&format!(
            "\n{cl:?} x {:?} adv {:?} run {:?} level {:?}",
            pb.lines.x.get(c),
            pb.lines.adv.get(c),
            pb.inline.runs.get(usize::from(cl.run)),
            pb.inline.levels.get(c)
        ));
    }
    let leaders: Vec<_> = pb
        .lines
        .leaders
        .iter()
        .filter(|(c, _)| (line.start..line.end).contains(c))
        .collect();
    out.push_str(&format!("\nleaders {leaders:?}"));
    out
}

fn drawing_key(d: &PlacedDrawing) -> String {
    let g = &d.drawing;
    format!(
        "drawing {:?} {:?} {:?} {:?} {:?} {:?} {:?} {:?}",
        d.rect, d.story, g.width, g.height, g.effect, g.anchor, g.node, g.vml
    )
}
