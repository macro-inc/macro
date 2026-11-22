use super::*;
use crate::{EditorType, nodes::*, surface};

fn block(tx: &mut Transaction<'_>, kind: &str) -> Result<NodeKey, Error> {
    Ok(match kind {
        "image" => tx.create(ImageNode::default())?.key(),
        "video" => tx.create(VideoNode::default())?.key(),
        "horizontalrule" => tx.create(HorizontalRuleNode::default())?.key(),
        "database-query" => tx
            .create(DatabaseQueryNode {
                data: DatabaseQueryData {
                    display_mode: DatabaseQueryDisplayMode::Table,
                    ..DatabaseQueryData::default()
                },
            })?
            .key(),
        "document-card" => tx.create(DocumentCardNode::default())?.key(),
        _ => panic!("unexpected fixture kind"),
    })
}

#[test]
fn every_source_stopping_type_requires_the_actual_edge_then_selects_the_block() -> Result<(), Error>
{
    for kind in [
        "image",
        "video",
        "horizontalrule",
        "database-query",
        "document-card",
    ] {
        for direction in [Direction::Up, Direction::Down] {
            let mut editor = surface::preset_builder_with_mode(
                EditorType::MarkdownSync,
                EditorMode::ViewAttached,
            )
            .build()
            .expect("surface");
            editor.update(|tx| {
                let p = tx.create(Paragraph::default())?;
                let text = tx.create_text("line one\nline two")?;
                tx.append(p, &[text.key()])?;
                let target = block(tx, kind)?;
                let children = if direction == Direction::Up {
                    [target, p.key()]
                } else {
                    [p.key(), target]
                };
                tx.append(NodeKey::ROOT, &children)?;
                tx.select_start(text)?;
                assert!(prepare(tx, direction, true)?.is_none(), "shift {kind}");
                let original = tx.selection().cloned();
                let plan = prepare(tx, direction, false)?.expect("stopping sibling");
                assert_eq!(plan.block(), Some(p.key()));
                assert!(!plan.complete(tx, None)?, "missing geometry {kind}");
                assert_eq!(tx.selection(), original.as_ref());
                let interior = EdgeRects {
                    block_top: 0.0,
                    block_bottom: 60.0,
                    caret_top: 20.0,
                    caret_bottom: 40.0,
                    caret_height: 20.0,
                };
                assert!(
                    !prepare(tx, direction, false)?
                        .expect("plan")
                        .complete(tx, Some(interior))?,
                    "strict edge threshold {kind}"
                );
                let edge = EdgeRects {
                    block_top: 0.0,
                    block_bottom: 60.0,
                    caret_top: if direction == Direction::Up {
                        0.0
                    } else {
                        40.0
                    },
                    caret_bottom: if direction == Direction::Up {
                        20.0
                    } else {
                        60.0
                    },
                    caret_height: 20.0,
                };
                assert!(
                    prepare(tx, direction, false)?
                        .expect("plan")
                        .complete(tx, Some(edge))?,
                    "edge {kind}"
                );
                let Selection::Node(nodes) = tx.selection().expect("selection") else {
                    panic!("node selection {kind}");
                };
                assert_eq!(nodes.keys().collect::<Vec<_>>(), [target]);
                Ok(())
            })?;
        }
    }
    Ok(())
}

#[test]
fn root_and_adjacent_node_plans_need_no_geometry_but_paragraphs_fall_through() -> Result<(), Error>
{
    for kind in [
        "image",
        "video",
        "horizontalrule",
        "database-query",
        "document-card",
    ] {
        let mut editor =
            surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
                .build()
                .expect("surface");
        editor.update(|tx| {
            let first = block(tx, kind)?;
            let second = block(tx, kind)?;
            let p = tx.create(Paragraph::default())?;
            tx.append(NodeKey::ROOT, &[first, second, p.key()])?;
            tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
                Point::element(NodeKey::ROOT, ChildIndex(0)),
            ))))?;
            assert!(prepare(tx, Direction::Up, false)?.is_none());
            assert!(
                prepare(tx, Direction::Down, false)?
                    .expect("root plan")
                    .complete(tx, None)?
            );
            assert!(
                prepare(tx, Direction::Down, false)?
                    .expect("node sibling")
                    .complete(tx, None)?
            );
            assert!(
                prepare(tx, Direction::Down, false)?.is_none(),
                "paragraph must fall through {kind}"
            );
            assert!(
                prepare(tx, Direction::Up, false)?
                    .expect("previous node")
                    .complete(tx, None)?
            );
            let Selection::Node(nodes) = tx.selection().expect("selection") else {
                panic!("node");
            };
            assert_eq!(nodes.keys().collect::<Vec<_>>(), [first]);
            Ok(())
        })?;
    }
    Ok(())
}

#[test]
fn stale_selection_changed_tree_and_nonstopping_inline_nodes_never_select() -> Result<(), Error> {
    let mut editor =
        surface::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .build()
            .expect("surface");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("before")?;
        tx.append(p, &[text.key()])?;
        let target = block(tx, "horizontalrule")?;
        tx.append(NodeKey::ROOT, &[p.key(), target])?;
        tx.select_end(text)?;
        let plan = prepare(tx, Direction::Down, false)?.expect("plan");
        tx.select_start(text)?;
        assert!(!plan.complete(tx, None)?);
        let plan = prepare(tx, Direction::Down, false)?.expect("plan");
        tx.remove(target, false)?;
        assert!(!plan.complete(tx, None)?);
        let inline = tx.create(DatabaseQueryNode::default())?;
        let equation = tx.create(EquationNode {
            equation: Maybe::Value("x".into()),
            inline: false,
        })?;
        tx.append(NodeKey::ROOT, &[inline.key(), equation.key()])?;
        assert!(prepare(tx, Direction::Down, false)?.is_none());
        tx.set_selection(Some(Selection::Range(RangeSelection::collapsed(
            Point::element(NodeKey::ROOT, ChildIndex(2)),
        ))))?;
        assert!(prepare(tx, Direction::Down, false)?.is_none());
        Ok(())
    })?;
    Ok(())
}
