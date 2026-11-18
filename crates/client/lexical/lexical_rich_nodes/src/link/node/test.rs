use super::*;
use serde_json::json;
/// upstream: LexicalLinkNode.test.ts, constructor/serialization and inline insertion boundaries.
#[test]
fn link_payload_literal_json_and_import_normalization() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let link = create_link_node(&mut tx, "/", LinkAttributes::default())?;
    assert_eq!(
        serde_json::Value::Object(tx.export_json(link)?),
        json!({"children":[],"direction":null,"format":"","indent":0,"type":"link","version":1,"rel":null,"target":null,"title":null,"url":"/"})
    );
    assert!(is_link_node(&tx, link.key()));
    assert!(!is_auto_link_node(&tx, link.key()));
    assert!(tx.is_inline(link));
    assert!(!tx.can_be_empty(link));
    assert!(!tx.can_insert_text_before(link));
    assert!(!tx.can_insert_text_after(link));
    tx.update_from_json(link,json!({"type":"link","version":1,"url":"https://example.com","rel":"","target":"","title":""}).as_object().expect("object"))?;
    let payload = tx.get::<LinkNode>(link).expect("link");
    assert_eq!(payload.rel, None);
    assert_eq!(payload.title, None);
    assert!(is_web_site_uri(payload));
    assert!(!is_email_uri(payload));
    Ok(())
}
/// upstream: LexicalLinkNode/AutoLinkNode, inherited hooks and insertNewAfter attribute copying.
#[test]
fn autolink_inherits_link_hooks_and_new_sibling_payload() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let auto = create_auto_link_node(
        &mut tx,
        "mailto:user@example.com",
        AutoLinkAttributes {
            link: LinkAttributes {
                rel: Some("nofollow".into()),
                target: Some("_blank".into()),
                title: Some("title".into()),
            },
            is_unlinked: Some(true),
        },
    )?;
    let text = tx.create_text("user@example.com")?;
    tx.append(auto, &[text.key()])?;
    tx.append(p, &[auto.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.select_end(text)?;
    let copy = tx
        .insert_new_after(auto, SelectionSlot::Active, true)?
        .expect("copy");
    assert!(is_link_node(&tx, auto.key()));
    assert!(is_auto_link_node(&tx, copy));
    assert!(is_email_uri(tx.get::<LinkNode>(auto).expect("base")));
    assert_eq!(tx.get::<AutoLinkNode>(copy), tx.get::<AutoLinkNode>(auto));
    assert!(!should_merge_adjacent_link(
        &tx,
        link_id(&tx, auto.key())?,
        link_id(&tx, copy)?
    ));
    assert!(!tx.can_insert_text_before(copy));
    Ok(())
}

/// upstream: LexicalLinkNode.test.ts, formatUrl scheme.
#[test]
fn format_url_scheme() {
    assert_eq!(format_url("HTTPS://example.com"), "HTTPS://example.com");
}

/// upstream: LexicalLinkNode.test.ts, formatUrl relative.
#[test]
fn format_url_relative() {
    assert_eq!(format_url("../path"), "../path");
}

/// upstream: LexicalLinkNode.test.ts, formatUrl fragment.
#[test]
fn format_url_fragment() {
    assert_eq!(format_url("#section"), "#section");
}

/// upstream: LexicalLinkNode.test.ts, formatUrl email.
#[test]
fn format_url_email() {
    assert_eq!(format_url("user@example.com"), "mailto:user@example.com");
}

/// upstream: LexicalLinkNode.test.ts, formatUrl phone.
#[test]
fn format_url_phone() {
    assert_eq!(format_url("+12345"), "tel:+12345");
}

/// upstream: LexicalLinkNode.test.ts, formatUrl default.
#[test]
fn format_url_default() {
    assert_eq!(format_url("example.com"), "https://example.com");
}

/// upstream: LexicalLinkNode sanitizeUrl allowlist, consumed by HTML export.
#[test]
fn sanitize_url_rejects_unsupported_protocols_and_retains_relative_paths() {
    assert_eq!(sanitize_url("javascript:alert(1)"), "about:blank");
    assert_eq!(sanitize_url("data:text/plain,hello"), "about:blank");
    assert_eq!(sanitize_url("sms:12345"), "sms:12345");
    assert_eq!(sanitize_url("/path"), "/path");
    assert_eq!(sanitize_url("example.com"), "https://example.com");
}

#[test]
fn line_break_before_link_selects_its_first_text() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .build()
        .expect("editor");
    let ((paragraph, text), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let link = create_link_node(tx, "/", LinkAttributes::default())?;
        let text = tx.create_text("link")?;
        tx.append(link, &[text.key()])?;
        tx.append(paragraph, &[link.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_start(paragraph)?;
        Ok((paragraph, text))
    })?;
    editor.update(|tx| tx.insert_line_break(false))?;
    let state = editor.state();
    assert!(state.is_line_break(state.children_keys(paragraph)?[0]));
    let range = state
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.anchor, Point::text(text, Utf16Offset(0)));
    assert_eq!(range.focus, range.anchor);
    Ok(())
}

#[test]
fn replacing_the_first_protected_tab_rejects_a_detached_selection_cycle() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .build()
        .expect("editor");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let link = create_link_node(tx, "/", LinkAttributes::default())?;
        let tab = tx.create(Tab {})?;
        tx.append(link, &[tab.key()])?;
        tx.append(paragraph, &[link.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(tab, Utf16Offset(0)),
            Point::text(tab, Utf16Offset(1)),
        ))))
    })?;
    let previous = editor.state().to_json()?;
    assert!(editor.update(|tx| tx.insert_text("x")).is_err());
    assert_eq!(editor.state().to_json()?, previous);
    Ok(())
}

#[test]
fn replacing_a_protected_tab_after_text_can_advance_the_receiver() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .build()
        .expect("editor");
    editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let link = create_link_node(tx, "/", LinkAttributes::default())?;
        let text = tx.create_text("a")?;
        let tab = tx.create(Tab {})?;
        tx.append(link, &[text.key(), tab.key()])?;
        tx.append(paragraph, &[link.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::new(
            Point::text(tab, Utf16Offset(0)),
            Point::text(tab, Utf16Offset(1)),
        ))))
    })?;
    editor.update(|tx| tx.insert_text("x"))?;
    assert_eq!(editor.state().root_text_content().as_ref(), "ax");
    Ok(())
}

#[test]
fn deleting_a_whole_segment_removes_its_empty_link_parent() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .build()
        .expect("editor");
    let ((segment, tail), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let link = create_link_node(tx, "/", LinkAttributes::default())?;
        let segment = tx.create_text("segment")?;
        tx.text(segment)?.set_mode(TextMode::Segmented)?;
        let tail = tx.create_text("tail")?;
        tx.append(link, &[segment.key()])?;
        tx.append(paragraph, &[link.key(), tail.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        tx.select_end(segment)?;
        Ok((segment, tail))
    })?;
    editor.update(|tx| {
        tx.delete_character(
            EditDirection::Backward,
            ModifyTarget::View {
                anchor: Point::text(segment, Utf16Offset(6)),
                focus: Point::text(segment, Utf16Offset(7)),
                resolution_dirty: false,
                is_backward_in_dom: true,
            },
        )
    })?;
    assert_eq!(editor.state().root_text_content().as_ref(), "tail");
    let paragraph = editor.state().first_child_or_err(NodeKey::ROOT)?;
    assert_eq!(editor.state().children_keys(paragraph)?, vec![tail.key()]);
    assert_eq!(
        editor
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor,
        Point::text(tail, Utf16Offset(0))
    );
    Ok(())
}
