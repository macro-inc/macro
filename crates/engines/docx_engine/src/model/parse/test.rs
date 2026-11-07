use super::*;
use crate::model::write::Writer;

const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;

fn read(body: &str) -> (Story, Option<String>) {
    let xml = format!("<w:document {NS}><w:body>{body}</w:body></w:document>");
    let t = XmlTree::parse(xml.as_bytes(), "t").unwrap();
    let body = t.w_child(t.root(), "body").unwrap();
    let mut ids = IdGen::sequential();
    let r = StoryReader::new(&t, &mut ids).read(body);
    (r.story, r.final_sect_pr)
}

fn first_paragraph(s: &Story) -> &Block {
    s.get(&s.paragraphs()[0]).unwrap()
}

#[test]
fn flattens_runs_wrappers_and_objects() {
    let (s, sect) = read(concat!(
        r#"<w:p><w:pPr><w:jc w:val="center"/></w:pPr>"#,
        r#"<w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>Bold</w:t></w:r>"#,
        r#"<w:bookmarkStart w:id="0" w:name="x"/>"#,
        r#"<w:hyperlink r:id="rId5"><w:r><w:t xml:space="preserve"> link</w:t></w:r></w:hyperlink>"#,
        r#"<w:r><w:tab/><w:t>a</w:t><w:br/><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText></w:r>"#,
        r#"<w:proofErr w:type="spellStart"/><w:del w:id="1" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del>"#,
        r#"</w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>"#
    ));
    assert!(sect.unwrap().contains("pgSz"));
    let p = first_paragraph(&s);
    assert_eq!(p.props, r#"<w:pPr><w:jc w:val="center"/></w:pPr>"#);
    assert_eq!(p.content.text(), "Bold\u{FFFC} link\ta\n\u{FFFC} PAGE gone");
    let spans = p.content.spans();
    assert_eq!(spans[0].attrs.get("r:w:b"), Some("<w:b/>"));
    assert_eq!(spans[0].attrs.get("r:w:sz"), Some(r#"<w:sz w:val="24"/>"#));
    assert!(spans[1].attrs.marker().unwrap().contains("bookmarkStart"));
    assert_eq!(spans[2].attrs.wrappers()[0].local(), "hyperlink");
    assert!(p.content.spans().iter().any(|s| s.attrs.is_instr()));
    assert!(
        p.content
            .spans()
            .iter()
            .any(|s| s.attrs.wrappers().iter().any(|w| w.local() == "del"))
    );
}

#[test]
fn writes_back_equivalent_xml() {
    let body = concat!(
        r#"<w:p w14:paraId="1" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:r><w:rPr><w:sz w:val="24"/><w:b/></w:rPr><w:t>Bold</w:t></w:r>"#,
        r#"<w:hyperlink r:id="rId5"><w:r><w:t xml:space="preserve"> link </w:t></w:r></w:hyperlink>"#,
        r#"<w:del w:id="1" w:author="A"><w:r><w:delText>gone</w:delText></w:r></w:del>"#,
        r#"<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>"#,
        r#"<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid>"#,
        r#"<w:tr><w:tc><w:tcPr><w:tcW w:w="100" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#,
        r#"<w:sdt><w:sdtPr><w:id w:val="5"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>in control</w:t></w:r></w:p></w:sdtContent></w:sdt>"#
    );
    let (s, _) = read(body);
    let out = Writer { w: "w" }.story(&s);
    // Run properties come out in schema order.
    assert!(
        out.contains(r#"<w:rPr><w:b/><w:sz w:val="24"/></w:rPr>"#),
        "{out}"
    );
    assert!(out.contains(r#"<w:hyperlink r:id="rId5"><w:r><w:t xml:space="preserve"> link </w:t></w:r></w:hyperlink>"#), "{out}");
    assert!(out.contains("<w:delText>gone</w:delText>"), "{out}");
    assert!(out.contains("<w:instrText>PAGE</w:instrText>"), "{out}");
    assert!(
        out.contains("<w:sdtContent><w:p><w:r><w:t>in control</w:t></w:r></w:p></w:sdtContent>"),
        "{out}"
    );
    // Reading the output again gives the same model.
    let (again, _) = read(&out);
    let texts = |s: &Story| -> Vec<String> {
        s.paragraphs()
            .iter()
            .map(|p| s.get(p).unwrap().content.text())
            .collect()
    };
    assert_eq!(texts(&s), texts(&again));
    assert_eq!(Writer { w: "w" }.story(&again), out);
}

#[test]
fn empty_cells_get_a_paragraph() {
    let (s, _) = read(r#"<w:tbl><w:tr><w:tc><w:tcPr/></w:tc></w:tr></w:tbl>"#);
    assert_eq!(s.paragraphs().len(), 1);
}
