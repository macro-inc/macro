use super::*;
#[derive(Clone, Debug, PartialEq)]
struct Counter(u32);
#[test]
fn extension_writes_roll_back_and_commit_separately_from_snapshots() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Counter(1))
        .build()
        .unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        tx.append(NodeKey::ROOT, &[p.key()])
    })?;
    let original = editor.state().clone();
    assert_eq!(editor.extension::<Counter>()?.0, 1);
    {
        let mut tx = editor.transaction();
        tx.extension_mut::<Counter>()?.0 = 2;
        assert_eq!(tx.extension::<Counter>()?.0, 2);
    }
    assert_eq!(editor.extension::<Counter>()?.0, 1);
    editor.update(|tx| {
        tx.extension_mut::<Counter>()?.0 = 3;
        Ok(())
    })?;
    assert_eq!(editor.extension::<Counter>()?.0, 3);
    editor.set_editor_state(original, TagSet::default())?;
    assert_eq!(editor.extension::<Counter>()?.0, 3);
    assert!(editor.try_extension::<String>().is_none());
    assert!(matches!(
        editor.extension::<String>(),
        Err(Error::UnknownExtensionState { .. })
    ));
    let mut tx = editor.transaction();
    assert!(tx.try_extension::<String>().is_none());
    assert!(matches!(
        tx.extension::<String>(),
        Err(Error::UnknownExtensionState { .. })
    ));
    assert!(matches!(
        tx.extension_mut::<String>(),
        Err(Error::UnknownExtensionState { .. })
    ));
    Ok(())
}
#[test]
fn duplicate_extension_state_is_a_build_error() {
    let result = Editor::builder(EditorMode::Headless)
        .extension_state(Counter(1))
        .extension_state(Counter(2))
        .build();
    assert!(matches!(
        result,
        Err(BuildError::DuplicateExtensionState { .. })
    ));
}
