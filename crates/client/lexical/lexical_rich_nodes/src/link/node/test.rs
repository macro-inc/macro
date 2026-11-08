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
