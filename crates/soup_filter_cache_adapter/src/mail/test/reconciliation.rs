use super::*;

async fn server_membership<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    write(&mut engine, QUERY, &seed()).await;
    // Foreground list reads do not include the cache-only canonical previews.
    write(
        &mut engine,
        PARTIAL,
        &json!({"user":{"id":VIEWER,"soup":{"items":[
            {"__typename":TYPE,"id":id(76),"inboxVisible":true,"isRead":false},
            {"__typename":TYPE,"id":id(6),"inboxVisible":false,"isRead":false}
        ]}}}),
    )
    .await;
    let pending = format!("{TYPE}:{}", id(76));
    let archived = format!("{TYPE}:{}", id(6));
    let baseline = [pending.clone(), archived.clone()]
        .map(|key| reconciliation_baseline_entry(key, "2026-01-01T00:00:00Z").unwrap());
    let request = || PageRequest {
        view: "INBOX".into(),
        cursor: None,
        through: None,
    };
    let PageResult::MailPage {
        keys,
        retained_keys,
        sort_timestamps,
        next_cursor,
        ..
    } = page_impl(
        &mut engine,
        "generation",
        filters(),
        "UPDATED_AT",
        "DESC",
        10,
        request(),
        false,
        &baseline,
    )
    .await
    .unwrap()
    else {
        panic!("Mail page expected")
    };
    assert_eq!(keys.first(), Some(&pending));
    assert_eq!(retained_keys, vec![pending.clone()]);
    assert_eq!(sort_timestamps[0], "2026-01-01T00:00:00+00:00");
    assert!(!keys.contains(&archived));
    assert_eq!(
        keys.len(),
        11,
        "retained evidence does not shrink the indexed page"
    );
    let PageResult::MailPage { keys: next, .. } =
        read(&mut engine, filters(), "INBOX", next_cursor).await
    else {
        panic!("continuation expected")
    };
    assert!(!next.is_empty());
    assert!(
        next.iter().all(|key| !keys.contains(key)),
        "retained rows do not move the local cursor"
    );

    let mut hydrated = row(76);
    hydrated["linkId"] = json!(id(1000));
    hydrated["ownerId"] = json!(VIEWER);
    write(
        &mut engine,
        QUERY,
        &json!({"user":{"id":VIEWER,"soup":{"items":[hydrated]}}}),
    )
    .await;
    let PageResult::MailPage {
        keys,
        retained_keys,
        ..
    } = page_impl(
        &mut engine,
        "generation",
        filters(),
        "UPDATED_AT",
        "DESC",
        10,
        request(),
        false,
        &baseline,
    )
    .await
    .unwrap()
    else {
        panic!("hydrated page expected")
    };
    assert!(keys.contains(&pending));
    assert!(retained_keys.is_empty());
    assert!(!keys.contains(&archived));
}

#[test]
fn memory_retains_unhydrated_server_mail_but_removes_confirmed_nonmembers() {
    pollster::block_on(server_membership(InMemoryStorage::new()));
}

#[test]
fn turso_retains_unhydrated_server_mail_but_removes_confirmed_nonmembers() {
    pollster::block_on(server_membership(
        cache_turso::TursoStorage::open_in_memory("mail-server-membership").unwrap(),
    ));
}
