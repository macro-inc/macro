//! Node constructor and state behavior.
use lexical_model::*;
use macro_document_model::{nodes::*, *};
#[test]
fn media_dimensions_preserve_js_parse_and_nan_rules() {
    assert_eq!(
        constrain_image_dimensions(
            Some(LooseDimension::Str("\u{feff}+800px")),
            Some(LooseDimension::Num(600.0)),
            Some(400.0),
            None
        ),
        Some(Dimensions {
            width: 400.0,
            height: 300.0
        })
    );
    assert_eq!(
        constrain_image_dimensions(
            Some(LooseDimension::Str("-2px")),
            Some(LooseDimension::Num(600.0)),
            None,
            None
        ),
        None
    );
    assert_eq!(
        constrain_image_dimensions(
            Some(LooseDimension::Str("+px")),
            Some(LooseDimension::Num(600.0)),
            None,
            None
        ),
        None
    );
    assert_eq!(
        calculate_effective_dimensions(400.0, 200.0, Some(800.0), Some(800.0)),
        Dimensions {
            width: 400.0,
            height: 200.0
        }
    );
    assert_eq!(
        calculate_effective_dimensions(9007199254740990.0, 2.0, Some(4503599627370495.0), None),
        Dimensions {
            width: 4503599627370495.0,
            height: 1.0
        }
    );
    let invalid = calculate_effective_dimensions(f64::NAN, 200.0, Some(100.0), None);
    assert!(invalid.width.is_nan());
    assert!(invalid.height.is_nan());
}
#[test]
fn block_alignment_is_display_only_and_resets_on_constructor_clone() -> Result<()> {
    let mut editor = export_registry();
    let (image, _) = editor.update(|tx| {
        let image = create_image_node(
            tx,
            CreateMedia {
                src_type: "sfs".into(),
                scale: Some(0.0),
                ..Default::default()
            },
            None,
        )?;
        assert_eq!(
            tx.get::<ImageNode>(image).unwrap().block.format,
            ElementFormat::Center
        );
        assert_eq!(tx.get::<ImageNode>(image).unwrap().media.scale.0, 1.0);
        set_decorator_block_format(tx, image, ElementFormat::Right)?;
        tx.append(NodeKey::ROOT, &[image.key()])?;
        Ok(image)
    })?;
    assert_eq!(
        editor.state().get::<ImageNode>(image).unwrap().block.format,
        ElementFormat::Right
    );
    editor.update(|tx| {
        tx.get_mut::<ImageNode>(image)?.alt = "diagram".into();
        Ok(())
    })?;
    let state = editor.state();
    assert_eq!(
        state.get::<ImageNode>(image).unwrap().block.format,
        ElementFormat::Center
    );
    let json = state.export_json(image)?;
    assert!(!json.contains_key("format"));
    assert!(!json.contains_key("block"));
    assert!(is_decorator_block(state, image.key()));
    Ok(())
}

#[test]
fn authored_video_constructor_defaults_falsy_scale() -> Result<()> {
    let mut editor = export_registry();
    let mut tx = editor.transaction();
    let video = create_video_node(
        &mut tx,
        CreateMedia {
            scale: Some(f64::NAN),
            ..Default::default()
        },
        None,
    )?;
    assert_eq!(tx.get::<VideoNode>(video).unwrap().media.scale.0, 1.0);
    assert!(tx.get::<VideoNode>(video).unwrap().controls);
    Ok(())
}
