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
                src_type: "dss".into(),
                id: Some("image-id".into()),
                ..Default::default()
            },
            None,
        )?;
        let video = create_video_node(
            tx,
            CreateMedia {
                src_type: "dss".into(),
                id: Some("video-id".into()),
                ..Default::default()
            },
            None,
        )?;
        tx.append(NodeKey::ROOT, &[image.key(), video.key()])?;
        Ok((image, video))
    })?;
    for (key, kind, source_id) in [
        (image.key(), "image", "image-id"),
        (video.key(), "video", "video-id"),
    ] {
        let command = decode_command(
            "group-b.media-upgrade-url",
            &serde_json::json!({"key":key.index(),"kind":kind,"source_id":source_id,"expected_url":"","url":"fresh-url"}).to_string(),
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
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "dss".into(),
                id: Some("fixture-source".into()),
                ..Default::default()
            },
            None,
        )?;
        tx.append(NodeKey::ROOT, &[image.key()])?;
        Ok(image)
    })?;
    let before = editor.state().export_json(image)?;
    for (kind, index, generation) in [
        ("video", image.key().index(), image.key().generation()),
        ("image", image.key().index(), image.key().generation() + 1),
        ("image", u32::MAX, image.key().generation()),
    ] {
        let command = decode_command(
            "group-b.media-upgrade-url",
            &serde_json::json!({"key":index,"kind":kind,"source_id":"fixture-source","expected_url":"","url":"wrong-url"})
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

#[test]
fn queued_dss_upgrade_refuses_a_replaced_source_at_the_same_key() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (image, _) = editor.update(|tx| {
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "dss".into(),
                id: Some("document-id".into()),
                url: Some("blob:original".into()),
                ..Default::default()
            },
            None,
        )?;
        tx.append(NodeKey::ROOT, &[image.key()])?;
        Ok(image)
    })?;
    let key = image.key();
    let queued = [
        (
            "group-b.media-upgrade-url",
            serde_json::json!({
                "key": key.index(), "kind": "image", "source_id": "document-id",
                "expected_url": "blob:original", "url": "blob:late"
            }),
        ),
        (
            "group-b.media",
            serde_json::json!({
                "action": "url", "key": key.index(), "source_id": "document-id",
                "expected_url": "blob:original", "url": "blob:late"
            }),
        ),
    ];
    editor.update(|tx| {
        tx.get_mut::<ImageNode>(key)?
            .set_media_property(MediaProperty::Url("blob:replacement".into()), false)?;
        Ok(())
    })?;
    let before = editor.state().to_json()?;
    for (name, payload) in queued {
        let command = decode_command(name, &payload.to_string(), key.generation(), None)?
            .expect("queued upgrade");
        let (handled, commit) = editor.dispatch(&command)?;
        assert_eq!(
            commit.tags.contains(&UpdateTag::Historic),
            name == "group-b.media-upgrade-url"
        );
        assert_eq!(
            editor.state().to_json()?,
            before,
            "{name} accepted a stale URL"
        );
        assert_eq!(handled, Handled::No, "{name}");
    }
    Ok(())
}

#[test]
fn dss_upgrade_requires_the_captured_identity_fields() {
    for (name, command) in [
        (
            "group-b.media-upgrade-url",
            serde_json::json!({"key":1,"kind":"image","url":"blob:result"}),
        ),
        (
            "group-b.media",
            serde_json::json!({"action":"url","key":1,"url":"blob:result"}),
        ),
    ] {
        // The source id is required; an omitted expected url is the captured
        // url of a node stored without one.
        let mut without_source = command.clone();
        without_source["expected_url"] = "blob:old".into();
        assert!(decode_command(name, &without_source.to_string(), 1, None).is_err());
        let mut without_url = command.clone();
        without_url["source_id"] = "source".into();
        assert!(decode_command(name, &without_url.to_string(), 1, None).is_ok());
    }
}

#[test]
fn dss_upgrade_replaces_a_stored_null_or_missing_url_only_when_captured_as_stored()
-> Result<(), Error> {
    // Source $upgradeDSSMediaUrl sets the resolved url over any stored url; the
    // native guard compares the captured url with the stored one, keeping
    // null, omitted and text apart.
    let stored = [
        ("null", Maybe::Null),
        ("missing", Maybe::Missing),
        ("text", Maybe::Value("blob:old".to_owned())),
    ];
    for (stored_name, stored_url) in &stored {
        for (captured_name, captured_url) in &stored {
            let mut editor = surface::preset_builder_with_mode(
                EditorType::MarkdownSync,
                EditorMode::ViewAttached,
            )
            .build()
            .expect("surface");
            let (video, _) = editor.update(|tx| {
                let video = create_video_node(
                    tx,
                    CreateMedia {
                        src_type: "dss".into(),
                        id: Some("video-id".into()),
                        ..Default::default()
                    },
                    None,
                )?;
                tx.append(NodeKey::ROOT, &[video.key()])?;
                tx.get_mut::<VideoNode>(video.key())?.media.url = stored_url.clone();
                Ok(video)
            })?;
            let key = video.key();
            let mut payload = serde_json::json!({
                "key": key.index(), "kind": "video", "source_id": "video-id", "url": "blob:fresh"
            });
            match captured_url {
                Maybe::Missing => {}
                Maybe::Null => payload["expected_url"] = serde_json::Value::Null,
                Maybe::Value(url) => payload["expected_url"] = url.as_str().into(),
            }
            let command = decode_command(
                "group-b.media-upgrade-url",
                &payload.to_string(),
                key.generation(),
                None,
            )?
            .expect("upgrade");
            let (handled, _) = editor.dispatch(&command)?;
            let video = editor.state().get::<VideoNode>(key).expect("video");
            if stored_name == captured_name {
                assert_eq!(handled, Handled::Yes, "{stored_name} captured as stored");
                assert_eq!(video.media.url, Maybe::Value("blob:fresh".into()));
            } else {
                assert_eq!(
                    handled,
                    Handled::No,
                    "{stored_name} captured as {captured_name}"
                );
                assert_eq!(&video.media.url, stored_url);
            }
        }
    }
    Ok(())
}

#[test]
fn dss_upgrade_checks_source_type_and_id_and_commits_fresh_results() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    let (image, _) = editor.update(|tx| {
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "dss".into(),
                id: Some("current-source".into()),
                url: Some("blob:current".into()),
                ..Default::default()
            },
            None,
        )?;
        tx.append(NodeKey::ROOT, &[image.key()])?;
        Ok(image)
    })?;
    let key = image.key();
    let before = editor.state().to_json()?;
    for (source_id, src_type) in [("older-source", "dss"), ("current-source", "url")] {
        editor.update(|tx| {
            tx.get_mut::<ImageNode>(key)?
                .set_media_property(MediaProperty::SrcType(src_type.into()), false)?;
            Ok(())
        })?;
        let current = editor.state().to_json()?;
        for (name, payload) in [
            (
                "group-b.media-upgrade-url",
                serde_json::json!({
                    "key":key.index(), "kind":"image", "source_id":source_id,
                    "expected_url":"blob:current", "url":"blob:late"
                }),
            ),
            (
                "group-b.media",
                serde_json::json!({
                    "action":"url", "key":key.index(), "source_id":source_id,
                    "expected_url":"blob:current", "url":"blob:late"
                }),
            ),
        ] {
            let command = decode_command(name, &payload.to_string(), key.generation(), None)?
                .expect("stale source upgrade");
            assert_eq!(editor.dispatch(&command)?.0, Handled::No);
            assert_eq!(editor.state().to_json()?, current);
        }
    }

    editor.update(|tx| {
        tx.get_mut::<ImageNode>(key)?
            .set_media_property(MediaProperty::SrcType("dss".into()), false)?;
        Ok(())
    })?;
    assert_eq!(editor.state().to_json()?, before);
    for (name, payload, next) in [
        (
            "group-b.media-upgrade-url",
            serde_json::json!({
                "key":key.index(), "kind":"image", "source_id":"current-source",
                "expected_url":"blob:current", "url":"blob:typed"
            }),
            "blob:typed",
        ),
        (
            "group-b.media",
            serde_json::json!({
                "action":"url", "key":key.index(), "source_id":"current-source",
                "expected_url":"blob:typed", "url":"blob:legacy"
            }),
            "blob:legacy",
        ),
    ] {
        let command = decode_command(name, &payload.to_string(), key.generation(), None)?
            .expect("fresh source upgrade");
        let (handled, commit) = editor.dispatch(&command)?;
        assert_eq!(handled, Handled::Yes);
        assert!(commit.tags.contains(&UpdateTag::Historic));
        let actual = editor.state().get::<ImageNode>(key).expect("image");
        assert_eq!(actual.media.url.as_deref(), Some(next));
        assert_eq!(actual.render_revision, 0);
    }
    Ok(())
}
