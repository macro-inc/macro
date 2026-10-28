use super::*;

#[test]
fn children_stay_ordered_by_key() {
    let mut s = Story::new();
    let a = BlockId::new("a");
    let b = BlockId::new("b");
    s.insert(Block::new(
        a.clone(),
        BlockKind::Paragraph,
        None,
        "V".into(),
    ));
    s.insert(Block::new(
        b.clone(),
        BlockKind::Paragraph,
        None,
        "F".into(),
    ));
    assert_eq!(s.children(None), &[b.clone(), a.clone()]);
    let key = s.key_after(None, Some(&b));
    assert!(key.as_str() > "F" && key.as_str() < "V");
    let c = BlockId::new("c");
    s.insert(Block::new(c.clone(), BlockKind::Paragraph, None, key));
    assert_eq!(s.children(None), &[b.clone(), c.clone(), a.clone()]);
    s.move_block(&a, None, s.key_after(None, None));
    assert_eq!(s.children(None)[0], a);
}

#[test]
fn removing_a_table_removes_its_cells() {
    let mut s = Story::new();
    let t = BlockId::new("t");
    let r = BlockId::new("r");
    let c = BlockId::new("c");
    let p = BlockId::new("p");
    s.insert(Block::new(t.clone(), BlockKind::Table, None, "V".into()));
    s.insert(Block::new(
        r.clone(),
        BlockKind::Row,
        Some(t.clone()),
        "V".into(),
    ));
    s.insert(Block::new(
        c.clone(),
        BlockKind::Cell,
        Some(r.clone()),
        "V".into(),
    ));
    s.insert(Block::new(
        p.clone(),
        BlockKind::Paragraph,
        Some(c.clone()),
        "V".into(),
    ));
    assert_eq!(s.paragraphs(), vec![p.clone()]);
    assert_eq!(s.ancestors(&p), vec![c.clone(), r.clone(), t.clone()]);
    let removed = s.remove(&t);
    assert_eq!(removed.len(), 4);
    assert!(s.is_empty());
}

#[test]
fn ids_are_unique() {
    let mut seq = IdGen::sequential();
    assert_eq!(seq.next_id().as_str(), "1");
    let mut r1 = IdGen::random(1);
    let mut r2 = IdGen::random(2);
    let a: Vec<BlockId> = (0..100).map(|_| r1.next_id()).collect();
    let b: Vec<BlockId> = (0..100).map(|_| r2.next_id()).collect();
    assert!(a.iter().all(|x| !b.contains(x)));
}
