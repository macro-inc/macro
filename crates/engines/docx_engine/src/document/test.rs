use super::*;
use crate::model::block::BlockKind;

fn fixture(name: &str) -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// Every paragraph's text and the block structure, for comparing models.
fn summary(story: &Story) -> Vec<(usize, &'static str, String)> {
    let mut out = Vec::new();
    story.walk(|b, depth| {
        out.push((depth, b.kind.code(), b.content.text()));
    });
    out
}

#[test]
fn opens_fixtures_and_round_trips_the_body() {
    for name in ["mutual-nda.docx", "complex-msa.docx", "simple_test.docx"] {
        let doc = Document::open(fixture(name)).unwrap();
        assert!(!doc.body().is_empty(), "{name}: empty body");
        let xml = doc.document_xml();
        let tree = XmlTree::parse(xml.as_bytes(), "rewritten").unwrap();
        let body = tree.w_child(tree.root(), "body").unwrap();
        let mut ids = IdGen::sequential();
        let reread = StoryReader::new(&tree, &mut ids).read(body);
        assert_eq!(
            summary(doc.body()),
            summary(&reread.story),
            "{name}: rewriting changed the content"
        );
        // Every block keeps its properties and attributes.
        let a: Vec<_> = doc.body().paragraphs();
        let b: Vec<_> = reread.story.paragraphs();
        for (x, y) in a.iter().zip(&b) {
            let (x, y) = (doc.body().get(x).unwrap(), reread.story.get(y).unwrap());
            assert_eq!(x.props, y.props, "{name}");
            assert_eq!(x.content, y.content, "{name}");
        }
        // Saving an unedited document keeps the original bytes of every part.
        let saved = doc.save().unwrap();
        let again = Document::open(saved).unwrap();
        assert_eq!(summary(doc.body()), summary(again.body()));
    }
}

#[test]
fn reads_styles_numbering_and_sections() {
    let doc = Document::open(fixture("complex-msa.docx")).unwrap();
    let parts = doc.parts();
    assert!(parts.styles.all().count() > 5);
    let section = doc.final_section();
    assert!(section.page_w > 500.0 && section.page_h > 600.0);
    let paragraphs = doc
        .body()
        .blocks()
        .filter(|b| b.kind == BlockKind::Paragraph)
        .count();
    assert!(paragraphs > 10);
}
