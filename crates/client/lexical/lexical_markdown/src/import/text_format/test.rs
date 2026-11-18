use super::*;
#[derive(serde::Deserialize)]
struct Oracle {
    formats: Vec<Case>,
}
#[derive(serde::Deserialize)]
struct Case {
    text: String,
    r#match: Option<Expected>,
}
#[derive(serde::Deserialize, Debug, PartialEq)]
struct Expected {
    start: usize,
    end: usize,
    tag: String,
    content: String,
}
/// Unmodified upstream delimiter selector, supplementing the explicit literal cases.
#[test]
fn delimiter_selection_matches_upstream_fixed_corpus() -> Result<()> {
    let oracle: Oracle =
        serde_json::from_str(include_str!("../../../tests/fixtures/regex-v8.json"))
            .expect("oracle");
    let t = Transformers::new(crate::builtin::text_format_transformers());
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    for case in oracle.formats {
        let mut tx = editor.transaction();
        let node = tx.create_text(&case.text)?;
        let actual = find(&tx, node.key(), &t)?.map(|f| Expected {
            start: f.start,
            end: f.end,
            tag: f.m.get(1).unwrap_or("").into(),
            content: f.m.get(2).unwrap_or("").into(),
        });
        assert_eq!(actual, case.r#match, "{:?}", case.text);
    }
    Ok(())
}
