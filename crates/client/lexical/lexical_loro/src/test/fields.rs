use super::*;
#[test]
fn fresh_plain_composites_containerize_on_visit_and_unknown_fields_survive() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let pjson = json!({"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"text","version":1,"text":"a","format":0,"style":"","mode":"normal","detail":0}],"$":{"id":"p","sharedPeerIds":["1","2"],"settings":{"x":1}}});
    let (p, _) = editor.update(|tx| {
        let p = tx.import_node(pjson.as_object().expect("node"))?;
        tx.append(NodeKey::ROOT, &[p])?;
        Ok(p)
    })?;
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let map = projection.index.map(&doc, p)?;
    let state = schema::map_at(map.get("$"), "$")?;
    assert!(matches!(
        state.get("sharedPeerIds"),
        Some(ValueOrContainer::Value(_))
    ));
    // Unknown data from a newer client is not part of this editor's before export.
    map.insert("future", schema::to_loro(&json!({"new":true})))?;
    state.insert("searchText", "future index")?;
    doc.commit_with(loro::CommitOptions::new().origin(LOCAL_ORIGIN).timestamp(1));
    let t = editor.state().view().first_descendant(p).expect("text");
    let (_, commit) = editor.update(|tx| {
        tx.text(t)?.set_text_content("ab")?;
        Ok(())
    })?;
    projection.local_commit(&doc, &[commit], LOCAL_ORIGIN, 2)?;
    assert!(matches!(
        state.get("sharedPeerIds"),
        Some(ValueOrContainer::Container(Container::List(_)))
    ));
    assert!(matches!(
        state.get("settings"),
        Some(ValueOrContainer::Container(Container::Map(_)))
    ));
    assert_eq!(
        schema::read_value(&map.get("future").expect("future"))?,
        json!({"new":true})
    );
    assert_eq!(
        schema::read_value(&state.get("searchText").expect("search"))?,
        json!("future index")
    );
    Ok(())
}
