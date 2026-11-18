use super::*;
use crate::builtin::*;
use lexical_rich_nodes::{
    code::register_code_nodes,
    heading::HeadingNode,
    link::LinkNode,
    list::{ListType, node::ListNode, register::register_list_nodes},
};
use std::sync::Arc;

// SCOPE §3.3 #2: each insertion used to schedule a no-op listener update.
#[test]
fn thousand_keystrokes_drop_noop_followups_without_cascade_failure() -> Result<()> {
    let mut editor = register_code_nodes(register_list_nodes(
        Editor::builder(EditorMode::Headless)
            .node::<HeadingNode>()
            .node::<lexical_rich_nodes::quote::QuoteNode>()
            .node::<LinkNode>(),
    ))
    .build()
    .expect("editor");
    let t = Transformers::new(transformers());
    t.check_dependencies(&editor)?;
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(p)?;
    let mut previous_id = tx.commit()?.id;
    for _ in 0..1000 {
        let mut tx = editor.transaction();
        tx.insert_text("a")?;
        let commit = tx.commit()?;
        assert_eq!(commit.id.0, previous_id.0 + 1);
        assert!(commit.following.is_empty());
        assert!(commit.follow_up_error.is_none());
        let trigger = ShortcutTrigger::from_commit(&commit, false);
        assert!(markdown_shortcut_anchor(editor.state(), &trigger, &t).is_some());
        let mut follow = editor.transaction();
        assert!(!markdown_shortcuts(
            &mut follow,
            &trigger,
            &t,
            &MarkdownOptions::default()
        )?);
        drop(follow);
        previous_id = commit.id;
    }
    assert_eq!(editor.state().text_content(NodeKey::ROOT), "a".repeat(1000));
    let Some(Selection::Range(selection)) = editor.state().selection() else {
        panic!("range");
    };
    assert_eq!(selection.anchor.offset(), 1000);
    assert!(selection.is_collapsed());
    Ok(())
}

#[test]
fn typed_closing_delimiter_formats_content_and_restores_typing_format() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let t = Transformers::new(text_format_transformers());
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("**bold*")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(text)?;
    tx.toggle_selection_format(TextFormatType::Italic)?;
    tx.commit()?;
    let mut tx = editor.transaction();
    // Keep the existing text node so the closing tag spans sibling formats.
    tx.text(text)?.set_text_content("**bold**")?;
    tx.text(text)?
        .select(Some(Utf16Offset(8)), Some(Utf16Offset(8)))?;
    let commit = tx.commit()?;
    let mut follow = editor.transaction();
    assert!(markdown_shortcuts(
        &mut follow,
        &ShortcutTrigger::from_commit(&commit, false),
        &t,
        &MarkdownOptions::default()
    )?);
    assert_eq!(follow.selection_replacements(), 1);
    follow.add_tag(UpdateTag::HistoryPush);
    let formatted = follow.commit()?;
    assert!(formatted.tags.contains(&UpdateTag::HistoryPush));
    assert_eq!(editor.state().text_content(NodeKey::ROOT), "bold");
    let child = editor.state().first_child_or_err(p)?;
    assert!(
        editor
            .state()
            .text_data(child)?
            .format
            .contains(TextFormat::BOLD)
    );
    let Some(Selection::Range(selection)) = editor.state().selection() else {
        panic!("range");
    };
    assert!(selection.is_collapsed());
    assert_eq!(selection.anchor.offset(), 4);
    assert_eq!(selection.format, TextFormat::ITALIC);
    Ok(())
}

#[test]
fn enter_creates_language_code_block_and_shift_enter_is_declined() -> Result<()> {
    let mut editor = register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let t = Transformers::new(multiline_element_transformers());
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("```javascript")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(text)?;
    assert!(!markdown_shortcuts_on_enter(
        &mut tx,
        true,
        &t,
        &MarkdownOptions::default()
    )?);
    assert!(tx.is_attached(p));
    assert!(markdown_shortcuts_on_enter(
        &mut tx,
        false,
        &t,
        &MarkdownOptions::default()
    )?);
    tx.commit()?;
    let code = editor.state().first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(
        editor
            .state()
            .get::<CodeNode>(code)
            .expect("code")
            .language(),
        Some("javascript")
    );
    assert_eq!(editor.state().text_content(code), "");
    Ok(())
}

#[test]
fn element_trigger_on_space_uses_pending_remainder_and_history_boundary() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HeadingNode>()
        .build()
        .expect("editor");
    let t = Transformers::new([Transformer::Element(Arc::new(Heading))]);
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("#tail")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.insert_text(" ")?;
    let commit = tx.commit()?;
    let mut follow = editor.transaction();
    assert!(markdown_shortcuts(
        &mut follow,
        &ShortcutTrigger::from_commit(&commit, false),
        &t,
        &MarkdownOptions::default()
    )?);
    follow.commit()?;
    let heading = editor.state().first_child_or_err(NodeKey::ROOT)?;
    assert!(editor.state().is::<HeadingNode>(heading));
    assert_eq!(editor.state().text_content(heading), "tail");
    Ok(())
}

#[test]
fn enter_uses_opt_in_heading_and_list_elements() -> Result<()> {
    let mut editor =
        register_list_nodes(Editor::builder(EditorMode::Headless).node::<HeadingNode>())
            .build()
            .expect("editor");
    let t = Transformers::new(element_transformers());
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("# ")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(text)?;
    assert!(markdown_shortcuts_on_enter(
        &mut tx,
        false,
        &t,
        &MarkdownOptions::default()
    )?);
    let heading = tx.first_child_or_err(NodeKey::ROOT)?;
    assert!(tx.is::<HeadingNode>(heading));
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("- ")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(text)?;
    assert!(markdown_shortcuts_on_enter(
        &mut tx,
        false,
        &t,
        &MarkdownOptions::default()
    )?);
    tx.commit()?;
    let list = editor.state().last_child_or_err(NodeKey::ROOT)?;
    assert_eq!(
        editor
            .state()
            .get::<ListNode>(list)
            .expect("list")
            .list_type(),
        ListType::Bullet
    );
    Ok(())
}

#[test]
fn composition_end_bypasses_unchanged_selection_and_multichar_jump() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let t = Transformers::new(text_format_transformers());
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("`hello`")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(text)?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.mark_dirty(text.key())?;
    tx.add_tag(UpdateTag::CompositionEnd);
    let commit = tx.commit()?;
    assert_eq!(commit.prev.selection(), commit.next.selection());
    let mut follow = editor.transaction();
    assert!(markdown_shortcuts(
        &mut follow,
        &ShortcutTrigger::from_commit(&commit, false),
        &t,
        &MarkdownOptions::default()
    )?);
    follow.commit()?;
    assert_eq!(editor.state().text_content(NodeKey::ROOT), "hello");
    assert!(
        editor
            .state()
            .text_data(text)?
            .format
            .contains(TextFormat::CODE)
    );
    // A whole composed chunk can move by more than one unit at composition-end.
    let mut tx = editor.transaction();
    tx.text(text)?.set_format(TextFormat::empty())?;
    tx.text(text)?.set_text_content("`hello")?;
    tx.select_end(text)?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.text(text)?.set_text_content("`helloa`")?;
    tx.select_end(text)?;
    tx.add_tag(UpdateTag::CompositionEnd);
    let commit = tx.commit()?;
    let mut follow = editor.transaction();
    assert!(markdown_shortcuts(
        &mut follow,
        &ShortcutTrigger::from_commit(&commit, false),
        &t,
        &MarkdownOptions::default()
    )?);
    follow.commit()?;
    assert_eq!(editor.state().text_content(NodeKey::ROOT), "helloa");
    Ok(())
}

#[test]
fn anchor_filters_tags_composition_dirty_state_and_nontrigger_ime_chunks() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let t = Transformers::new(text_format_transformers());
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(p)?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.insert_text("x")?;
    let commit = tx.commit()?;
    assert!(
        markdown_shortcut_anchor(
            editor.state(),
            &ShortcutTrigger::from_commit(&commit, false),
            &t
        )
        .is_some()
    );
    assert!(
        markdown_shortcut_anchor(
            editor.state(),
            &ShortcutTrigger::from_commit(&commit, true),
            &t
        )
        .is_none()
    );
    for tag in [
        UpdateTag::Collaboration,
        UpdateTag::Historic,
        UpdateTag::CompositionEnd,
    ] {
        let tags = TagSet::from_tags([tag]);
        let trigger = ShortcutTrigger {
            tags: &tags,
            ..ShortcutTrigger::from_commit(&commit, false)
        };
        assert!(markdown_shortcut_anchor(editor.state(), &trigger, &t).is_none());
    }
    let dirty_leaves = DirtyLeaves::default();
    assert!(
        markdown_shortcut_anchor(
            editor.state(),
            &ShortcutTrigger {
                dirty_leaves: &dirty_leaves,
                ..ShortcutTrigger::from_commit(&commit, false)
            },
            &t
        )
        .is_none()
    );
    Ok(())
}

#[test]
fn closing_link_trigger_moves_selection_outside_replaced_text() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .build()
        .expect("editor");
    let t = Transformers::new(text_match_transformers());
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("[link](https://example.com")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(text)?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.insert_text(")")?;
    let commit = tx.commit()?;
    let mut follow = editor.transaction();
    assert!(markdown_shortcuts(
        &mut follow,
        &ShortcutTrigger::from_commit(&commit, false),
        &t,
        &MarkdownOptions::default()
    )?);
    follow.commit()?;
    let link = editor.state().first_child_or_err(p)?;
    assert_eq!(
        editor.state().get::<LinkNode>(link).expect("link").url,
        "https://example.com"
    );
    let Some(Selection::Range(selection)) = editor.state().selection() else {
        panic!("range");
    };
    assert_eq!(selection.anchor, Point::element(p, ChildIndex(1)));
    assert!(selection.is_collapsed());
    Ok(())
}

#[test]
fn inline_format_walk_skips_code_siblings_but_stops_at_linebreak() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let t = Transformers::new(text_format_transformers());
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let open = tx.create_text("**left")?;
    tx.text(open)?.set_format(TextFormat::ITALIC)?;
    let code = tx.create_text("code")?;
    tx.text(code)?.set_format(TextFormat::CODE)?;
    let close = tx.create_text("right*")?;
    tx.append(p, &[open.key(), code.key(), close.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(close)?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.insert_text("*")?;
    let commit = tx.commit()?;
    let mut follow = editor.transaction();
    assert!(markdown_shortcuts(
        &mut follow,
        &ShortcutTrigger::from_commit(&commit, false),
        &t,
        &MarkdownOptions::default()
    )?);
    follow.commit()?;
    assert_eq!(editor.state().text_content(p), "leftcoderight");
    assert!(
        editor
            .state()
            .text_data(open)?
            .format
            .contains(TextFormat::BOLD | TextFormat::ITALIC)
    );
    assert!(
        editor
            .state()
            .text_data(close)?
            .format
            .contains(TextFormat::BOLD)
    );
    assert!(
        editor
            .state()
            .text_data(code)?
            .format
            .contains(TextFormat::CODE)
    );

    let mut tx = editor.transaction();
    let p2 = tx.create(Paragraph::default())?;
    let open2 = tx.create_text("**left")?;
    let br = tx.create(LineBreak::default())?;
    let close2 = tx.create_text("right*")?;
    tx.append(p2, &[open2.key(), br.key(), close2.key()])?;
    tx.append(NodeKey::ROOT, &[p2.key()])?;
    tx.select_end(close2)?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.insert_text("*")?;
    let commit = tx.commit()?;
    let mut follow = editor.transaction();
    assert!(!markdown_shortcuts(
        &mut follow,
        &ShortcutTrigger::from_commit(&commit, false),
        &t,
        &MarkdownOptions::default()
    )?);
    drop(follow);
    assert_eq!(editor.state().text_content(p2), "**left\nright**");
    Ok(())
}

#[test]
fn intraword_underscores_spaces_and_unclosed_code_suppress_formats() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let t = Transformers::new(text_format_transformers());
    for initial in ["a_b", "* space", "*x ", "`**code*"] {
        let mut tx = editor.transaction();
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text(initial)?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(text)?;
        tx.commit()?;
        let mut tx = editor.transaction();
        tx.insert_text(if initial == "a_b" { "_" } else { "*" })?;
        let commit = tx.commit()?;
        let mut follow = editor.transaction();
        assert!(
            !markdown_shortcuts(
                &mut follow,
                &ShortcutTrigger::from_commit(&commit, false),
                &t,
                &MarkdownOptions::default()
            )?,
            "{initial}"
        );
        drop(follow);
    }
    Ok(())
}

#[derive(Debug)]
struct DeclineHeading;
impl ElementTransformer for DeclineHeading {
    fn export(&self, _: &mut ExportCx<'_>, _: NodeKey) -> Result<Option<String>> {
        Ok(None)
    }
    fn dependencies(&self) -> &[&'static str] {
        &[]
    }
    fn reg_exp(&self) -> &dyn crate::matcher::Matcher {
        Heading.reg_exp()
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
fn declining_callback_preserves_committed_node_and_falls_through_in_order() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HeadingNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("#tail")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.insert_text(" ")?;
    let commit = tx.commit()?;
    let t = Transformers::new([Transformer::Element(Arc::new(DeclineHeading))]);
    let mut follow = editor.transaction();
    assert!(!markdown_shortcuts(
        &mut follow,
        &ShortcutTrigger::from_commit(&commit, false),
        &t,
        &MarkdownOptions::default()
    )?);
    drop(follow);
    assert!(editor.state().is_attached(text));
    assert_eq!(editor.state().children_size(p), 1);
    assert_eq!(editor.state().text_content(p), "# tail");
    let t = Transformers::new([
        Transformer::Element(Arc::new(DeclineHeading)),
        Transformer::Element(Arc::new(Heading)),
    ]);
    let mut follow = editor.transaction();
    assert!(markdown_shortcuts(
        &mut follow,
        &ShortcutTrigger::from_commit(&commit, false),
        &t,
        &MarkdownOptions::default()
    )?);
    follow.commit()?;
    let heading = editor.state().first_child_or_err(NodeKey::ROOT)?;
    assert!(editor.state().is::<HeadingNode>(heading));
    assert_eq!(editor.state().text_content(heading), "tail");
    Ok(())
}

#[derive(Debug)]
struct RequiredCode;
impl MultilineElementTransformer for RequiredCode {
    fn dependencies(&self) -> &[&'static str] {
        &[]
    }
    fn reg_exp_start(&self) -> &dyn crate::matcher::Matcher {
        Code.reg_exp_start()
    }
    fn reg_exp_end(&self) -> RegExpEnd<'_> {
        RegExpEnd::Required(Code.reg_exp_start())
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
        panic!("required terminator cannot trigger a shortcut")
    }
}
#[test]
fn required_multiline_terminator_and_code_parents_are_skipped() -> Result<()> {
    let mut editor = register_code_nodes(Editor::builder(EditorMode::Headless))
        .build()
        .expect("editor");
    let t = Transformers::new([Transformer::MultilineElement(Arc::new(RequiredCode))]);
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("```")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(text)?;
    assert!(!markdown_shortcuts_on_enter(
        &mut tx,
        false,
        &t,
        &MarkdownOptions::default()
    )?);
    let code = lexical_rich_nodes::code::create_code_node(&mut tx, None, None)?;
    let code_text = tx.create_text("**x*")?;
    tx.append(code, &[code_text.key()])?;
    tx.append(NodeKey::ROOT, &[code.key()])?;
    tx.select_end(code_text)?;
    tx.commit()?;
    let mut tx = editor.transaction();
    tx.insert_text("*")?;
    let commit = tx.commit()?;
    let mut follow = editor.transaction();
    assert!(!markdown_shortcuts(
        &mut follow,
        &ShortcutTrigger::from_commit(&commit, false),
        &Transformers::new(text_format_transformers()),
        &MarkdownOptions::default()
    )?);
    drop(follow);
    assert_eq!(editor.state().text_content(code), "**x**");
    Ok(())
}
