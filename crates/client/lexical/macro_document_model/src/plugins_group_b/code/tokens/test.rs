//! Native fixture provider (deterministic word/space/punctuation splitter): exercises the transform
//! contract only; it is not the app's Prism tokenizer and proves no tokenizer parity.
use super::*;
use crate::{EditorType, surface};
use lexical_rich_nodes::code::{CodeHighlightNode, CodeNode};
use std::sync::Mutex;

#[derive(Default)]
struct Fixture {
    requests: Mutex<Vec<(String, String, String)>>,
    answer: Mutex<Option<Result<CodeTokenResult, CodeTokenError>>>,
}
impl CodeTokenProvider for Fixture {
    fn tokenize(&self, request: &CodeTokenRequest<'_>) -> Result<CodeTokenResult, CodeTokenError> {
        self.requests.lock().expect("requests").push((
            request.language.to_owned(),
            request.text.to_owned(),
            request.profile.to_owned(),
        ));
        if let Some(answer) = self.answer.lock().expect("answer").take() {
            return answer;
        }
        if request.language == "cobol" {
            return Ok(CodeTokenResult::NotLoaded);
        }
        let mut tokens = Vec::new();
        let mut word = String::new();
        let flush = |word: &mut String, tokens: &mut Vec<CodeToken>| {
            if !word.is_empty() {
                let kind = if matches!(word.as_str(), "let" | "const") {
                    "keyword"
                } else {
                    "word"
                };
                tokens.push(CodeToken::Text {
                    text: std::mem::take(word),
                    highlight_type: Some(kind.into()),
                });
            }
        };
        for ch in request.text.chars() {
            match ch {
                c if c.is_alphanumeric() => word.push(c),
                '\n' => {
                    flush(&mut word, &mut tokens);
                    tokens.push(CodeToken::LineBreak)
                }
                '\t' => {
                    flush(&mut word, &mut tokens);
                    tokens.push(CodeToken::Tab)
                }
                ' ' => {
                    flush(&mut word, &mut tokens);
                    tokens.push(CodeToken::Text {
                        text: " ".into(),
                        highlight_type: None,
                    })
                }
                c => {
                    flush(&mut word, &mut tokens);
                    tokens.push(CodeToken::Text {
                        text: c.to_string(),
                        highlight_type: Some("punctuation".into()),
                    })
                }
            }
        }
        flush(&mut word, &mut tokens);
        Ok(CodeTokenResult::Tokens(tokens))
    }
}

fn editor_with(fixture: &Arc<Fixture>, mode: EditorMode) -> Editor {
    editor_with_keys(fixture, mode, SharedKeyCounter::new())
}

fn editor_with_keys(fixture: &Arc<Fixture>, mode: EditorMode, keys: SharedKeyCounter) -> Editor {
    let provider: Arc<dyn CodeTokenProvider> = fixture.clone();
    surface::preset_builder_with_mode_and_tokens(
        EditorType::MarkdownSync,
        mode,
        CodeTokens::new(provider, "native-fixture"),
    )
    .key_source(KeySource::Shared(keys))
    .build()
    .expect("surface")
}

fn insert_code(editor: &mut Editor, language: &str, text: &str) -> Result<NodeKey, Error> {
    let (code, _) = editor.update(|tx| {
        let code = lexical_rich_nodes::code::create_code_node(tx, Some(language), None)
            .map_err(|_| Error::Invariant("create code node"))?;
        let text = tx.create_text(text)?;
        tx.append(code, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        Ok(code.key())
    })?;
    Ok(code)
}

fn tokens_of(editor: &Editor, code: NodeKey) -> Vec<(String, Option<String>, NodeKey)> {
    let view = editor.state().view();
    view.children(code)
        .map(|child| {
            let kind = view.type_name(child).unwrap_or("?").to_owned();
            let token = view
                .get::<CodeHighlightNode>(child)
                .and_then(|node| node.highlight_type.clone());
            (format!("{kind}:{}", view.text_content(child)), token, child)
        })
        .collect()
}

fn shape(tokens: &[(String, Option<String>, NodeKey)]) -> Vec<(String, Option<String>)> {
    tokens
        .iter()
        .map(|(text, kind, _)| (text.clone(), kind.clone()))
        .collect()
}

#[test]
fn a_local_edit_tokenizes_through_the_host_provider_with_its_profile() -> Result<(), Error> {
    let fixture = Arc::new(Fixture::default());
    let mut editor = editor_with(&fixture, EditorMode::ViewAttached);
    let code = insert_code(&mut editor, "rust", "let a = 1;")?;
    let some = |kind: &str| Some(kind.to_owned());
    assert_eq!(
        shape(&tokens_of(&editor, code)),
        vec![
            ("code-highlight:let".into(), some("keyword")),
            ("code-highlight: ".into(), None),
            ("code-highlight:a".into(), some("word")),
            ("code-highlight: ".into(), None),
            ("code-highlight:=".into(), some("punctuation")),
            ("code-highlight: ".into(), None),
            ("code-highlight:1".into(), some("word")),
            ("code-highlight:;".into(), some("punctuation")),
        ]
    );
    let requests = fixture.requests.lock().expect("requests").clone();
    assert!(requests.contains(&("rust".into(), "let a = 1;".into(), "native-fixture".into())));
    Ok(())
}

#[test]
fn line_breaks_and_tabs_become_native_nodes() -> Result<(), Error> {
    let fixture = Arc::new(Fixture::default());
    let mut editor = editor_with(&fixture, EditorMode::ViewAttached);
    let code = insert_code(&mut editor, "rust", "a\n\tb")?;
    let kinds: Vec<String> = tokens_of(&editor, code)
        .into_iter()
        .map(|(text, _, _)| text)
        .collect();
    assert_eq!(
        kinds,
        vec![
            "code-highlight:a",
            "linebreak:\n",
            "tab:\t",
            "code-highlight:b"
        ]
    );
    Ok(())
}

#[test]
fn an_unchanged_pass_keeps_every_token_and_a_middle_edit_keeps_prefix_and_suffix()
-> Result<(), Error> {
    let fixture = Arc::new(Fixture::default());
    let mut editor = editor_with(&fixture, EditorMode::ViewAttached);
    let code = insert_code(&mut editor, "rust", "let a = 1;")?;
    let before = tokens_of(&editor, code);
    editor.update(|tx| {
        tx.get_mut::<CodeNode>(code)?.set_language(Some("rust"));
        Ok(())
    })?;
    assert_eq!(tokens_of(&editor, code), before);
    let middle = before[2].2;
    editor.update(|tx| {
        tx.text(middle)?.set_text_content("b")?;
        Ok(())
    })?;
    let after = tokens_of(&editor, code);
    assert_eq!(after[2].0, "code-highlight:b");
    for index in [0, 1, 3, 4, 5, 6, 7] {
        assert_eq!(after[index].2, before[index].2, "token {index} kept");
    }
    Ok(())
}

#[test]
fn an_unloaded_grammar_keeps_the_existing_children() -> Result<(), Error> {
    let fixture = Arc::new(Fixture::default());
    let mut editor = editor_with(&fixture, EditorMode::ViewAttached);
    let code = insert_code(&mut editor, "cobol", "MOVE A TO B")?;
    assert_eq!(
        shape(&tokens_of(&editor, code)),
        vec![("text:MOVE A TO B".into(), None)]
    );
    Ok(())
}

#[test]
fn malformed_or_failed_provider_results_fail_before_creating_tokens() -> Result<(), Error> {
    for (answer, expected) in [
        (
            Ok(CodeTokenResult::Tokens(vec![CodeToken::Text {
                text: "different".into(),
                highlight_type: None,
            }])),
            CodeTokenError::Mismatch,
        ),
        (
            Ok(CodeTokenResult::Tokens(vec![CodeToken::Text {
                text: "a\nb".into(),
                highlight_type: None,
            }])),
            CodeTokenError::Mismatch,
        ),
        (
            Ok(CodeTokenResult::Tokens(vec![
                CodeToken::Text {
                    text: String::new(),
                    highlight_type: None,
                },
                CodeToken::Text {
                    text: "ab".into(),
                    highlight_type: None,
                },
            ])),
            CodeTokenError::Mismatch,
        ),
        (Err(CodeTokenError::Host), CodeTokenError::Host),
    ] {
        let fixture = Arc::new(Fixture::default());
        let keys = SharedKeyCounter::new();
        let mut editor = editor_with_keys(&fixture, EditorMode::ViewAttached, keys.clone());
        let before = keys.last_allocated().map_or(0, |key| key.index());
        *fixture.answer.lock().expect("answer") = Some(answer);
        let Err(Error::Extension(error)) = insert_code(&mut editor, "rust", "ab") else {
            panic!("expected an extension failure");
        };
        assert_eq!(error.downcast_ref::<CodeTokenError>(), Some(&expected));
        // Only the test's own code node and text node were allocated; no token node was built.
        let after = keys.last_allocated().map_or(0, |key| key.index());
        assert_eq!(after - before, 2);
        assert!(
            editor
                .state()
                .view()
                .children(NodeKey::ROOT)
                .all(|child| !editor.state().view().is::<CodeNode>(child))
        );
    }
    Ok(())
}

#[test]
fn detached_code_never_invokes_the_provider() -> Result<(), Error> {
    let fixture = Arc::new(Fixture::default());
    let mut editor = editor_with(&fixture, EditorMode::ViewAttached);
    editor.update(|tx| {
        let code = lexical_rich_nodes::code::create_code_node(tx, Some("rust"), None)
            .map_err(|_| Error::Invariant("create code node"))?;
        let text = tx.create_text("let a")?;
        tx.append(code, &[text.key()])?;
        Ok(())
    })?;
    assert!(fixture.requests.lock().expect("requests").is_empty());
    Ok(())
}

#[test]
fn the_caret_keeps_its_text_offset_across_retokenization() -> Result<(), Error> {
    let fixture = Arc::new(Fixture::default());
    let mut editor = editor_with(&fixture, EditorMode::ViewAttached);
    let (code, _) = editor.update(|tx| {
        let code = lexical_rich_nodes::code::create_code_node(tx, Some("rust"), None)
            .map_err(|_| Error::Invariant("create code node"))?;
        let text = tx.create_text("let a")?;
        tx.append(code, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[code.key()])?;
        tx.text(text)?
            .select(Some(Utf16Offset(5)), Some(Utf16Offset(5)))?;
        Ok(code.key())
    })?;
    let view = editor.state().view();
    let Some(Selection::Range(range)) = view.selection() else {
        panic!("range selection")
    };
    let last = view.children_keys(code)?.last().copied().expect("token");
    assert_eq!(range.anchor.key(), last);
    assert_eq!(range.anchor.offset(), 1);
    Ok(())
}

#[test]
fn no_provider_open_and_headless_never_tokenize() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let code = insert_code(&mut editor, "rust", "let a")?;
    assert_eq!(
        shape(&tokens_of(&editor, code)),
        vec![("text:let a".into(), None)]
    );

    let fixture = Arc::new(Fixture::default());
    let mut headless = editor_with(&fixture, EditorMode::Headless);
    insert_code(&mut headless, "rust", "let a")?;
    assert!(fixture.requests.lock().expect("requests").is_empty());

    let fixture = Arc::new(Fixture::default());
    let provider: Arc<dyn CodeTokenProvider> = fixture.clone();
    let state: SerializedEditorState = serde_json::from_value(serde_json::json!({"root": {
        "type": "root", "version": 1, "format": "", "indent": 0, "direction": null,
        "children": [{"type": "custom-code", "version": 1, "format": "", "indent": 0,
            "direction": null, "previewEnabled": false, "language": "rust",
            "children": [{"type": "text", "version": 1, "text": "let a", "format": 0,
                "detail": 0, "mode": "normal", "style": ""}]}]
    }}))?;
    surface::preset_builder_with_mode_and_tokens(
        EditorType::MarkdownSync,
        EditorMode::ViewAttached,
        CodeTokens::new(provider, "native-fixture"),
    )
    .initial_state(state)
    .build()
    .expect("surface");
    assert!(fixture.requests.lock().expect("requests").is_empty());
    Ok(())
}

#[test]
fn typing_inside_code_retokenizes_through_the_leaf_transform() -> Result<(), Error> {
    let fixture = Arc::new(Fixture::default());
    let mut editor = editor_with(&fixture, EditorMode::ViewAttached);
    let code = insert_code(&mut editor, "rust", "let a")?;
    let before = tokens_of(&editor, code);
    let last = before.last().map(|(_, _, key)| *key).expect("token");
    editor.update(|tx| {
        tx.text(last)?.set_text_content("ab")?;
        Ok(())
    })?;
    let after = tokens_of(&editor, code);
    let some = |kind: &str| Some(kind.to_owned());
    assert_eq!(
        shape(&after),
        vec![
            ("code-highlight:let".into(), some("keyword")),
            ("code-highlight: ".into(), None),
            ("code-highlight:ab".into(), some("word")),
        ]
    );
    // Source getDiffRange keeps the unchanged prefix.
    assert_eq!(after[0].2, before[0].2);
    assert_eq!(after[1].2, before[1].2);
    let requests = fixture.requests.lock().expect("requests").clone();
    assert!(requests.contains(&("rust".into(), "let ab".into(), "native-fixture".into())));
    Ok(())
}

fn orphan_highlight(editor: &mut Editor) -> Result<NodeKey, Error> {
    let (paragraph, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let highlight = tx.create(CodeHighlightNode {
            highlight_type: Some("keyword".into()),
        })?;
        tx.text(highlight)?.set_text_content("let")?;
        tx.append(paragraph, &[highlight.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(paragraph.key())
    })?;
    Ok(paragraph)
}

#[test]
fn an_orphan_code_highlight_becomes_plain_text_where_highlighting_is_installed()
-> Result<(), Error> {
    let fixture = Arc::new(Fixture::default());
    let mut editor = editor_with(&fixture, EditorMode::ViewAttached);
    let paragraph = orphan_highlight(&mut editor)?;
    assert_eq!(
        shape(&tokens_of(&editor, paragraph)),
        vec![("text:let".into(), None)]
    );
    assert!(fixture.requests.lock().expect("requests").is_empty());

    let mut headless = editor_with(&Arc::new(Fixture::default()), EditorMode::Headless);
    let paragraph = orphan_highlight(&mut headless)?;
    assert_eq!(
        shape(&tokens_of(&headless, paragraph)),
        vec![("code-highlight:let".into(), Some("keyword".into()))]
    );
    Ok(())
}

#[test]
fn an_orphan_code_highlight_resets_style_and_keeps_the_caret_like_the_source_factory()
-> Result<(), Error> {
    let fixture = Arc::new(Fixture::default());
    let mut editor = editor_with(&fixture, EditorMode::ViewAttached);
    let (paragraph, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph {})?;
        let highlight = tx.create(CodeHighlightNode {
            highlight_type: Some("keyword".into()),
        })?;
        tx.text(highlight)?
            .set_text_content("let")?
            .set_style("color: red")?;
        tx.append(paragraph, &[highlight.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.text(highlight)?
            .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
        Ok(paragraph.key())
    })?;
    let view = editor.state().view();
    let child = view.children_keys(paragraph)?[0];
    // Source `$createTextNode(node.__text)`: plain text, no copied style or format.
    assert_eq!(
        serde_json::to_value(view.export_json(child)?)?,
        serde_json::json!({"detail": 0, "format": 0, "mode": "normal", "style": "",
            "text": "let", "type": "text", "version": 1})
    );
    let Some(Selection::Range(range)) = view.selection() else {
        panic!("range selection")
    };
    assert_eq!((range.anchor.key(), range.anchor.offset()), (child, 2));
    Ok(())
}
