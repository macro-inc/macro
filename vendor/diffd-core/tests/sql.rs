use diffd_core::{highlight::highlight, lang::Lang, model::SyntaxClass, text::split_lines};

#[test]
fn sql_uses_the_shared_language_registry_and_highlighter() {
    assert_eq!(Lang::from_path("migrations/001_UP.SQL"), Some(Lang::Sql));
    assert_eq!(Lang::from_name("postgresql"), Some(Lang::Sql));
    let source = "SELECT '😀é', 42; -- comment\n/* first\nsecond */\nCREATE TABLE users (id BIGINT PRIMARY KEY);";
    let lines = split_lines(source);
    let runs = highlight(Lang::Sql, source, lines.len());
    let tokens: Vec<_> = runs
        .iter()
        .zip(&lines)
        .flat_map(|(runs, line)| {
            let utf16: Vec<_> = line.encode_utf16().collect();
            runs.chunks_exact(3).map(move |span| (String::from_utf16(&utf16[span[0] as usize..span[1] as usize]).unwrap(), span[2]))
        })
        .collect();
    assert!(tokens.contains(&("SELECT".into(), SyntaxClass::Keyword as u32)));
    assert!(tokens.iter().any(|(text, class)| text.contains("😀é") && *class == SyntaxClass::String as u32));
    assert!(tokens.contains(&("42".into(), SyntaxClass::Number as u32)));
    assert!(runs[1].chunks_exact(3).any(|span| span[2] == SyntaxClass::Comment as u32));
    assert!(runs[2].chunks_exact(3).any(|span| span[2] == SyntaxClass::Comment as u32));
}

#[test]
fn sql_fences_use_the_same_injection_pipeline_as_other_languages() {
    let source = "```sql\nSELECT 42;\n```";
    let runs = highlight(Lang::Markdown, source, 3);
    assert!(runs[1].chunks_exact(3).any(|span| span[2] == SyntaxClass::Keyword as u32));
}

#[test]
fn sql_obeys_the_shared_highlight_budget() {
    let source = " ".repeat(diffd_core::highlight::MAX_HIGHLIGHT_BYTES + 1);
    assert_eq!(highlight(Lang::Sql, &source, 1), vec![Vec::<u32>::new()]);
}
