use super::*;
use crate::{EditorType, surface};

#[test]
fn prepare_link_refuses_absent_or_collapsed_selection() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    assert_eq!(
        editor.update(|tx| apply(tx, &LinkAction::Prepare))?.0,
        Handled::No
    );
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("body")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::text(text, Utf16Offset(2)),
        ))))?;
        assert_eq!(apply(tx, &LinkAction::Prepare)?, Handled::No);
        assert!(tx.view().nodes_of_type::<LinkNode>().is_empty());
        Ok(())
    })?;
    Ok(())
}

#[test]
fn prepare_link_wraps_only_the_backward_partial_range_and_preserves_direction() -> Result<(), Error>
{
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("left chosen right")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(text, Utf16Offset(11)));
        range.focus = Point::text(text, Utf16Offset(5));
        tx.set_selection(Some(Selection::Range(range)))?;
        assert_eq!(apply(tx, &LinkAction::Prepare)?, Handled::Yes);
        let view = tx.view();
        let links = view.nodes_of_type::<LinkNode>();
        assert_eq!(links.len(), 1);
        assert_eq!(
            view.get::<LinkNode>(links[0]).expect("prepared link").url,
            ""
        );
        assert_eq!(view.text_content(links[0]), "chosen");
        let range = tx.selection().and_then(Selection::as_range).expect("range");
        assert!(range.is_backward(view)?);
        assert_eq!(range.anchor.offset(), 6);
        assert_eq!(range.focus.offset(), 0);
        assert_eq!(view.text_content(NodeKey::ROOT), "left chosen right");
        Ok(())
    })?;
    Ok(())
}

#[test]
fn prepare_link_updates_existing_link_and_autolink_without_unwrapping() -> Result<(), Error> {
    for auto in [false, true] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        editor.update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let key = if auto {
                create_auto_link_node(tx, "https://example.com", AutoLinkAttributes::default())?
                    .key()
            } else {
                create_link_node(tx, "https://example.com", LinkAttributes::default())?.key()
            };
            let text = tx.create_text("left chosen right")?;
            tx.append(key, &[text.key()])?;
            tx.append(p, &[key])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            let mut range = RangeSelection::collapsed(Point::text(text, Utf16Offset(11)));
            range.focus = Point::text(text, Utf16Offset(5));
            tx.set_selection(Some(Selection::Range(range)))?;
            assert_eq!(apply(tx, &LinkAction::Prepare)?, Handled::Yes);
            assert_eq!(tx.children_keys(p)?, vec![key]);
            assert_eq!(tx.view().text_content(key), "left chosen right");
            assert_eq!(tx.is::<AutoLinkNode>(key), auto);
            assert_eq!(
                tx.export_json(key)?.get("url"),
                Some(&serde_json::json!(""))
            );
            let range = tx.selection().and_then(Selection::as_range).expect("range");
            assert!(range.is_backward(tx.view())?);
            assert_eq!(range.anchor.offset(), 6);
            assert_eq!(range.focus.offset(), 0);
            Ok(())
        })?;
    }
    Ok(())
}

#[test]
fn prepare_link_decoder_executes_the_registered_surface_command() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("chosen")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        let mut range = RangeSelection::collapsed(Point::text(text, Utf16Offset(0)));
        range.focus = Point::text(text, Utf16Offset(6));
        tx.set_selection(Some(Selection::Range(range)))
    })?;
    let command = surface::decode_command(
        "group-b.link",
        r#"{"action":"prepare"}"#,
        editor.state().max_key().generation(),
        None,
    )?
    .expect("known link action");
    assert_eq!(editor.dispatch(&command)?.0, Handled::Yes);
    let view = editor.state().view();
    let links = view.nodes_of_type::<LinkNode>();
    assert_eq!(links.len(), 1);
    assert_eq!(view.get::<LinkNode>(links[0]).expect("link").url, "");
    assert_eq!(view.text_content(links[0]), "chosen");
    Ok(())
}
