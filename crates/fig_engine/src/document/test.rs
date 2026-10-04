use super::*;
use crate::testing::{V, fig_file, fig_zip, node, path_blob, simple_file, size, solid};

fn names(doc: &Document, parent: NodeIdx) -> Vec<String> {
    doc.node(parent)
        .children
        .iter()
        .map(|&c| doc.props(c).name.as_deref().unwrap_or("").to_owned())
        .collect()
}

#[test]
fn opens_the_legacy_layout() {
    let doc = Document::open(&simple_file()).unwrap();
    assert_eq!(doc.version, 20);
    assert_eq!(doc.pages.len(), 1);
    let page = doc.pages[0];
    assert_eq!(doc.props(page).name.as_deref(), Some("Page 1"));
    assert_eq!(names(&doc, page), ["Frame"]);
    let frame = doc.node(page).children[0];
    assert_eq!(names(&doc, frame), ["Red"]);
    assert_eq!(doc.page_background(page).r, 0.9);
}

#[test]
fn opens_the_zip_layout() {
    let zip = fig_zip(&simple_file(), "Design system");
    assert!(crate::container::is_fig(&zip));
    let doc = Document::open(&zip).unwrap();
    assert_eq!(doc.file_name.as_deref(), Some("Design system"));
    assert_eq!(doc.pages.len(), 1);
}

#[test]
fn rejects_other_files() {
    assert!(matches!(
        Document::open(b"%PDF-1.7 hello"),
        Err(FigError::NotFigma)
    ));
    assert!(Document::open(b"fig-kiwi\x14\0\0\0\xff\xff\xff\xff").is_err());
    assert!(!crate::container::is_fig(b"PK\x03\x04 not a figma zip"));
}

#[test]
fn orders_children_by_position() {
    let bytes = fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(1, Some((0, "!")), "CANVAS", "Page", vec![]),
            // Fractional index strings sort bytewise; file order is irrelevant.
            node(4, Some((1, "c")), "RECTANGLE", "Third", vec![]),
            node(2, Some((1, "a")), "RECTANGLE", "First", vec![]),
            node(3, Some((1, "b")), "RECTANGLE", "Second", vec![]),
        ],
        vec![],
    );
    let doc = Document::open(&bytes).unwrap();
    assert_eq!(names(&doc, doc.pages[0]), ["First", "Second", "Third"]);
}

#[test]
fn skips_removed_nodes_and_merges_repeated_changes() {
    let bytes = fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(1, Some((0, "!")), "CANVAS", "Page", vec![]),
            node(2, Some((1, "a")), "RECTANGLE", "Kept", vec![]),
            node(
                3,
                Some((1, "b")),
                "RECTANGLE",
                "Gone",
                vec![("phase", V::Enum("REMOVED"))],
            ),
            // A later change to node 2 renames it and leaves the rest alone.
            V::Msg(vec![
                ("guid", crate::testing::guid(2)),
                ("name", V::Str("Renamed".into())),
                ("size", size(5.0, 6.0)),
            ]),
        ],
        vec![],
    );
    let doc = Document::open(&bytes).unwrap();
    assert_eq!(names(&doc, doc.pages[0]), ["Renamed"]);
    let rect = doc.node(doc.pages[0]).children[0];
    assert_eq!(doc.props(rect).node_type(), NodeType::Rectangle);
    assert_eq!(doc.props(rect).size().x, 5.0);
}

#[test]
fn hides_internal_pages() {
    let bytes = fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(1, Some((0, "a")), "CANVAS", "Visible", vec![]),
            node(
                2,
                Some((0, "b")),
                "CANVAS",
                "Internal Only Canvas",
                vec![("internalOnly", V::Bool(true))],
            ),
            node(3, Some((0, "c")), "CANVAS", "Also visible", vec![]),
        ],
        vec![],
    );
    let doc = Document::open(&bytes).unwrap();
    let pages: Vec<_> = doc
        .pages
        .iter()
        .map(|&p| doc.props(p).name.as_deref().unwrap_or("").to_owned())
        .collect();
    assert_eq!(pages, ["Visible", "Also visible"]);
}

#[test]
fn keeps_only_blob_bytes() {
    let square = path_blob(&[
        (1, &[0.0, 0.0]),
        (2, &[10.0, 0.0]),
        (2, &[10.0, 10.0]),
        (2, &[0.0, 10.0]),
        (0, &[]),
    ]);
    let other = vec![9u8; 7];
    let bytes = fig_file(
        vec![
            node(0, None, "DOCUMENT", "Document", vec![]),
            node(1, Some((0, "!")), "CANVAS", "Page", vec![]),
            node(
                2,
                Some((1, "!")),
                "VECTOR",
                "Square",
                vec![
                    ("size", size(10.0, 10.0)),
                    ("fillPaints", V::List(vec![solid(0.0, 0.0, 0.0)])),
                    (
                        "fillGeometry",
                        V::List(vec![V::Msg(vec![
                            ("windingRule", V::Enum("NONZERO")),
                            ("commandsBlob", V::Uint(1)),
                        ])]),
                    ),
                ],
            ),
        ],
        vec![other.clone(), square.clone()],
    );
    let doc = Document::open(&bytes).unwrap();
    assert_eq!(doc.blobs.len(), 2);
    assert_eq!(doc.blobs.bytes(0), Some(other.as_slice()));
    assert_eq!(doc.blobs.bytes(1), Some(square.as_slice()));
    let path = doc.blobs.path(1).unwrap();
    let b = path.bounds();
    assert_eq!((b.x, b.y, b.w, b.h), (0.0, 0.0, 10.0, 10.0));
    assert!(doc.blobs.bytes(2).is_none());
}
