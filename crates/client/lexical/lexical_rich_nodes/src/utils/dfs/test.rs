use super::*;
#[test]
fn preorder_end_bounds_reverse_and_mutation_safe_children() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    editor.update(|tx| {
        let a = tx.create(Paragraph {})?;
        let b = tx.create(Paragraph {})?;
        let x = tx.create_text("x")?;
        let y = tx.create_text("y")?;
        tx.append(a, &[x.key()])?;
        tx.append(b, &[y.key()])?;
        tx.append(NodeKey::ROOT, &[a.key(), b.key()])?;
        assert_eq!(
            dfs(tx.view(), None, None),
            [
                DfsNode {
                    node: NodeKey::ROOT,
                    depth: 0
                },
                DfsNode {
                    node: a.key(),
                    depth: 1
                },
                DfsNode {
                    node: x.key(),
                    depth: 2
                },
                DfsNode {
                    node: b.key(),
                    depth: 1
                },
                DfsNode {
                    node: y.key(),
                    depth: 2
                }
            ]
        );
        assert_eq!(
            dfs(tx.view(), Some(a.key()), Some(b.key()))
                .iter()
                .map(|item| item.node)
                .collect::<Vec<_>>(),
            [a.key(), x.key(), b.key()]
        );
        assert_eq!(
            reverse_dfs(tx.view(), None, None)
                .iter()
                .map(|item| item.node)
                .collect::<Vec<_>>(),
            [NodeKey::ROOT, b.key(), y.key(), a.key(), x.key()]
        );
        assert_eq!(
            get_next_right_preorder_node(tx.view(), NodeKey::ROOT),
            Some(b.key())
        );
        assert_eq!(
            get_next_right_preorder_node(tx.view(), b.key()),
            Some(y.key())
        );
        assert_eq!(
            get_next_right_preorder_node(tx.view(), y.key()),
            Some(a.key())
        );
        assert_eq!(
            get_next_sibling_or_parent_sibling(tx.view(), x.key()),
            Some((b.key(), -1))
        );
        let mut cursor = crate::utils::first_to_last(tx, NodeKey::ROOT);
        assert_eq!(cursor.next(tx), Some(a.key()));
        tx.remove(a, false)?;
        assert_eq!(cursor.next(tx), Some(b.key()));
        assert_eq!(cursor.next(tx), None);
        Ok(())
    })?;
    Ok(())
}
