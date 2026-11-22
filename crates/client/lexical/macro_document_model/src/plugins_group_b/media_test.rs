use super::*;
use crate::nodes::{
    CreateMedia, ImageNode, JsNumber, Maybe, VideoNode, create_image_node, create_video_node,
};
use crate::{EditorType, surface};
use lexical_rich_nodes::list::{ListItemNode, ListNode, ListType};
use serde_json::json;

#[test]
fn image_insertion_stays_in_its_list_item_without_splitting_the_list() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (item, _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Check, 1))?;
        let item = tx.create(ListItemNode::default())?;
        let text = tx.create_text("caption")?;
        tx.append(item, &[text.key()])?;
        tx.append(list, &[item.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        tx.select_end(text)?;
        Ok(item.key())
    })?;
    let command = decode_command("group-b.media", &json!({"action":"insert","kind":"image","media":{"srcType":"url","url":"https://example.com/image.png"},"alt":"caption"}).to_string(), item.generation(), None)?.expect("insert");
    editor.dispatch(&command)?;
    let state = editor.state().view();
    assert_eq!(state.children_size(NodeKey::ROOT), 1);
    let image = state.last_child(item).expect("image");
    assert!(state.is::<ImageNode>(image));
    assert_eq!(state.get::<ImageNode>(image).expect("image").alt, "caption");
    assert_eq!(state.parent(image), Some(item));
    Ok(())
}

#[test]
fn replacement_media_preserves_dimensions_and_node_selection() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (old, _) = editor.update(|tx| {
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "url".into(),
                url: Some("https://example.com/old.png".into()),
                width: Some(640.0),
                height: Some(480.0),
                ..CreateMedia::default()
            },
            None,
        )?;
        tx.append(NodeKey::ROOT, &[image.key()])?;
        let mut selection = NodeSelection::new();
        selection.add(image);
        tx.set_selection(Some(Selection::Node(selection)))?;
        Ok(image.key())
    })?;
    let command = decode_command("group-b.media", &json!({"action":"insert","kind":"image","media":{"srcType":"url","url":"https://example.com/new.png"}}).to_string(), old.generation(), None)?.expect("insert");
    editor.dispatch(&command)?;
    let state = editor.state().view();
    let first = state.first_child(NodeKey::ROOT).expect("image");
    assert_ne!(first, old);
    let image = state.get::<ImageNode>(first).expect("replacement");
    assert_eq!(image.media.width, Maybe::Value(JsNumber(640.0)));
    assert_eq!(image.media.height, Maybe::Value(JsNumber(480.0)));
    let Some(Selection::Node(selection)) = editor.state().selection() else {
        panic!("node selection");
    };
    assert!(selection.has(first));
    assert!(!state.is_attached(old));
    Ok(())
}

#[test]
fn upload_completion_updates_matching_local_copies_and_keeps_unrelated_media() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((images, video), _) = editor.update(|tx| {
        let a = create_image_node(
            tx,
            CreateMedia {
                src_type: "local".into(),
                url: Some("blob:fixture".into()),
                ..CreateMedia::default()
            },
            None,
        )?;
        let b = create_image_node(
            tx,
            CreateMedia {
                src_type: "local".into(),
                url: Some("blob:fixture".into()),
                ..CreateMedia::default()
            },
            None,
        )?;
        let c = create_image_node(
            tx,
            CreateMedia {
                src_type: "local".into(),
                url: Some("blob:other".into()),
                ..CreateMedia::default()
            },
            None,
        )?;
        let other_id = create_image_node(
            tx,
            CreateMedia {
                src_type: "local".into(),
                id: Some("different-id".into()),
                url: Some("blob:fixture".into()),
                ..CreateMedia::default()
            },
            None,
        )?;
        let video = create_video_node(
            tx,
            CreateMedia {
                src_type: "local".into(),
                url: Some("blob:fixture".into()),
                ..CreateMedia::default()
            },
            None,
        )?;
        tx.append(
            NodeKey::ROOT,
            &[a.key(), b.key(), c.key(), other_id.key(), video.key()],
        )?;
        Ok(([a, b, c, other_id], video))
    })?;
    let payload = json!({
        "action": "complete", "kind": "image", "source_id": "", "local_url": "blob:fixture",
        "id": "stored-file", "url": "https://example.com/stored"
    });
    let generation = images[0].key().generation();
    let before = editor.state().to_json()?;
    let stale = decode_command("group-b.media", &payload.to_string(), generation + 1, None)?
        .expect("stale completion");
    let (handled, commit) = editor.dispatch(&stale)?;
    assert_eq!(handled, Handled::No);
    assert!(!commit.tags.contains(&UpdateTag::Historic));
    assert_eq!(editor.state().to_json()?, before);

    let command =
        decode_command("group-b.media", &payload.to_string(), generation, None)?.expect("complete");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::Yes);
    assert!(commit.tags.contains(&UpdateTag::Historic));
    let (handled, repeated) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::No);
    assert!(!repeated.tags.contains(&UpdateTag::Historic));
    let state = editor.state().view();
    for image in &images[..2] {
        let node = state.get::<ImageNode>(*image).expect("image");
        assert_eq!(node.media.src_type.as_deref(), Some("sfs"));
        assert_eq!(node.media.id.as_deref(), Some("stored-file"));
        assert_eq!(
            node.media.url.as_deref(),
            Some("https://example.com/stored")
        );
        assert_eq!(node.render_revision, 0);
    }
    for image in &images[2..] {
        let node = state.get::<ImageNode>(*image).expect("unrelated image");
        assert_eq!(node.media.src_type.as_deref(), Some("local"));
        assert_eq!(node.render_revision, 0);
    }
    let node = state.get::<VideoNode>(video).expect("unrelated video");
    assert_eq!(node.media.src_type.as_deref(), Some("local"));
    assert_eq!(node.render_revision, 0);
    Ok(())
}

#[test]
fn enter_keeps_trailing_images_with_the_original_list_item() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((item, image, list), _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let item = tx.create(ListItemNode::default())?;
        let text = tx.create_text("caption")?;
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "url".into(),
                url: Some("https://example.com/image.png".into()),
                ..CreateMedia::default()
            },
            None,
        )?;
        tx.append(item, &[text.key(), image.key()])?;
        tx.append(list, &[item.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        tx.select_end(text)?;
        Ok((item.key(), image.key(), list.key()))
    })?;
    assert_eq!(editor.dispatch(&Command::InsertParagraph)?.0, Handled::Yes);
    let state = editor.state().view();
    assert_eq!(state.parent(image), Some(item));
    assert_eq!(state.children_size(list), 2);
    let next = state.last_child(list).expect("next item");
    assert_ne!(item, next);
    assert_eq!(state.text_content(next), "");
    Ok(())
}

#[test]
fn video_insertion_splits_following_list_items_at_the_root() -> Result<(), Error> {
    use crate::nodes::VideoNode;
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (first, _) = editor.update(|tx| {
        let list = tx.create(ListNode::new(ListType::Bullet, 1))?;
        let first = tx.create(ListItemNode::default())?;
        let second = tx.create(ListItemNode::default())?;
        let a = tx.create_text("before")?;
        let b = tx.create_text("after")?;
        tx.append(first, &[a.key()])?;
        tx.append(second, &[b.key()])?;
        tx.append(list, &[first.key(), second.key()])?;
        tx.append(NodeKey::ROOT, &[list.key()])?;
        tx.select_end(a)?;
        Ok(first.key())
    })?;
    let command = decode_command("group-b.media", &json!({"action":"insert","kind":"video","media":{"srcType":"url","url":"https://example.com/video.webm"}}).to_string(), first.generation(), None)?.expect("insert");
    editor.dispatch(&command)?;
    let state = editor.state().view();
    let blocks = state.children_keys(NodeKey::ROOT)?;
    assert_eq!(blocks.len(), 3);
    assert!(state.is::<ListNode>(blocks[0]));
    assert!(state.is::<VideoNode>(blocks[1]));
    assert!(state.is::<ListNode>(blocks[2]));
    assert_eq!(state.text_content(blocks[0]), "before");
    assert_eq!(state.text_content(blocks[2]), "after");
    Ok(())
}

#[test]
fn stale_document_media_resolution_cannot_overwrite_a_changed_source() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (image, _) = editor.update(|tx| {
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "dss".into(),
                id: Some("new-source".into()),
                ..CreateMedia::default()
            },
            None,
        )?;
        tx.append(NodeKey::ROOT, &[image.key()])?;
        Ok(image.key())
    })?;
    let command = decode_command("group-b.media", &json!({"action":"url","key":image.index(),"source_id":"old-source","expected_url":"","url":"blob:old-source"}).to_string(), image.generation(), None)?.expect("url");
    let before = editor.state().to_json()?;
    assert_eq!(editor.dispatch(&command)?.0, Handled::No);
    assert_eq!(editor.state().to_json()?, before);
    Ok(())
}

#[test]
fn upload_completion_refuses_a_replaced_local_source_at_the_same_key() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (image, _) = editor.update(|tx| {
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "local".into(),
                url: Some("blob:pending-image".into()),
                ..CreateMedia::default()
            },
            None,
        )?;
        tx.append(NodeKey::ROOT, &[image.key()])?;
        Ok(image)
    })?;
    let payload = json!({
        "action": "complete", "kind": "image", "source_id": "",
        "local_url": "blob:pending-image", "id": "stored-file", "url": "https://example.com/stored",
    });
    editor.update(|tx| {
        tx.get_mut::<ImageNode>(image.key())?.media.id = Maybe::Value("replaced-id".into());
        Ok(())
    })?;
    let before = editor.state().to_json()?;
    let command = decode_command(
        "group-b.media",
        &payload.to_string(),
        image.key().generation(),
        None,
    )?
    .expect("upload completion");
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(editor.state().to_json()?, before);
    assert_eq!(handled, Handled::No);
    assert!(!commit.tags.contains(&UpdateTag::Historic));
    editor.update(|tx| {
        tx.remove(image.key(), false)?;
        Ok(())
    })?;
    let after_removal = editor.state().to_json()?;
    let (handled, commit) = editor.dispatch(&command)?;
    assert_eq!(handled, Handled::No);
    assert!(!commit.tags.contains(&UpdateTag::Historic));
    assert_eq!(editor.state().to_json()?, after_removal);
    Ok(())
}
