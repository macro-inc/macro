use super::*;

#[test]
fn blank_documents_have_one_layer() {
    let doc = blank(300, 200, true);
    assert_eq!(doc.roots.len(), 1);
    let bg = doc.layer(doc.roots[0]);
    assert!(bg.background);
    assert_eq!(bg.pixels.content_bounds(), Some(IRect::new(0, 0, 300, 200)));
    let doc = blank(10, 10, false);
    assert!(doc.layer(doc.roots[0]).pixels.is_empty());
}
