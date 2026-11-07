use super::*;
use crate::{builtin::*, matcher::*};
use serde_json::json;
use std::sync::Arc;

/// upstream: LexicalMarkdown.test.ts, empty lines, soft lines and preserve-newline options.
#[test]
fn paragraphs_merge_lines_and_preserve_hard_break_markers() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        "one  \ntwo\n\nthree",
        &Transformers::default(),
        None,
        &MarkdownOptions::default(),
    )?;
    tx.commit()?;
    assert_eq!(
        serde_json::to_value(editor.state().to_json()?).expect("JSON"),
        json!({"root":{"children":[{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"one","type":"text","version":1},{"type":"linebreak","version":1,"$":{"mdHardLineBreak":"  "}},{"detail":0,"format":0,"mode":"normal","style":"","text":"two","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""},{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"three","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""}],"direction":null,"format":"","indent":0,"type":"root","version":1}})
    );
    assert_eq!(
        convert_to_markdown_string(
            editor.state(),
            &Transformers::default(),
            None,
            &MarkdownOptions::default()
        )?,
        "one  \ntwo\n\nthree"
    );
    Ok(())
}
/// upstream: conversion preserves explicit empty paragraphs only when requested.
#[test]
fn preserve_newlines_keeps_empty_paragraphs_and_selection_moves_to_start() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    tx.select_start(NodeKey::ROOT)?;
    let opts = MarkdownOptions {
        should_preserve_new_lines: true,
        ..Default::default()
    };
    convert_from_markdown_string(
        &mut tx,
        "one\n\nthree",
        &Transformers::default(),
        None,
        &opts,
    )?;
    assert_eq!(tx.children_size(NodeKey::ROOT), 3);
    let text = tx.first_descendant(NodeKey::ROOT).expect("text");
    assert_eq!(
        tx.selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor,
        Point::text(text, Utf16Offset::ZERO)
    );
    assert_eq!(
        convert_to_markdown_string(&tx, &Transformers::default(), None, &opts)?,
        "one\n\nthree"
    );
    Ok(())
}
/// upstream: format import, intraword underscore and nested code precedence.
#[test]
fn inline_delimiters_keep_intraword_and_code_precedence() -> Result<()> {
    let transformers = Transformers::new(text_format_transformers());
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        "a_b_c a*b*c **bold `code` end** ~~gone~~ ==hi==",
        &transformers,
        None,
        &MarkdownOptions::default(),
    )?;
    tx.commit()?;
    let st = editor.state();
    let p = st.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(st.text_content(p), "a_b_c abc **bold code end** gone hi");
    assert_eq!(
        st.children(p)
            .map(|k| (
                st.text_content(k).into_owned(),
                st.text_data(k).expect("text").format.bits()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("a_b_c a".into(), 0),
            ("b".into(), 2),
            ("c **bold ".into(), 0),
            ("code".into(), 16),
            (" end** ".into(), 0),
            ("gone".into(), 4),
            (" ".into(), 0),
            ("hi".into(), 128)
        ]
    );
    Ok(())
}
/// upstream: bold/italic combined tags and CommonMark rule of three.
#[test]
fn combined_emphasis_and_escaped_delimiters() -> Result<()> {
    let transformers = Transformers::new(text_format_transformers());
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        r"***both*** \*plain\* **bold**",
        &transformers,
        None,
        &MarkdownOptions::default(),
    )?;
    tx.commit()?;
    let st = editor.state();
    let p = st.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(
        st.children(p)
            .map(|k| (
                st.text_content(k).into_owned(),
                st.text_data(k).expect("text").format.bits()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("both".into(), 3),
            (" *plain* ".into(), 0),
            ("bold".into(), 1)
        ]
    );
    Ok(())
}
/// upstream: tabs in any descendant become fresh unformatted TabNodes.
#[test]
fn normalize_tabs_discards_format_on_tabs_only() -> Result<()> {
    let transformers = Transformers::new(text_format_transformers());
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        "**😀\tbold**",
        &transformers,
        None,
        &MarkdownOptions::default(),
    )?;
    let p = tx.first_child_or_err(NodeKey::ROOT)?;
    let children = tx.children_keys(p)?;
    assert_eq!(children.len(), 3);
    assert!(tx.is::<Tab>(children[1]));
    assert_eq!(tx.text_data(children[1])?.format.bits(), 0);
    assert_eq!(tx.text_data(children[2])?.format.bits(), 1);
    Ok(())
}
/// upstream: custom block false retains truncated text, later matchers see original input.
#[derive(Debug)]
struct Decline;
impl ElementTransformer for Decline {
    fn dependencies(&self) -> &[&'static str] {
        &[]
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &*crate::patterns::HEADING
    }
    fn export(&self, _: &mut ExportCx<'_>, _: NodeKey) -> Result<Option<String>> {
        Ok(None)
    }
    fn replace(
        &self,
        _: &mut Transaction<'_>,
        _: &MarkdownOptions,
        _: NodeKey,
        _: &[NodeKey],
        _: &Match,
        _: bool,
    ) -> Result<ReplaceResult> {
        Ok(ReplaceResult::NotHandled)
    }
}
#[test]
fn declining_element_keeps_the_upstream_text_truncation() -> Result<()> {
    let t = Transformers::new([Transformer::Element(Arc::new(Decline))]);
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(&mut tx, "# text", &t, None, &MarkdownOptions::default())?;
    assert_eq!(tx.text_content(NodeKey::ROOT), "text");
    assert!(tx.is::<Paragraph>(tx.first_child_or_err(NodeKey::ROOT)?));
    Ok(())
}
/// upstream: default multiline search ignores match.index when slicing the first line.
#[derive(Debug)]
struct Multiline {
    start: RegexMatcher,
    end: RegexMatcher,
    required: bool,
}
impl MultilineElementTransformer for Multiline {
    fn dependencies(&self) -> &[&'static str] {
        &[]
    }
    fn reg_exp_start(&self) -> &dyn Matcher {
        &self.start
    }
    fn reg_exp_end(&self) -> RegExpEnd<'_> {
        if self.required {
            RegExpEnd::Required(&self.end)
        } else {
            RegExpEnd::Optional(&self.end)
        }
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        _: &MarkdownOptions,
        root: NodeKey,
        _: Option<&[NodeKey]>,
        _: &Match,
        _: Option<&Match>,
        lines: Option<Vec<String>>,
        _: bool,
    ) -> Result<ReplaceResult> {
        let p = tx.create(Paragraph {})?;
        let text = tx.create_text(&lines.unwrap_or_default().join("|"))?;
        tx.append(p, &[text.key()])?;
        tx.append(root, &[p.key()])?;
        Ok(ReplaceResult::Handled)
    }
}
#[test]
fn multiline_default_search_keeps_source_slice_quirk_and_optional_eof() -> Result<()> {
    let t = Transformers::new([Transformer::MultilineElement(Arc::new(Multiline {
        start: RegexMatcher::new("<<", "")?,
        end: RegexMatcher::new(">>", "")?,
        required: true,
    }))]);
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        "xx<<hello>>",
        &t,
        None,
        &MarkdownOptions::default(),
    )?;
    assert_eq!(tx.text_content(NodeKey::ROOT), "<<hello");
    let t = Transformers::new([Transformer::MultilineElement(Arc::new(Multiline {
        start: RegexMatcher::new("^<<", "")?,
        end: RegexMatcher::new(">>", "")?,
        required: false,
    }))]);
    convert_from_markdown_string(
        &mut tx,
        "<<first\nlast",
        &t,
        None,
        &MarkdownOptions::default(),
    )?;
    assert_eq!(tx.text_content(NodeKey::ROOT), "first|last");
    Ok(())
}
#[test]
fn invalid_list_indent_is_rejected_before_clearing_root() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("keep")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    assert!(
        convert_from_markdown_string(
            &mut tx,
            "replacement",
            &Transformers::default(),
            None,
            &MarkdownOptions {
                list_indent: 0,
                ..Default::default()
            }
        )
        .is_err()
    );
    assert_eq!(tx.text_content(NodeKey::ROOT), "keep");
    Ok(())
}

/// upstream: outer bold contains inline code when it is the outermost emphasis match.
#[test]
fn outer_emphasis_wraps_code_when_no_earlier_emphasis_wins() -> Result<()> {
    let transformers = Transformers::new(text_format_transformers());
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(
        &mut tx,
        "**bold `code` end**",
        &transformers,
        None,
        &MarkdownOptions::default(),
    )?;
    tx.commit()?;
    let st = editor.state();
    let p = st.first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(
        st.children(p)
            .map(|k| (
                st.text_content(k).into_owned(),
                st.text_data(k).expect("text").format.bits()
            ))
            .collect::<Vec<_>>(),
        vec![("bold ".into(), 1), ("code".into(), 17), (" end".into(), 1)]
    );
    Ok(())
}

#[derive(Debug)]
struct UnhandledHook;
impl MultilineElementTransformer for UnhandledHook {
    fn dependencies(&self) -> &[&'static str] {
        &[]
    }
    fn reg_exp_start(&self) -> &dyn Matcher {
        &*crate::patterns::HEADING
    }
    fn handle_import_after_start_match(
        &self,
        _: &mut Transaction<'_>,
        _: &MarkdownOptions,
        _: &[String],
        _: NodeKey,
        _: usize,
        _: &Match,
    ) -> Result<AfterStartMatch> {
        Ok(AfterStartMatch::Done {
            imported: false,
            last_line: usize::MAX,
        })
    }
    fn replace(
        &self,
        _: &mut Transaction<'_>,
        _: &MarkdownOptions,
        _: NodeKey,
        _: Option<&[NodeKey]>,
        _: &Match,
        _: Option<&Match>,
        _: Option<Vec<String>>,
        _: bool,
    ) -> Result<ReplaceResult> {
        Err(crate::Error::InvalidArgument(
            "declining hook must bypass replace",
        ))
    }
}
/// upstream: a false custom multiline result falls through and ignores its line index.
#[test]
fn unhandled_multiline_hook_ignores_last_line_and_imports_current_block() -> Result<()> {
    let t = Transformers::new([Transformer::MultilineElement(Arc::new(UnhandledHook))]);
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    convert_from_markdown_string(&mut tx, "# literal", &t, None, &MarkdownOptions::default())?;
    assert_eq!(tx.text_content(NodeKey::ROOT), "# literal");
    Ok(())
}
