//! Decorator lifetime metadata follows source media setter semantics.
use lexical_model::{DecoratorNode, Error, NodeKey, NodeType, Paragraph, Read};
use macro_document_model::{export_registry, nodes::*};

#[test]
fn false_setters_and_reparent_preserve_revision_and_cow_snapshot() -> Result<(), Error> {
    let mut editor = export_registry();
    let ((image, video, target), _) = editor.update(|tx| {
        let first = tx.create(Paragraph {})?;
        let target = tx.create(Paragraph {})?;
        let image = create_image_node(tx, CreateMedia::default(), None)?;
        let video = create_video_node(tx, CreateMedia::default(), None)?;
        tx.get_mut::<ImageNode>(image)?
            .set_media_property(MediaProperty::Scale(2.0), true)?;
        tx.get_mut::<VideoNode>(video)?
            .set_media_property(MediaProperty::Scale(2.0), true)?;
        tx.append(first, &[image.key(), video.key()])?;
        tx.append(NodeKey::ROOT, &[first.key(), target.key()])?;
        Ok((image, video, target))
    })?;
    let previous = editor.state().clone();
    editor.update(|tx| {
        tx.get_mut::<ImageNode>(image)?
            .set_media_property(MediaProperty::Width(512.0), false)?;
        tx.get_mut::<VideoNode>(video)?
            .set_media_property(MediaProperty::Width(512.0), false)?;
        tx.append(target, &[image.key(), video.key()])?;
        Ok(())
    })?;
    let state = editor.state();
    let image_node = state.get::<ImageNode>(image).expect("image");
    let video_node = state.get::<VideoNode>(video).expect("video");
    assert_eq!(image_node.render_revision, 1);
    assert_eq!(video_node.render_revision, 1);
    assert_eq!(image_node.media.width, Maybe::Value(JsNumber(512.0)));
    assert_eq!(video_node.media.width, Maybe::Value(JsNumber(512.0)));
    assert_eq!(
        previous
            .get::<ImageNode>(image)
            .expect("prior image")
            .render_revision,
        1
    );
    assert_eq!(
        previous
            .get::<VideoNode>(video)
            .expect("prior video")
            .render_revision,
        1
    );
    assert_eq!(
        previous
            .get::<ImageNode>(image)
            .expect("prior image")
            .media
            .width,
        Maybe::Value(JsNumber(0.0))
    );
    assert_eq!(
        previous
            .get::<VideoNode>(video)
            .expect("prior video")
            .media
            .width,
        Maybe::Value(JsNumber(0.0))
    );
    for key in [image.key(), video.key()] {
        let json = state.export_json(key)?;
        assert!(!json.contains_key("renderRevision"));
        assert!(!json.contains_key("render_revision"));
    }
    Ok(())
}

#[test]
fn true_setters_advance_even_when_exported_properties_are_equal() -> Result<(), Error> {
    let mut editor = export_registry();
    let ((image, video), _) = editor.update(|tx| {
        let image = create_image_node(tx, CreateMedia::default(), None)?;
        let video = create_video_node(tx, CreateMedia::default(), None)?;
        tx.append(NodeKey::ROOT, &[image.key(), video.key()])?;
        Ok((image, video))
    })?;
    let before_image = editor.state().export_json(image)?;
    let before_video = editor.state().export_json(video)?;
    editor.update(|tx| {
        tx.get_mut::<ImageNode>(image)?
            .set_media_property(MediaProperty::Scale(1.0), true)?;
        tx.get_mut::<VideoNode>(video)?
            .set_media_property(MediaProperty::Scale(1.0), true)?;
        Ok(())
    })?;
    assert_eq!(
        editor
            .state()
            .get::<ImageNode>(image)
            .expect("image")
            .render_revision,
        1
    );
    assert_eq!(
        editor
            .state()
            .get::<VideoNode>(video)
            .expect("video")
            .render_revision,
        1
    );
    assert_eq!(editor.state().export_json(image)?, before_image);
    assert_eq!(editor.state().export_json(video)?, before_video);
    Ok(())
}

#[test]
fn revision_exhaustion_rolls_back_without_changing_the_media_property() -> Result<(), Error> {
    let mut editor = export_registry();
    let (image, _) = editor.update(|tx| {
        let image = tx.create(ImageNode {
            render_revision: u64::MAX,
            ..ImageNode::default()
        })?;
        tx.append(NodeKey::ROOT, &[image.key()])?;
        Ok(image)
    })?;
    let before = editor.state().export_json(image)?;
    let result = editor.update(|tx| {
        tx.get_mut::<ImageNode>(image)?
            .set_media_property(MediaProperty::Scale(2.0), true)
    });
    assert!(matches!(
        result,
        Err(Error::Invariant("media render revision exhausted"))
    ));
    assert_eq!(
        editor
            .state()
            .get::<ImageNode>(image)
            .expect("image")
            .render_revision,
        u64::MAX
    );
    assert_eq!(editor.state().export_json(image)?, before);
    Ok(())
}

#[test]
fn existing_payload_imports_preserve_lifetime_and_fresh_imports_ignore_serialized_metadata()
-> Result<(), Error> {
    let mut editor = export_registry();
    let ((image, video), _) = editor.update(|tx| {
        let image = tx.create(ImageNode {
            render_revision: 9007199254740993,
            ..Default::default()
        })?;
        let video = tx.create(VideoNode {
            render_revision: 9007199254740993,
            ..Default::default()
        })?;
        tx.append(NodeKey::ROOT, &[image.key(), video.key()])?;
        Ok((image, video))
    })?;
    let mut image_json = editor.state().export_json(image)?;
    let mut video_json = editor.state().export_json(video)?;
    image_json.insert("renderRevision".into(), 42.into());
    video_json.insert("renderRevision".into(), 42.into());
    assert_eq!(
        ImageNode::import_json(&image_json)?.render_revision(),
        Some(0)
    );
    assert_eq!(
        VideoNode::import_json(&video_json)?.render_revision(),
        Some(0)
    );
    editor.update(|tx| {
        tx.update_from_json(image, &image_json)?;
        tx.update_from_json(video, &video_json)?;
        tx.apply_remote_fields(image, &image_json)?;
        tx.apply_remote_fields(video, &video_json)?;
        Ok(())
    })?;
    assert_eq!(
        editor
            .state()
            .get::<ImageNode>(image)
            .expect("image")
            .render_revision(),
        Some(9007199254740993)
    );
    assert_eq!(
        editor
            .state()
            .get::<VideoNode>(video)
            .expect("video")
            .render_revision(),
        Some(9007199254740993)
    );
    Ok(())
}
