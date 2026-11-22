use super::*;
use crate::mark::*;
impl NestedElementResolver for MarkNode {
    fn clone_for_split(tx: &mut Transaction<'_>, from: NodeKey) -> Result<NodeKey, Error> {
        create_mark_node(tx, tx.get_or_err::<MarkNode>(from)?.ids.clone())
    }
    fn handle_overlap(tx: &mut Transaction<'_>, from: NodeKey, to: NodeKey) -> Result<(), Error> {
        let ids = tx.get_or_err::<MarkNode>(from)?.ids.clone();
        for id in ids {
            tx.get_mut::<MarkNode>(to)?.add_id(&id);
        }
        Ok(())
    }
}
#[test]
fn direct_nested_annotations_split_outer_runs_and_merge_metadata() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<MarkNode>()
        .build()
        .unwrap();
    editor.update(|tx| {
        let p = tx.create(Paragraph {})?;
        let outer = create_mark_node(tx, vec!["outer".into()])?;
        let inner = create_mark_node(tx, vec!["inner".into()])?;
        let a = tx.create_text("a")?;
        let b = tx.create_text("b")?;
        let c = tx.create_text("c")?;
        tx.append(inner, &[b.key()])?;
        tx.append(outer, &[a.key(), inner, c.key()])?;
        tx.append(p, &[outer])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        resolve_nested_element(tx, tx.cast::<MarkNode>(inner).unwrap())?;
        let children = tx.children_keys(p)?;
        assert_eq!(children.len(), 3);
        assert_eq!(children[1], inner);
        assert_eq!(tx.get_or_err::<MarkNode>(inner)?.ids, ["inner", "outer"]);
        assert_eq!(tx.text_content(children[0]), "a");
        assert_eq!(tx.text_content(children[2]), "c");
        Ok(())
    })?;
    Ok(())
}
