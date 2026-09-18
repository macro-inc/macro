use super::*;

#[test]
fn search_extraction_only_accepts_markdown_snapshots() {
    let markdown = DocumentState::try_from_snapshot(include_bytes!(
        "../../../../static_assets/markdown-golden.1.bin"
    ))
    .unwrap();
    let spreadsheet = DocumentState::try_from_snapshot(include_bytes!(
        "../../../../static_assets/spreadsheet-golden.1.bin"
    ))
    .unwrap();

    assert!(markdown.has_markdown_content());
    assert!(!spreadsheet.has_markdown_content());
    assert!(!DocumentState::new().has_markdown_content());
}
