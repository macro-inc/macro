use crate::{EditorType, nodes::*, plugins_group_b::decode_command, surface};
use lexical_model::*;

#[test]
fn resize_still_consumes_and_tags_the_update_when_its_target_is_missing_or_the_wrong_class()
-> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (image, _) = editor.update(|tx| {
        let image = create_image_node(tx, CreateMedia::default(), None)?;
        tx.append(NodeKey::ROOT, &[image.key()])?;
        Ok(image)
    })?;
    let before = editor.state().to_json()?;
    for payload in [
        serde_json::json!({"key":image.key().index(),"kind":"video","width":640,"height":480}),
        serde_json::json!({"key":u32::MAX,"kind":"image","width":640,"height":480}),
    ] {
        let command = decode_command(
            "group-b.media-resize",
            &payload.to_string(),
            image.key().generation(),
            None,
        )?
        .expect("resize");
        let (handled, commit) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::Yes);
        assert!(commit.tags.contains(&UpdateTag::Historic));
        assert_eq!(editor.state().to_json()?, before);
    }
    Ok(())
}

#[test]
fn natural_size_updates_both_dimensions_without_remounting_the_component() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((image, video), _) = editor.update(|tx| {
        let image = create_image_node(tx, CreateMedia::default(), None)?;
        let video = create_video_node(tx, CreateMedia::default(), None)?;
        tx.append(NodeKey::ROOT, &[image.key(), video.key()])?;
        Ok((image, video))
    })?;
    for (key, kind) in [(image.key(), "image"), (video.key(), "video")] {
        let command = decode_command(
            "group-b.media-resize",
            &serde_json::json!({"key":key.index(),"kind":kind,"width":640,"height":480})
                .to_string(),
            key.generation(),
            None,
        )?
        .expect("resize");
        let (handled, commit) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::Yes);
        assert!(commit.tags.contains(&UpdateTag::Historic));
    }
    let image = editor.state().get::<ImageNode>(image).expect("image");
    let video = editor.state().get::<VideoNode>(video).expect("video");
    for media in [&image.media, &video.media] {
        assert_eq!(media.width, Maybe::Value(JsNumber(640.0)));
        assert_eq!(media.height, Maybe::Value(JsNumber(480.0)));
    }
    assert_eq!(image.render_revision, 0);
    assert_eq!(video.render_revision, 0);
    Ok(())
}

#[test]
fn mount_notifications_prioritize_actual_uploading_and_preserve_stored_identity()
-> Result<(), Error> {
    use super::{MediaMountAction, media_mount_action};

    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((image, video), _) = editor.update(|tx| {
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "sfs".into(),
                id: Some("stored-image".into()),
                ..Default::default()
            },
            None,
        )?;
        let video = create_video_node(
            tx,
            CreateMedia {
                src_type: "sfs".into(),
                ..Default::default()
            },
            None,
        )?;
        tx.get_mut::<VideoNode>(video)?.media.id = Maybe::Null;
        tx.append(NodeKey::ROOT, &[image.key(), video.key()])?;
        Ok((image, video))
    })?;
    let before = editor.state().export_json(NodeKey::ROOT)?;
    // Source checks the IO set before looking up a node, including a missing key.
    let missing = NodeKey::from_parts(KeyParts {
        index: u32::MAX,
        generation: image.key().generation(),
    });
    assert_eq!(
        media_mount_action(editor.state(), missing, true),
        MediaMountAction::UploadStarted
    );
    assert_eq!(
        media_mount_action(editor.state(), missing, false),
        MediaMountAction::None
    );
    assert_eq!(
        media_mount_action(editor.state(), image.key(), true),
        MediaMountAction::UploadStarted
    );
    assert_eq!(
        media_mount_action(editor.state(), image.key(), false),
        MediaMountAction::UploadSucceeded {
            id: Maybe::Value("stored-image".into())
        }
    );
    assert_eq!(
        media_mount_action(editor.state(), video.key(), false),
        MediaMountAction::UploadSucceeded { id: Maybe::Null }
    );
    assert_eq!(editor.state().export_json(NodeKey::ROOT)?, before);
    editor.update(|tx| {
        tx.get_mut::<ImageNode>(image)?.media.src_type = Maybe::Value("local".into());
        Ok(())
    })?;
    assert_eq!(
        media_mount_action(editor.state(), image.key(), false),
        MediaMountAction::None
    );
    Ok(())
}

#[test]
fn source_url_upgrade_uses_only_the_requested_class_and_preserves_component_lifetime()
-> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let ((image, video), _) = editor.update(|tx| {
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "url".into(),
                id: Some("changed-image-id".into()),
                ..Default::default()
            },
            None,
        )?;
        let video = create_video_node(
            tx,
            CreateMedia {
                src_type: "sfs".into(),
                id: Some("changed-video-id".into()),
                ..Default::default()
            },
            None,
        )?;
        tx.append(NodeKey::ROOT, &[image.key(), video.key()])?;
        Ok((image, video))
    })?;
    for (key, kind) in [(image.key(), "image"), (video.key(), "video")] {
        let command = decode_command(
            "group-b.media-upgrade-url",
            &serde_json::json!({"key":key.index(),"kind":kind,"url":"fresh-url"}).to_string(),
            key.generation(),
            None,
        )?
        .expect("upgrade");
        let (handled, commit) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::Yes);
        assert!(commit.tags.contains(&UpdateTag::Historic));
    }
    let image = editor.state().get::<ImageNode>(image).expect("image");
    let video = editor.state().get::<VideoNode>(video).expect("video");
    assert_eq!(image.media.url, Maybe::Value("fresh-url".into()));
    assert_eq!(video.media.url, Maybe::Value("fresh-url".into()));
    assert_eq!(image.render_revision, 0);
    assert_eq!(video.render_revision, 0);
    Ok(())
}

#[test]
fn property_command_defaults_to_actual_invalidation_even_when_the_value_is_equal()
-> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (image, _) = editor.update(|tx| {
        let image = create_image_node(tx, CreateMedia::default(), None)?;
        tx.append(NodeKey::ROOT, &[image.key()])?;
        Ok(image)
    })?;
    for (payload, revision) in [
        (
            serde_json::json!({"key":image.key().index(),"kind":"image","property":"scale","value":1}),
            1,
        ),
        (
            serde_json::json!({"key":image.key().index(),"kind":"image","property":"width","value":512,"rerender":false}),
            1,
        ),
    ] {
        let command = decode_command(
            "group-b.media-set-property",
            &payload.to_string(),
            image.key().generation(),
            None,
        )?
        .expect("property");
        assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
        assert_eq!(
            editor
                .state()
                .get::<ImageNode>(image)
                .expect("image")
                .render_revision,
            revision
        );
    }
    assert_eq!(
        editor
            .state()
            .get::<ImageNode>(image)
            .expect("image")
            .media
            .width,
        Maybe::Value(JsNumber(512.0))
    );
    Ok(())
}

#[test]
fn wrong_class_or_stale_generation_does_not_update_another_media_node() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (image, _) = editor.update(|tx| {
        let image = create_image_node(tx, CreateMedia::default(), None)?;
        tx.append(NodeKey::ROOT, &[image.key()])?;
        Ok(image)
    })?;
    let before = editor.state().export_json(image)?;
    for (kind, generation) in [
        ("video", image.key().generation()),
        ("image", image.key().generation() + 1),
    ] {
        let command = decode_command(
            "group-b.media-upgrade-url",
            &serde_json::json!({"key":image.key().index(),"kind":kind,"url":"wrong-url"})
                .to_string(),
            generation,
            None,
        )?
        .expect("upgrade");
        assert_eq!(editor.dispatch(&command)?.0, Handled::No);
        assert_eq!(editor.state().export_json(image)?, before);
    }
    Ok(())
}
