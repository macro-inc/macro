use crate::*;
static FIRST: EventKey<u32> = EventKey::new("event");
static OTHER: EventKey<u32> = EventKey::new("event");
#[test]
fn event_identity_order_and_rollback_are_transactional() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let original = editor.state().clone();
    let mut tx = editor.transaction();
    tx.emit(&FIRST, 1);
    tx.emit(&OTHER, 9);
    tx.emit(&FIRST, 2);
    tx.flush()?;
    let commit = tx.commit()?;
    assert_eq!(
        commit.events_of(&FIRST).copied().collect::<Vec<_>>(),
        vec![1, 2]
    );
    assert_eq!(
        commit.events_of(&OTHER).copied().collect::<Vec<_>>(),
        vec![9]
    );
    assert_eq!(commit.events[0], commit.events[0].clone());
    assert_ne!(commit.events[0], commit.events[2]);
    assert!(commit.next.same_snapshot(&original));
    assert!(!commit.is_noop());
    let error = editor
        .update(|tx| -> Result<(), Error> {
            tx.emit(&FIRST, 3);
            tx.flush()?;
            Err(Error::Invariant("rollback"))
        })
        .expect_err("rollback");
    assert!(matches!(error, Error::Invariant("rollback")));
    let tx = editor.transaction();
    let next = tx.commit()?;
    assert!(next.events.is_empty());
    assert!(next.is_noop());
    Ok(())
}
