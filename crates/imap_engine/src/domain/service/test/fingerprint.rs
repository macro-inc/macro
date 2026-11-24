use super::*;

#[test]
fn duplicate_fingerprint_choice_uses_location_key_order() {
    let mut first = sync_cost::inbox(3, 11);
    let template = first[0].messages[0].clone();
    for (index, item) in first[0].messages.iter_mut().enumerate() {
        *item = template.clone();
        item.uid = [1, 2, 10][index];
        item.gmail_message_id = None;
        item.native_message_id = None;
        item.native_thread_id = None;
    }
    let mut state = AccountState::default();
    merge_snapshot(&mut state, first).unwrap();
    let greatest = state
        .locations
        .iter()
        .find(|l| l.uid == 2)
        .unwrap()
        .message_id
        .clone();
    state.locations.rotate_left(1);
    let mut moved = sync_cost::inbox(1, 100);
    moved[0].folder.id = "archive".into();
    moved[0].folder.role = FolderRole::Archive;
    moved[0].path = "Archive".into();
    moved[0].messages[0] = template;
    moved[0].messages[0].uid = 99;
    moved[0].messages[0].gmail_message_id = None;
    moved[0].messages[0].native_message_id = None;
    moved[0].messages[0].native_thread_id = None;
    merge_snapshot(&mut state, moved).unwrap();
    assert_eq!(
        state.locations[0].message_id, greatest,
        "duplicate match must pop the greatest stable location key, not input order"
    );
}

#[tokio::test]
async fn fingerprint_lookup_failure_cannot_create_a_second_identity() {
    let first = sync_cost::inbox(1, 2);
    let mut moved = sync_cost::inbox(1, 100);
    moved[0].messages[0].uid = 99;
    let fixture = sync_cost::fixture(vec![first, moved]);
    fixture
        .engine
        .execute(fixture.binding, Operation::Sync)
        .await
        .unwrap();
    let before = fixture.repository.state.lock().unwrap().clone();
    let revision = fixture.repository.revision.load(Ordering::Acquire);
    fixture
        .repository
        .fingerprint_failure
        .store(true, Ordering::Release);
    assert!(matches!(
        fixture
            .engine
            .execute(fixture.binding, Operation::Sync)
            .await,
        Err(Error::ConnectionUnavailable)
    ));
    assert_eq!(
        fixture.repository.revision.load(Ordering::Acquire),
        revision
    );
    assert_eq!(
        fixture.repository.state.lock().unwrap().locations,
        before.locations
    );
}

#[tokio::test]
async fn fingerprint_batches_share_one_pool_and_keep_live_copies_separate() {
    let mut initial = sync_cost::inbox(1, 2);
    initial[0].messages[0].native_message_id = None;
    initial[0].messages[0].native_thread_id = None;
    let mut moved = sync_cost::inbox(502, 1000);
    for message in &mut moved[0].messages {
        message.native_message_id = None;
        message.native_thread_id = None;
    }
    moved[0].messages[0] = initial[0].messages[0].clone();
    moved[0].messages[0].uid = 1001;
    moved[0].messages[501] = initial[0].messages[0].clone();
    moved[0].messages[501].uid = 1002;
    let mut copied = sync_cost::inbox(502, 1000);
    copied[0].messages = moved[0].messages.clone();
    let mut copy = copied[0].messages[0].clone();
    copy.uid = 1003;
    copied[0].messages.push(copy);
    let fixture = sync_cost::fixture(vec![initial, moved, copied]);
    fixture
        .engine
        .execute(fixture.binding, Operation::Sync)
        .await
        .unwrap();
    let original = fixture.repository.state.lock().unwrap().locations[0]
        .message_id
        .clone();
    fixture.repository.fingerprint_calls.lock().unwrap().clear();
    fixture
        .engine
        .execute(fixture.binding, Operation::Sync)
        .await
        .unwrap();
    assert_eq!(
        *fixture.repository.fingerprint_calls.lock().unwrap(),
        vec![500, 1]
    );
    let state = fixture.repository.state.lock().unwrap();
    assert_eq!(
        state
            .locations
            .iter()
            .filter(|location| location.message_id == original)
            .count(),
        1
    );
    assert_eq!(
        state.locations.len(),
        state
            .locations
            .iter()
            .map(|location| &location.message_id)
            .collect::<BTreeSet<_>>()
            .len()
    );
    drop(state);
    fixture
        .engine
        .execute(fixture.binding, Operation::Sync)
        .await
        .unwrap();
    let state = fixture.repository.state.lock().unwrap();
    assert_eq!(
        state
            .locations
            .iter()
            .filter(|location| location.message_id == original)
            .count(),
        1
    );
    assert_eq!(state.locations.len(), 503);
}

#[tokio::test]
async fn unchanged_uids_do_not_hash_or_lookup_old_messages_again() {
    let fixture = sync_cost::fixture(vec![sync_cost::inbox(3, 4), sync_cost::inbox(3, 4)]);
    fixture
        .engine
        .execute(fixture.binding, Operation::Sync)
        .await
        .unwrap();
    assert_eq!(
        *fixture.repository.fingerprint_calls.lock().unwrap(),
        vec![3]
    );
    fixture.repository.fingerprint_calls.lock().unwrap().clear();
    fixture
        .engine
        .execute(fixture.binding, Operation::Sync)
        .await
        .unwrap();
    assert!(
        fixture
            .repository
            .fingerprint_calls
            .lock()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn mixed_utf8_location_keys_use_the_same_byte_order_in_pure_matching() {
    let mut state = AccountState::default();
    merge_snapshot(&mut state, sync_cost::fingerprint_copies_in_mixed_folders()).unwrap();
    let expected = state
        .locations
        .iter()
        .max_by_key(|location| location.storage_key())
        .unwrap()
        .message_id
        .clone();
    state.locations.rotate_left(3);
    let mut moved = sync_cost::inbox(1, 100);
    moved[0].folder.id = "dest".into();
    moved[0].messages[0].native_message_id = None;
    moved[0].messages[0].native_thread_id = None;
    merge_snapshot(&mut state, moved).unwrap();
    assert_eq!(state.locations[0].message_id, expected);
}
