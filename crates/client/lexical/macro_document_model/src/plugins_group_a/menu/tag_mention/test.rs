use super::*;
use crate::{EditorType, surface};
use serde_json::json;

fn editor_with_text(text: &str, anchor: u32, focus: u32) -> Result<Editor, Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let leaf = tx.create_text(text)?;
        tx.append(p, &[leaf.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(leaf)?;
        tx.set_text_node_range(leaf, Utf16Offset(anchor), leaf, Utf16Offset(focus))
    })?;
    Ok(editor)
}

fn insert(editor: &mut Editor, payload: serde_json::Value) -> Result<Handled, Error> {
    let generation = editor.state().max_key().generation();
    let command = surface::decode_command(
        "group-a.insert-tag-mention",
        &payload.to_string(),
        generation,
        None,
    )?
    .expect("insert");
    Ok(editor.dispatch(&command)?.0)
}

fn tag() -> serde_json::Value {
    json!({
        "optionId": "option-1",
        "propertyDefinitionId": "definition-1",
        "scope": "team",
        "name": "Roadmap",
    })
}

#[test]
fn collapsed_insert_places_the_tag_at_the_caret_without_an_undefined_color() -> Result<(), Error> {
    let mut editor = editor_with_text("ab", 1, 1)?;
    assert_eq!(insert(&mut editor, tag())?, Handled::Yes);
    let view = editor.state().view();
    let p = view.first_child(NodeKey::ROOT).expect("p");
    let mention = view
        .children_keys(p)?
        .into_iter()
        .find_map(|key| view.get::<TagMentionNode>(key))
        .expect("actual tag mention");
    assert_eq!(
        *mention,
        TagMentionNode {
            option_id: Maybe::Value("option-1".into()),
            property_definition_id: Maybe::Value("definition-1".into()),
            scope: Maybe::Value(TagScope::Team),
            name: Maybe::Value("Roadmap".into()),
            color: Maybe::Missing,
        }
    );
    assert_eq!(editor.state().root_text_content().as_ref(), "aRoadmapb");
    Ok(())
}

#[test]
fn expanded_insert_collapses_forwards_and_prepends_one_space() -> Result<(), Error> {
    for (anchor, focus) in [(0, 2), (2, 0)] {
        let mut editor = editor_with_text("abc", anchor, focus)?;
        let mut payload = tag();
        payload["color"] = json!("#ff0000");
        assert_eq!(insert(&mut editor, payload)?, Handled::Yes);
        assert_eq!(
            editor.state().root_text_content().as_ref(),
            "ab Roadmapc",
            "{anchor}->{focus}"
        );
        let view = editor.state().view();
        let p = view.first_child(NodeKey::ROOT).expect("p");
        let color = view
            .children_keys(p)?
            .into_iter()
            .find_map(|key| view.get::<TagMentionNode>(key))
            .map(|mention| mention.color.clone());
        assert_eq!(color, Some(Maybe::Value("#ff0000".into())));
    }
    Ok(())
}

#[test]
fn malformed_and_stale_requests_are_refused() -> Result<(), Error> {
    for payload in [
        json!({"optionId":"o","propertyDefinitionId":"d","scope":"org","name":"n"}),
        json!({"optionId":"o","propertyDefinitionId":"d","scope":"user"}),
        json!({"optionId":"o","propertyDefinitionId":"d","scope":"user","name":"n","extra":1}),
    ] {
        assert!(
            surface::decode_command("group-a.insert-tag-mention", &payload.to_string(), 0, None)
                .is_err()
        );
    }
    let mut editor = editor_with_text("ab", 1, 1)?;
    let stale = editor.state().max_key().generation().wrapping_add(1);
    let command = surface::decode_command(
        "group-a.insert-tag-mention",
        &tag().to_string(),
        stale,
        None,
    )?
    .expect("insert");
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    assert_eq!(editor.state().root_text_content().as_ref(), "ab");
    Ok(())
}
