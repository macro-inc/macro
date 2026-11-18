use super::*;
pub(crate) fn path(view: StateRef<'_>, key: NodeKey) -> Result<Vec<u32>, Error> {
    let mut key = key;
    let mut result = vec![];
    while key != NodeKey::ROOT {
        result.push(
            view.index_within_parent(key)
                .ok_or(Error::PointNodeNotFound(key))?
                .0,
        );
        key = view.parent(key).ok_or(Error::PointNodeNotFound(key))?;
    }
    result.reverse();
    Ok(result)
}
pub(crate) fn point(view: StateRef<'_>, point: Point) -> Result<Value, Error> {
    Ok(
        json!({"path":path(view,point.key())?,"offset":point.offset(),"type":point.point_type().to_string()}),
    )
}
pub(crate) fn selection(state: &EditorState) -> Result<Value, Error> {
    let Some(Selection::Range(r)) = state.selection() else {
        return Ok(Value::Null);
    };
    Ok(
        json!({"type":"range","anchor":point(state.view(),r.anchor)?,"focus":point(state.view(),r.focus)?,"format":r.format.bits(),"style":r.style.as_ref(),"backward":r.is_backward(state.view())?}),
    )
}
pub(crate) fn capture(state: &EditorState, commit: Option<&Commit>) -> Result<Value, Error> {
    let view = state.view();
    let mut keys = vec![NodeKey::ROOT];
    keys.extend(view.descendants(NodeKey::ROOT).map(|(key, _)| key));
    let identities: Vec<_> = keys
        .iter()
        .map(|k| Ok(json!({"path":path(view,*k)?,"key":k.to_string()})))
        .collect::<Result<_, Error>>()?;
    let commit=commit.map(|c|json!({
  "dirtyLeaves":c.changes.dirty_leaves.iter().map(ToString::to_string).collect::<Vec<_>>(),
  "dirtyElements":c.changes.dirty_elements.iter().map(|(k,v)|json!([k.to_string(),matches!(v,DirtyIntent::Intentional)])).collect::<Vec<_>>(),
  "normalized":c.normalized.iter().map(ToString::to_string).collect::<Vec<_>>(),
  "mutations":c.changes.mutations.iter().map(|(k,v)|json!([k.to_string(),v.to_string()])).collect::<Vec<_>>(),
  "tags":c.tags.iter().map(ToString::to_string).collect::<Vec<_>>()
 }));
    Ok(
        json!({"state":state.to_json()?,"selection":selection(state)?,"text":state.root_text_content().as_ref(),"keys":identities,"commit":commit,"error":null}),
    )
}
