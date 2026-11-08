use super::*;

// LexicalNode.test.ts:862, plus direction/ancestor literals from the pinned oracle.
#[test]
fn nodes_between_retains_visited_ancestors_in_upstream_traversal_order() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("registry");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let foo = tx.create_text("foo")?;
    let bar = tx.create_text("bar")?;
    tx.text(bar)?.toggle_unmergeable()?;
    let baz = tx.create_text("baz")?;
    tx.text(baz)?.toggle_unmergeable()?;
    let q = tx.create(Paragraph::default())?;
    let qux = tx.create_text("qux")?;
    tx.text(qux)?.toggle_unmergeable()?;
    tx.append(p, &[foo.key(), bar.key(), baz.key()])?;
    tx.append(q, &[qux.key()])?;
    tx.append(NodeKey::ROOT, &[p.key(), q.key()])?;
    tx.commit()?;
    let view = editor.state().view();
    assert_eq!(view.nodes_between(foo, foo)?, vec![foo.key()]);
    assert_eq!(view.nodes_between(foo, bar)?, vec![foo.key(), bar.key()]);
    assert_eq!(
        view.nodes_between(foo, baz)?,
        vec![foo.key(), bar.key(), baz.key()]
    );
    assert_eq!(
        view.nodes_between(foo, qux)?,
        vec![foo.key(), bar.key(), baz.key(), p.key(), q.key(), qux.key()]
    );
    assert_eq!(
        view.nodes_between(qux, foo)?,
        vec![foo.key(), bar.key(), baz.key(), p.key(), q.key(), qux.key()]
    );
    assert_eq!(
        view.nodes_between(p, foo)?,
        vec![foo.key(), bar.key(), baz.key(), p.key()]
    );
    assert_eq!(
        view.nodes_between(foo, p)?,
        vec![foo.key(), bar.key(), baz.key(), p.key()]
    );
    assert_eq!(
        view.nodes_between(NodeKey::ROOT, qux)?,
        vec![qux.key(), q.key(), NodeKey::ROOT]
    );
    Ok(())
}

#[test]
fn structural_reads_preserve_document_order_depth_and_boundaries() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Inline>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let inline = tx.create(Inline {
        label: "link".into(),
    })?;
    let a = tx.create_text("a😀")?;
    let b = tx.create_text("b")?;
    let line = tx.create(LineBreak::default())?;
    let q = tx.create(Paragraph::default())?;
    tx.append(inline, &[a.key()])?;
    tx.append(p, &[inline.key(), b.key(), line.key()])?;
    tx.append(NodeKey::ROOT, &[p.key(), q.key()])?;
    let view = tx.view();
    assert_eq!(view.root(), NodeKey::ROOT);
    assert_eq!(view.first_child(p), Some(inline.key()));
    assert_eq!(view.last_child(p), Some(line.key()));
    assert_eq!(view.first_child_or_err(p)?, inline.key());
    assert_eq!(view.last_child_or_err(p)?, line.key());
    assert_eq!(view.parent_or_err(a)?, inline.key());
    assert_eq!(
        view.next_siblings(inline).collect::<Vec<_>>(),
        vec![b.key(), line.key()]
    );
    assert_eq!(
        view.prev_siblings(line).collect::<Vec<_>>(),
        vec![inline.key(), b.key()]
    );
    assert_eq!(
        view.ancestors(a).collect::<Vec<_>>(),
        vec![inline.key(), p.key(), NodeKey::ROOT]
    );
    assert_eq!(view.child_at_index(p, ChildIndex(1)), Some(b.key()));
    assert_eq!(view.index_within_parent(b), Some(ChildIndex(1)));
    assert!(view.is_last_child(a)?);
    assert!(view.is_last_child(line)?);
    assert!(view.has_ancestor(a, p));
    assert!(view.is_parent_of(p, a));
    assert_eq!(
        view.descendants(p).collect::<Vec<_>>(),
        vec![
            (inline.key(), 1),
            (a.key(), 2),
            (b.key(), 1),
            (line.key(), 1)
        ]
    );
    assert_eq!(
        view.all_text_nodes(p).collect::<Vec<_>>(),
        vec![a.key(), b.key()]
    );
    assert_eq!(view.first_descendant(p), Some(a.key()));
    assert_eq!(view.last_descendant(p), Some(line.key()));
    assert_eq!(view.descendant_by_index(p, ChildIndex(0)), Some(a.key()));
    assert_eq!(
        view.descendant_by_index(p, ChildIndex(99)),
        Some(line.key())
    );
    assert!(view.is_before(a, b)?);
    assert!(!view.is_before(b, a)?);
    assert_eq!(view.top_level_element(a)?, Some(p.key()));
    assert_eq!(view.top_level_element_or_err(a)?, p.key());
    assert_eq!(view.nearest_root_or_shadow_root(a)?, NodeKey::ROOT);
    assert_eq!(
        view.find_matching_parent(a, |view, key| view.is::<Paragraph>(key)),
        Some(p.key())
    );
    let common = view.common_ancestor(a, b).expect("common");
    assert_eq!(
        common,
        CommonAncestor::Branch {
            ancestor: p.key(),
            a: inline.key(),
            b: b.key()
        }
    );
    assert_eq!(common.ancestor(), p.key());
    assert_eq!(common.branch_order(view)?, std::cmp::Ordering::Less);
    assert_eq!(
        view.common_ancestor(p, a),
        Some(CommonAncestor::Ancestor { ancestor: p.key() })
    );
    assert_eq!(
        view.common_ancestor(a, p),
        Some(CommonAncestor::Descendant { ancestor: p.key() })
    );
    assert_eq!(
        view.common_ancestor(a, a),
        Some(CommonAncestor::Same { ancestor: a.key() })
    );
    assert_eq!(view.common_ancestor_element(a, b), Some(p.key()));
    assert_eq!(
        view.nodes_between(a, line)?,
        vec![a.key(), inline.key(), b.key(), line.key()]
    );
    assert_eq!(
        view.adjacent_node(&Point::text(a, Utf16Offset(1)), EditDirection::Forward)?,
        None
    );
    assert_eq!(
        view.adjacent_node(&Point::text(a, Utf16Offset(3)), EditDirection::Forward)?,
        Some(b.key())
    );
    assert_eq!(
        view.adjacent_node(&Point::element(p, ChildIndex(1)), EditDirection::Backward)?,
        Some(inline.key())
    );
    assert_eq!(view.text_content_size(a), Utf16Offset(3));
    assert_eq!(view.text_content(p), "a😀b\n");
    let index = view.type_index(p).expect("paragraph index");
    assert_eq!(view.nodes_of_type_index(index), vec![p.key(), q.key()]);
    assert_eq!(view.nodes_of_type::<Paragraph>(), vec![p, q]);
    Ok(())
}
#[test]
fn checked_read_errors_distinguish_absent_nodes_from_wrong_kinds() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let text = tx.create_text("x")?;
    let missing = NodeKey::from_parts(KeyParts {
        generation: 0,
        index: 999,
    });
    let view = tx.view();
    assert!(view.contains(text));
    assert!(!view.contains(missing));
    assert!(matches!(view.node_or_err(missing), Err(Error::NodeNotFound(key)) if key == missing));
    assert!(matches!(
        view.get_or_err::<Paragraph>(text),
        Err(Error::NodeTypeMismatch(_))
    ));
    assert!(matches!(
        view.element_data(text),
        Err(Error::NotAnElement(_))
    ));
    assert!(matches!(
        view.text_data(NodeKey::ROOT),
        Err(Error::NotAText(_))
    ));
    assert!(matches!(
        view.parent_or_err(NodeKey::ROOT),
        Err(Error::NoParent(_))
    ));
    assert!(matches!(
        view.first_child_or_err(NodeKey::ROOT),
        Err(Error::NoChild(_))
    ));
    assert!(matches!(
        view.last_child_or_err(NodeKey::ROOT),
        Err(Error::NoChild(_))
    ));
    assert!(matches!(
        view.top_level_element_or_err(NodeKey::ROOT),
        Err(Error::RootNotTopLevel)
    ));
    assert!(view.common_ancestor(text, NodeKey::ROOT).is_none());
    assert_eq!(view.type_name(text)?, "text");
    assert_eq!(view.kind(text), Some(NodeKind::Text));
    assert!(view.get::<Text>(text).is_some());
    assert_eq!(view.cast::<Text>(text), Some(text));
    assert!(view.cast::<Paragraph>(text).is_none());
    assert!(view.get_or_err::<Text>(text).is_ok());
    assert!(view.is_text(text));
    assert!(view.is_element(NodeKey::ROOT));
    assert!(!view.is_decorator(text));
    assert!(!view.is_line_break(text));
    Ok(())
}
#[test]
fn node_records_and_framework_data_are_owned_snapshot_values() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("record")?;
    tx.append(p, &[text.key()])?;
    let view = tx.view();
    let record = view.node_or_err(text)?;
    assert_eq!(record.key(), text.key());
    assert_eq!(record.kind(), NodeKind::Text);
    assert_eq!(record.type_index(), view.type_index(text).expect("index"));
    assert_eq!(record.type_name(), "text");
    assert_eq!(record.parent(), Some(p.key()));
    assert_eq!(record.prev(), None);
    assert_eq!(record.next(), None);
    assert_eq!(record.base().kind(), NodeKind::Text);
    assert!(record.data_any().is::<Text>());
    assert!(record.node_state().is_none());
    let owned = record.to_owned();
    tx.text(text)?.set_text_content("changed")?;
    assert!(
        matches!(owned.as_ref().base(), BaseData::Text(data) if data.text.as_str() == "record")
    );
    let element = tx.view().element_data(p)?;
    assert_eq!(element.first_child(), Some(text.key()));
    assert_eq!(element.last_child(), Some(text.key()));
    assert_eq!(element.children_size(), 1);
    assert!(!element.is_empty());
    assert_eq!(
        ElementView {
            key: p.key(),
            state: tx.view()
        }
        .data()
        .children_size(),
        1
    );
    assert_eq!(
        TextView {
            key: text.key(),
            state: tx.view()
        }
        .data()
        .text
        .as_str(),
        "changed"
    );
    assert_eq!(BaseData::Decorator.kind(), NodeKind::Decorator);
    assert_eq!(BaseData::LineBreak.kind(), NodeKind::LineBreak);
    assert_eq!(
        BaseData::Element(ElementData::default()).kind(),
        NodeKind::Element
    );
    Ok(())
}
#[test]
fn snapshots_share_text_cache_but_not_mutated_records() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("builder");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("cache")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(text)
    })?;
    let state = editor.state().clone();
    let cache = state.root_text_content();
    assert!(std::sync::Arc::ptr_eq(&cache, &state.root_text_content()));
    let selected = state.with_selection(Some(Selection::Node(NodeSelection::default())));
    assert!(state.same_snapshot(&selected));
    assert!(std::sync::Arc::ptr_eq(
        &cache,
        &selected.root_text_content()
    ));
    assert!(selected.selection().is_some());
    assert_eq!(state.max_key(), text.key());
    assert_eq!(state.node_count(), 3);
    let (_, commit) = editor.update(|tx| {
        assert!(tx.committed_state().same_snapshot(&state));
        tx.text(text)?.set_text_content("next")?;
        Ok(())
    })?;
    assert_eq!(state.view().text_content(text), "cache");
    assert_eq!(commit.next.root_text_content().as_ref(), "next");
    assert!(!std::sync::Arc::ptr_eq(
        &cache,
        &commit.next.root_text_content()
    ));
    Ok(())
}

#[test]
fn builtin_predicates_expose_kind_specific_defaults() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Inline>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?;
    let text = tx.create_text("a")?;
    let line = tx.create(LineBreak::default())?;
    let inline = tx.create(Inline::default())?;
    let tab = tx.create(Tab::default())?;
    tx.append(p, &[text.key(), line.key(), inline.key(), tab.key()])?;
    tx.append(NodeKey::ROOT, &[p.key()])?;
    let view = tx.view();
    assert!(!view.is_parent_required(p));
    assert!(view.can_be_empty(p));
    assert!(view.can_insert_text_before(p));
    assert!(view.can_insert_text_after(p));
    assert!(!view.can_insert_text_before(tab));
    assert!(!view.can_insert_text_after(tab));
    assert!(!view.is_shadow_root(p));
    assert!(view.can_indent(p));
    assert!(!view.can_merge_with(p, p.key()));
    assert!(!view.can_merge_when_empty(p));
    assert!(view.can_replace_with(p, p.key()));
    assert!(view.can_insert_after(p, p.key()));
    assert!(!view.exclude_from_copy(p, Some(CopyDestination::Clone)));
    assert!(!view.extract_with_child(p, text.key(), None, CopyDestination::Clone));
    assert!(view.can_have_format(text));
    assert!(!view.is_text_entity(text));
    assert!(!view.is_isolated(p));
    assert!(!view.is_keyboard_selectable(text));
    assert!(view.is_root_or_shadow_root(NodeKey::ROOT));
    assert!(view.is_leaf(line));
    assert!(view.is_line_break(line));
    assert!(view.is_block_element(p));
    assert!(view.is_block(p));
    assert!(!view.is_block(NodeKey::ROOT));
    assert!(view.is_inline_element_or_decorator(inline));
    assert!(view.is_token_or_tab(tab));
    assert!(!view.is_token_or_segmented(text));
    assert!(!view.has_language_field(p));
    assert!(!view.is_composing(text));
    assert_eq!(view.text_content(line), "\n");
    Ok(())
}

/// Upstream LexicalNode.isBefore uses post-order, including detached shared trees.
#[test]
fn node_ordering_places_descendants_before_ancestors_and_orders_detached_siblings()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let parent = tx.create(Paragraph::default())?.key();
    let child = tx.create_text("child")?.key();
    let later = tx.create(Paragraph::default())?.key();
    tx.append(parent, &[child])?;
    tx.append(NodeKey::ROOT, &[parent, later])?;
    let detached = tx.create(Paragraph::default())?.key();
    let left = tx.create_text("left")?.key();
    let right = tx.create_text("right")?.key();
    tx.append(detached, &[right, left])?;
    let view = tx.view();
    assert!(view.is_before(child, parent)?);
    assert!(!view.is_before(parent, child)?);
    assert!(view.is_before(child, NodeKey::ROOT)?);
    assert!(!view.is_before(NodeKey::ROOT, child)?);
    assert!(view.is_before(parent, later)?);
    assert!(!view.is_before(later, parent)?);
    assert!(!view.is_before(child, child)?);
    assert!(view.is_before(right, left)?);
    assert!(!view.is_before(left, right)?);
    assert!(view.is_before(right, detached)?);
    assert!(!view.is_before(child, right)?);
    Ok(())
}
