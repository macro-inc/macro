use super::*;

#[test]
fn node_ordering_accessors_use_the_model_tree() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let first = tx.create(Paragraph::default())?.key();
    let second = tx.create(Paragraph::default())?.key();
    tx.append(NodeKey::ROOT, &[second, first])?;
    let mut r = Replayer::default();
    assert_eq!(
        call(
            &mut r,
            &mut tx,
            &json!({"$node":second.index()}),
            "isBefore",
            &[json!({"$node":first.index()})]
        )?,
        json!(true)
    );
    assert_eq!(
        call(
            &mut r,
            &mut tx,
            &json!({"$node":first.index()}),
            "isBefore",
            &[json!({"$node":second.index()})]
        )?,
        json!(false)
    );
    assert_eq!(
        call(
            &mut r,
            &mut tx,
            &json!({"$node":0}),
            "isParentOf",
            &[json!({"$node":first.index()})]
        )?,
        json!(true)
    );
    Ok(())
}
