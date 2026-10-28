use super::markdown;

#[test]
fn converts_reported_gitkeep_and_line_ranges_without_changing_markdown() {
    assert_eq!(
        markdown(
            "- The only tracked file is an empty `.gitkeep`. 【F:.gitkeep†L1】\n\nSee 【F:src/main.rs†L2-L12】."
        ),
        "- The only tracked file is an empty `.gitkeep`. `.gitkeep:1`\n\nSee `src/main.rs:2-12`."
    );
}

#[test]
fn filenames_cannot_escape_the_markdown_code_span() {
    assert_eq!(
        markdown("【F:a`[b](https://example.com).rs†L2】 【F:目录/a file.rs†L1】"),
        "`` a`[b](https://example.com).rs:2 `` `目录/a file.rs:1`"
    );
}

#[test]
fn preserves_unknown_or_malformed_citations() {
    for text in [
        "【F:.gitkeep†L1",
        "【F:file】",
        "【F:†L1】",
        "【F:file†L0】",
        "【F:file†L3-L1】",
        "【F:file†L1-L2-L3】",
        "【F:file†Lx】",
        "【F:file†L1-L0】",
        "【F:file†L+1】",
        "【F:file†L١】",
        "【F:  †L1】",
        "【F:file†L1†L2】",
        "【F:file\u{85}name†L1】",
        "【F:outer 【F:inner†L1】",
        "【F:file†L1\n】",
        "【F:file†L9999999999999999999999】",
        "【F:file\nname†L1】",
        "【other†L1】",
        "**Normal Markdown** with `code` and 💙.",
    ] {
        assert_eq!(markdown(text), text);
    }
}

#[test]
fn preserves_malformed_boundaries_and_normalizes_valid_line_numbers() {
    assert_eq!(
        markdown("【F:outer 【F:inner†L1】 【F:file†L0002-L0003】 【F:last†L4"),
        "【F:outer 【F:inner†L1】 `file:2-3` 【F:last†L4"
    );
    assert_eq!(markdown("【F:a```b.rs†L1】"), "```` a```b.rs:1 ````");
}
