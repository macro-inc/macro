use super::*;
use crate::model::Vec2;
use crate::testing::showcase_file;

fn idx(doc: &Document, id: &str) -> NodeIdx {
    doc.find(Guid::parse(id).unwrap()).unwrap()
}

#[test]
fn copies_layers_at_their_page_positions() {
    let bytes = showcase_file();
    let doc = Document::open(&bytes).unwrap();
    // The avatar (inside the Home frame) and the Settings frame.
    let copied = copy(&doc, &bytes, &[idx(&doc, "1:20"), idx(&doc, "1:12")]).unwrap();
    assert!(copied.document.starts_with(b"fig-kiwi"));
    let clip = Document::open(&copied.document).unwrap();
    assert_eq!(clip.pages.len(), 1);
    let roots: Vec<&str> = clip
        .node(clip.pages[0])
        .children
        .iter()
        .map(|&c| clip.props(c).name())
        .collect();
    assert_eq!(roots, ["Avatar", "Settings"], "in stacking order");
    let avatar = clip.node(clip.pages[0]).children[0];
    let origin = clip.world(avatar).apply(Vec2::default());
    assert_eq!(origin, Vec2::new(132.0, 112.0));
    // Its outline came along, renumbered into the copy's blobs.
    let g = clip.props(avatar).fill_geometry()[0];
    assert_eq!(g.blob, 0);
    assert!(clip.blobs.path(g.blob).is_some());
}

#[test]
fn copies_the_components_instances_show() {
    let bytes = showcase_file();
    let doc = Document::open(&bytes).unwrap();
    let copied = copy(&doc, &bytes, &[idx(&doc, "1:14")]).unwrap();
    let clip = Document::open(&copied.document).unwrap();
    let component = clip.find(Guid::parse("1:30").unwrap()).unwrap();
    assert_eq!(clip.props(component).node_type(), NodeType::Symbol);
    let page = clip.page_of(component).unwrap();
    assert_eq!(clip.props(page).internal_only, Some(true));
    assert!(copied.images.is_empty());
}
