use super::*;
use serde_json::json;
/// upstream: LexicalAutoLinkExtension.test.ts, creates automatic links around matching text.
#[test]
fn create_link_emits_transactional_event_and_serializes_literal_shape() -> Result<()> {
    let config = AutoLinkConfig {
        matchers: vec![Arc::new(crate::utils::linkify::LinkifyIt::default())],
        ..Default::default()
    };
    let mut editor = register_auto_link(
        super::super::transform::link_extension(Editor::builder(EditorMode::Headless)),
        config,
    )
    .build()
    .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("https://example.com")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let commit = tx.commit()?;
    assert_eq!(
        commit
            .events_of(&AUTO_LINK_CHANGED)
            .cloned()
            .collect::<Vec<_>>(),
        vec![AutoLinkChanged {
            url: Some("https://example.com".into()),
            prev_url: None
        }]
    );
    assert_eq!(
        serde_json::to_value(editor.state().to_json()?)?,
        json!({"root":{"children":[{"children":[{"children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"https://example.com","type":"text","version":1}],"direction":null,"format":"","indent":0,"type":"autolink","version":1,"rel":null,"target":null,"title":null,"url":"https://example.com","isUnlinked":false}],"direction":null,"format":"","indent":0,"type":"paragraph","version":1,"textFormat":0,"textStyle":""}],"direction":null,"format":"","indent":0,"type":"root","version":1}})
    );
    Ok(())
}

/// upstream: AutoLink matcher adapters use UTF-16 offsets over astral prefixes.
#[test]
fn regex_adapter_reports_utf16_and_resets_search_each_call() {
    let matcher = create_link_matcher_with_reg_exp(
        regress::Regex::new(r"https://example\.com").expect("regex"),
        Some(Arc::new(|text| format!("{text}/normalized"))),
    );
    let found = matcher.find("😀 https://example.com").expect("match");
    assert_eq!(found.index, Utf16Offset(3));
    assert_eq!(found.length, 19);
    assert_eq!(found.url, "https://example.com/normalized");
    assert_eq!(matcher.find("😀 https://example.com"), Some(found));
}
/// upstream: LexicalAutoLinkExtension.test.ts, matches across adjacent formatted text nodes.
#[test]
fn cross_node_match_copies_text_properties_and_preserves_first_text_selection() -> Result<()> {
    let config = AutoLinkConfig {
        matchers: vec![Arc::new(crate::utils::linkify::LinkifyIt::default())],
        ..Default::default()
    };
    let mut editor = register_auto_link(
        super::super::transform::link_extension(Editor::builder(EditorMode::Headless)),
        config,
    )
    .build()
    .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let a = tx.create_text("https://exa")?;
    let b = tx.create_text("mple.com")?;
    tx.text(a)?
        .set_format(TextFormat::BOLD)?
        .set_style("color: red")?;
    tx.text(b)?.set_format(TextFormat::ITALIC)?;
    tx.append(p, &[a.key(), b.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.text(a)?
        .select(Some(Utf16Offset(3)), Some(Utf16Offset(5)))?;
    let commit = tx.commit()?;
    let view = editor.state().view();
    let link = view.first_child_or_err(p)?;
    assert!(view.is::<AutoLinkNode>(link));
    assert_eq!(view.text_content(link), "https://example.com");
    let first = view.first_child_or_err(link)?;
    assert_ne!(first, a.key());
    assert_eq!(view.text_data(first)?.format, TextFormat::BOLD);
    assert_eq!(&*view.text_data(first)?.style, "color: red");
    assert_eq!(view.text_data(b)?.format, TextFormat::ITALIC);
    let range = editor
        .state()
        .selection()
        .and_then(Selection::as_range)
        .expect("range");
    assert_eq!(range.anchor, Point::text(first, Utf16Offset(3)));
    assert_eq!(range.focus, Point::text(first, Utf16Offset(5)));
    assert_eq!(commit.events_of(&AUTO_LINK_CHANGED).count(), 1);
    Ok(())
}
/// upstream: unchanged autolink URL does not mark the link writable or emit a change.
#[test]
fn unchanged_url_is_not_rewritten_and_invalid_edit_unwraps() -> Result<()> {
    let config = AutoLinkConfig {
        matchers: vec![Arc::new(crate::utils::linkify::LinkifyIt::default())],
        ..Default::default()
    };
    let mut editor = register_auto_link(
        super::super::transform::link_extension(Editor::builder(EditorMode::Headless)),
        config,
    )
    .build()
    .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("example.com")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.commit()?;
    let link = editor.state().first_child_or_err(p)?;
    let child = editor.state().first_child_or_err(link)?;
    let mut tx = editor.transaction();
    tx.mark_dirty(child)?;
    let commit = tx.commit()?;
    assert!(commit.events.is_empty());
    assert!(!commit.changes.mutations.contains_key(&link));
    let mut tx = editor.transaction();
    tx.text(child)?.set_text_content("broken")?;
    let commit = tx.commit()?;
    assert_eq!(editor.state().first_child(p), Some(child));
    assert_eq!(
        commit
            .events_of(&AUTO_LINK_CHANGED)
            .cloned()
            .collect::<Vec<_>>(),
        vec![AutoLinkChanged {
            url: None,
            prev_url: Some("http://example.com".into())
        }]
    );
    Ok(())
}
/// upstream: typing a nonseparator immediately after an automatic link invalidates it.
#[test]
fn bad_following_neighbor_unwraps_the_link() -> Result<()> {
    let config = AutoLinkConfig {
        matchers: vec![Arc::new(create_link_matcher_with_reg_exp(
            regress::Regex::new("example\\.com").expect("regex"),
            None,
        ))],
        ..Default::default()
    };
    let mut editor = register_auto_link(
        super::super::transform::link_extension(Editor::builder(EditorMode::Headless)),
        config,
    )
    .build()
    .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("example.com")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.commit()?;
    let mut tx = editor.transaction();
    let tail = tx.create_text("x")?;
    tx.append(p, &[tail.key()])?;
    let commit = tx.commit()?;
    assert!(
        editor
            .state()
            .children(p)
            .all(|k| !editor.state().is::<AutoLinkNode>(k))
    );
    assert_eq!(editor.state().text_content(p), "example.comx");
    assert!(
        commit
            .events_of(&AUTO_LINK_CHANGED)
            .any(|e| e.url.is_none())
    );
    Ok(())
}
/// upstream: excludeParents only checks the immediate parent and config is per editor.
#[test]
fn exclusion_and_transactional_matcher_updates_are_per_editor() -> Result<()> {
    fn paragraph(view: StateRef<'_>, key: NodeKey) -> bool {
        view.is::<Paragraph>(key)
    }
    let config = AutoLinkConfig {
        exclude_parents: vec![paragraph],
        matchers: vec![Arc::new(crate::utils::linkify::LinkifyIt::default())],
        ..Default::default()
    };
    let mut editor = register_auto_link(
        super::super::transform::link_extension(Editor::builder(EditorMode::Headless)),
        config,
    )
    .build()
    .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("example.com")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.commit()?;
    assert_eq!(editor.state().first_child(p), Some(text.key()));
    let mut tx = editor.transaction();
    tx.extension_mut::<AutoLinkConfig>()?
        .exclude_parents
        .clear();
    tx.mark_dirty(text)?;
    let commit = tx.commit()?;
    assert_eq!(commit.events_of(&AUTO_LINK_CHANGED).count(), 1);
    assert!(
        editor
            .state()
            .is::<AutoLinkNode>(editor.state().first_child_or_err(p)?)
    );
    Ok(())
}
/// upstream: null TOGGLE_LINK flips isUnlinked at Low and continues to ordinary Link handling.
#[test]
fn null_toggle_keeps_autolink_and_changes_unlinked_flag() -> Result<()> {
    let config = AutoLinkConfig {
        matchers: vec![Arc::new(crate::utils::linkify::LinkifyIt::default())],
        ..Default::default()
    };
    let mut editor = register_auto_link(
        super::super::transform::link_extension(Editor::builder(EditorMode::Headless)),
        config,
    )
    .build()
    .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("example.com")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    tx.commit()?;
    let link = editor.state().first_child_or_err(p)?;
    let text = editor.state().first_child_or_err(link)?;
    let mut tx = editor.transaction();
    tx.text(text)?
        .select(Some(Utf16Offset(0)), Some(Utf16Offset(11)))?;
    assert_eq!(
        tx.dispatch(&Command::Extension(ExtensionCommand::new(
            &super::super::TOGGLE_LINK,
            ToggleLinkPayload::Remove
        )))?,
        Handled::Yes
    );
    assert!(tx.get::<AutoLinkNode>(link).expect("auto").is_unlinked);
    assert_eq!(tx.parent(text), Some(link));
    Ok(())
}
/// upstream: config merge appends matchers/exclusions and overrides separator.
#[test]
fn config_merge_and_undefined_separator_semantics() {
    let base = AutoLinkConfig::default();
    let separator = regress::Regex::new("u").expect("regex");
    let next = AutoLinkConfig {
        matchers: vec![Arc::new(crate::utils::linkify::LinkifyIt::default())],
        separator_regex: separator,
        ..Default::default()
    };
    let merged = base.merge(next);
    assert_eq!(merged.matchers.len(), 1);
    assert!(is_separator(None, &merged.separator_regex));
    assert!(!is_separator(None, &base.separator_regex));
}

/// upstream: JavaScript regex without u matches one surrogate code unit.
#[test]
fn regex_adapter_selects_code_unit_or_unicode_decoder() {
    let legacy = create_link_matcher_with_reg_exp(regress::Regex::new(".").expect("regex"), None);
    let unicode = create_link_matcher_with_reg_exp(
        regress::Regex::with_flags(".", "u").expect("regex"),
        None,
    );
    let found = legacy.find("😀").expect("match");
    assert_eq!(
        (found.index, found.length, found.text),
        (Utf16Offset(0), 1, "�".into())
    );
    let found = unicode.find("😀").expect("match");
    assert_eq!(
        (found.index, found.length, found.text),
        (Utf16Offset(0), 2, "😀".into())
    );
    let unicode_sets = create_link_matcher_with_reg_exp(
        regress::Regex::with_flags(".", "v").expect("regex"),
        None,
    );
    let found = unicode_sets.find("😀").expect("match");
    assert_eq!(
        (found.index, found.length, found.text),
        (Utf16Offset(0), 2, "😀".into())
    );
}

/// upstream: the null autolink listener ignores NodeSelection.
#[test]
fn node_selection_null_toggle_is_a_noop() -> Result<()> {
    let mut editor = super::super::transform::link_extension(Editor::builder(EditorMode::Headless))
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let link = create_auto_link_node(&mut tx, "http://example.com", AutoLinkAttributes::default())?;
    let text = tx.create_text("example.com")?;
    tx.append(link, &[text.key()])?;
    tx.append(p, &[link.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let mut selection = NodeSelection::new();
    selection.add(text);
    tx.set_selection(Some(Selection::Node(selection)))?;
    toggle_auto_link_unlinked(&mut tx)?;
    assert!(!tx.get::<AutoLinkNode>(link).expect("auto").is_unlinked);
    assert_eq!(tx.parent(text), Some(link.key()));
    Ok(())
}

/// upstream: edits emit attribute changes in rel, target order.
#[test]
fn attribute_only_edit_emits_rel_then_target() -> Result<()> {
    struct Attributes;
    impl LinkMatcher for Attributes {
        fn find(&self, text: &str) -> Option<LinkMatcherResult> {
            (text == "example.com").then(|| LinkMatcherResult {
                index: Utf16Offset(0),
                length: 11,
                text: text.into(),
                url: "http://example.com".into(),
                attributes: Some(AutoLinkAttributes {
                    link: LinkAttributes {
                        rel: Some("noopener".into()),
                        target: Some("_blank".into()),
                        title: None,
                    },
                    is_unlinked: None,
                }),
            })
        }
    }
    let cfg = AutoLinkConfig {
        matchers: vec![Arc::new(Attributes)],
        ..Default::default()
    };
    let mut editor = super::super::transform::link_extension(Editor::builder(EditorMode::Headless))
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let link = create_auto_link_node(&mut tx, "http://example.com", AutoLinkAttributes::default())?;
    let text = tx.create_text("example.com")?;
    tx.append(link, &[text.key()])?;
    tx.append(p, &[link.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    edit::handle_link_edit(&mut tx, link.key(), &cfg)?;
    let commit = tx.commit()?;
    assert_eq!(
        commit
            .events_of(&AUTO_LINK_CHANGED)
            .cloned()
            .collect::<Vec<_>>(),
        vec![
            AutoLinkChanged {
                url: Some("noopener".into()),
                prev_url: None
            },
            AutoLinkChanged {
                url: Some("_blank".into()),
                prev_url: None
            }
        ]
    );
    Ok(())
}

/// upstream: invalid boundary matches do not hide later valid matches.
#[test]
fn creation_advances_past_invalid_and_multiple_valid_matches() -> Result<()> {
    let config = AutoLinkConfig {
        matchers: vec![Arc::new(create_link_matcher_with_reg_exp(
            regress::Regex::new(r"example\.com").expect("regex"),
            None,
        ))],
        ..Default::default()
    };
    let mut editor = register_auto_link(
        super::super::transform::link_extension(Editor::builder(EditorMode::Headless)),
        config,
    )
    .build()
    .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let text = tx.create_text("xexample.com example.com, example.com")?;
    tx.append(p, &[text.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let commit = tx.commit()?;
    let view = editor.state().view();
    assert_eq!(
        view.children(p)
            .map(|key| (
                view.is::<AutoLinkNode>(key),
                view.text_content(key).into_owned()
            ))
            .collect::<Vec<_>>(),
        vec![
            (false, "xexample.com ".into()),
            (true, "example.com".into()),
            (false, ", ".into()),
            (true, "example.com".into())
        ]
    );
    assert_eq!(commit.events_of(&AUTO_LINK_CHANGED).count(), 2);
    Ok(())
}

/// upstream: extending a TLD updates the previous link and validates the next link.
#[test]
fn tld_continuation_then_invalid_next_neighbor() -> Result<()> {
    let cfg = AutoLinkConfig {
        matchers: vec![Arc::new(crate::utils::linkify::LinkifyIt::default())],
        ..Default::default()
    };
    let mut editor = super::super::transform::link_extension(Editor::builder(EditorMode::Headless))
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph {})?;
    let first =
        create_auto_link_node(&mut tx, "http://example.com", AutoLinkAttributes::default())?;
    let a = tx.create_text("example.com")?;
    tx.append(first, &[a.key()])?;
    let middle = tx.create_text(".org")?;
    let second =
        create_auto_link_node(&mut tx, "http://example.net", AutoLinkAttributes::default())?;
    let b = tx.create_text("example.net")?;
    tx.append(second, &[b.key()])?;
    tx.append(p, &[first.key(), middle.key(), second.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    edit::handle_bad_neighbors(&mut tx, middle.key(), &cfg)?;
    assert!(!tx.is_attached(first));
    assert_eq!(tx.text_content(p), "example.com.orgexample.net");
    assert!(!tx.is_attached(second));
    assert_eq!(tx.parent(b), Some(p.key()));
    let commit = tx.commit()?;
    assert_eq!(
        commit
            .events_of(&AUTO_LINK_CHANGED)
            .cloned()
            .collect::<Vec<_>>(),
        vec![
            AutoLinkChanged {
                url: None,
                prev_url: Some("http://example.com".into())
            },
            AutoLinkChanged {
                url: None,
                prev_url: Some("http://example.com".into())
            },
            AutoLinkChanged {
                url: None,
                prev_url: Some("http://example.net".into())
            }
        ]
    );
    Ok(())
}
