use super::*;
#[test]
fn export_json_matches_upstream_hashtag_node_schema() -> crate::Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<HashtagNode>()
        .build()
        .unwrap();
    let mut tx = editor.transaction();
    let node = create_hashtag_node(&mut tx, "therickestrickofall")?;
    assert!(is_hashtag_node(&tx, node.key()));
    assert!(!tx.can_insert_text_before(node));
    assert!(tx.is_text_entity(node));
    assert_eq!(tx.export_json(node)?, serde_json::json!({
        "detail":0,"format":0,"mode":"normal","style":"","text":"therickestrickofall","type":"hashtag","version":1
    }).as_object().unwrap().clone());
    Ok(())
}
#[test]
fn matcher_preserves_utf16_boundaries_and_legacy_character_classes() {
    assert_eq!(
        get_hashtag_match("hello #world"),
        Some(EntityMatch {
            start: Utf16Offset(6),
            end: Utf16Offset(12)
        })
    );
    assert_eq!(
        get_hashtag_match("😀#café"),
        Some(EntityMatch {
            start: Utf16Offset(2),
            end: Utf16Offset(7)
        })
    );
    assert_eq!(
        get_hashtag_match("＃日本語"),
        Some(EntityMatch {
            start: Utf16Offset(0),
            end: Utf16Offset(4)
        })
    );
    assert_eq!(get_hashtag_match("#123"), None);
    assert_eq!(
        get_hashtag_match("#123_a"),
        Some(EntityMatch {
            start: Utf16Offset(0),
            end: Utf16Offset(6)
        })
    );
    assert_eq!(get_hashtag_match("&#one"), None);
    assert_eq!(get_hashtag_match("/#one"), None);
    assert_eq!(get_hashtag_match("x#one"), None);
    assert_eq!(
        get_hashtag_match("#K"),
        Some(EntityMatch {
            start: Utf16Offset(0),
            end: Utf16Offset(2)
        })
    );
    assert_eq!(
        get_hashtag_match("#ſ"),
        Some(EntityMatch {
            start: Utf16Offset(0),
            end: Utf16Offset(2)
        })
    );
    assert_eq!(
        get_hashtag_match("#꜀"),
        Some(EntityMatch {
            start: Utf16Offset(0),
            end: Utf16Offset(2)
        })
    );
    assert_eq!(
        get_hashtag_match("#"),
        Some(EntityMatch {
            start: Utf16Offset(0),
            end: Utf16Offset(2)
        })
    );
    assert_eq!(get_hashtag_match("#𪜀"), None);
}
#[test]
fn registered_transforms_split_plain_text_into_hashtag_entities() -> crate::Result<()> {
    let mut editor = register_hashtag(Editor::builder(EditorMode::Headless))
        .build()
        .unwrap();
    let (p, _) = editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let t = tx.create_text("hello #world and ＃日本語")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(p)
    })?;
    let state = editor.state();
    let children = state.children_keys(p)?;
    assert_eq!(children.len(), 4);
    assert_eq!(state.type_name(children[1])?, "hashtag");
    assert_eq!(state.text_content(children[1]), "#world");
    assert_eq!(state.type_name(children[3])?, "hashtag");
    assert_eq!(state.text_content(children[3]), "＃日本語");
    Ok(())
}
