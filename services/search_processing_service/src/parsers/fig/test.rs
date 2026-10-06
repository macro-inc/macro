use super::*;

/// Components with text, a component set, and a screen of their instances.
const DESIGN_SYSTEM: &[u8] =
    include_bytes!("../../../../../crates/fig_engine/tests/fixtures/design-system.fig");

#[test]
fn indexes_one_chunk_per_page_keyed_by_page_id() {
    let pages = parse_fig_pages(DESIGN_SYSTEM).expect("the design decodes");
    assert_eq!(pages.len(), 2);
    assert_eq!(pages[0].node_id, "0:1");
    assert_ne!(pages[0].node_id, pages[1].node_id);
    let screens: Vec<&str> = pages[0].content.lines().collect();
    assert_eq!(screens[0], "Screens", "the page name comes first");
    assert!(screens.contains(&"Screen"), "{screens:?}");
    assert!(screens.contains(&"Welcome"), "{screens:?}");
    assert!(
        screens.contains(&"Card title"),
        "text shown by instances is indexed: {screens:?}"
    );
    assert!(
        pages[1].content.starts_with("Components\n"),
        "{}",
        pages[1].content
    );
}

#[test]
fn page_ids_are_stable_across_reads() {
    let first = parse_fig_pages(DESIGN_SYSTEM).unwrap();
    let second = parse_fig_pages(DESIGN_SYSTEM).unwrap();
    assert_eq!(first, second);
}

#[test]
fn rejects_files_that_are_not_designs() {
    assert!(parse_fig_pages(b"not a design").is_err());
}
