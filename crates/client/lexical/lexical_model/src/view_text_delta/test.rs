use super::*;

#[test]
fn utf16_replacement_preserves_the_immutable_source_and_its_surrogate_pair() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::ViewAttached)
        .build()
        .expect("registry");
    let (key, _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?;
        let text = tx.create_text("a😀b")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(text.key())
    })?;
    let previous = editor.state().clone();
    let delta = ViewTextDelta {
        key,
        offset: Utf16Offset(1),
        deleted: Utf16Offset(2),
        inserted: "😁".into(),
        anchor: Some(Utf16Offset(3)),
        focus: Some(Utf16Offset(3)),
        composition_end: false,
        composition_data: None,
        selection: ViewSelection::KeepModel,
    };
    assert_eq!(delta.displayed_text(previous.view())?, "a😁b");
    assert_eq!(previous.view().text_content(key), "a😀b");
    assert_eq!(editor.state().view().text_content(key), "a😀b");
    assert!(matches!(
        ViewTextDelta {
            offset: Utf16Offset(2),
            deleted: Utf16Offset(0),
            ..delta.clone()
        }
        .displayed_text(previous.view()),
        Err(Error::Utf16OffsetSplitsSurrogatePair(Utf16Offset(2)))
    ));
    assert!(matches!(
        ViewTextDelta {
            offset: Utf16Offset(1),
            deleted: Utf16Offset(1),
            ..delta.clone()
        }
        .displayed_text(previous.view()),
        Err(Error::Utf16OffsetSplitsSurrogatePair(Utf16Offset(2)))
    ));
    assert!(matches!(
        ViewTextDelta {
            offset: Utf16Offset(5),
            deleted: Utf16Offset(0),
            ..delta.clone()
        }
        .displayed_text(previous.view()),
        Err(Error::Utf16OffsetOutOfRange(Utf16Offset(5)))
    ));
    assert!(matches!(
        ViewTextDelta {
            offset: Utf16Offset(u32::MAX),
            deleted: Utf16Offset(1),
            ..delta
        }
        .displayed_text(previous.view()),
        Err(Error::Utf16OffsetOutOfRange(Utf16Offset(u32::MAX)))
    ));
    assert_eq!(previous.view().text_content(key), "a😀b");
    Ok(())
}
