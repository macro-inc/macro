use super::*;
#[test]
fn generations_cannot_alias() -> Result<(), Error> {
    let counter = SharedKeyCounter::new();
    let first = counter.next()?;
    counter.reset()?;
    let second = counter.next()?;
    assert_ne!(first, second);
    assert_eq!(first.to_string(), second.to_string());
    assert!(first < second);
    assert_eq!(
        NodeKey::from_parts(KeyParts {
            generation: 4,
            index: 0
        }),
        NodeKey::ROOT
    );
    assert_eq!(counter.clone().next()?.index(), 2);
    Ok(())
}

#[cfg(feature = "foreign-nodes")]
#[test]
fn host_allocations_share_editor_keys_without_creating_nodes_or_commits() -> Result<(), Error> {
    use crate::*;
    let keys = SharedKeyCounter::new();
    let first = keys.allocate_for_foreign_host()?;
    assert_eq!(first.index(), 1);
    let mut editor = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys.clone()))
        .build()
        .expect("editor");
    let mut other = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys.clone()))
        .build()
        .expect("other editor");
    let mut tx = editor.transaction();
    let p = tx.create(Paragraph::default())?.key();
    assert_eq!(p.index(), 2);
    assert!(!tx.contains(first));
    tx.append(NodeKey::ROOT, &[p])?;
    let commit = tx.commit()?;
    assert_eq!(commit.id, CommitId(1));
    let third = keys.allocate_for_foreign_host()?;
    assert_eq!(third.index(), 3);
    let mut tx = other.transaction();
    assert_eq!(tx.create_text("orphan")?.key().index(), 4);
    drop(tx);
    keys.reset()?;
    let restarted = keys.allocate_for_foreign_host()?;
    assert_eq!(restarted.index(), 1);
    assert_eq!(restarted.generation(), 1);
    assert_ne!(first, restarted);
    assert!(!editor.state().contains(restarted));
    let commit = editor.transaction().commit()?;
    assert_eq!(commit.id, CommitId(2));
    Ok(())
}
