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
    let PageResult::MailPage {
        keys: next,
        end_cursor: through,
        ..
    } = read(&mut engine, filters(), "INBOX", next_cursor).await
    else {
        panic!("continuation expected")
    };
    assert!(!next.is_empty());
    assert!(
        next.iter().all(|key| !keys.contains(key)),
        "retained rows do not move the local cursor"
    );

    // A retained row below the indexed cursor must stay last when reading
    // through the next page, without moving either continuation boundary.
    let mut older = baseline.clone();
    older[0] = reconciliation_baseline_entry(pending.clone(), "2024-01-01T00:00:00Z").unwrap();
    let through_request = || PageRequest {
        view: "INBOX".into(),
        cursor: None,
        through: through.clone(),
    };
    let PageResult::MailPage {
        keys,
        sort_timestamps,
        next_cursor,
        end_cursor,
        ..
    } = page_impl(
        &mut engine,
        "generation",
        filters(),
        "UPDATED_AT",
        "DESC",
        20,
        through_request(),
        false,
        &older,
    )
    .await
    .unwrap()
    else {
        panic!("through page expected")
    };
    assert_eq!(keys.last(), Some(&pending));
    assert!(
        sort_timestamps
            .windows(2)
            .all(|pair| micros(&pair[0]) >= micros(&pair[1]))
    );
    let PageResult::MailPage {
        next_cursor: indexed_next,
        end_cursor: indexed_end,
        ..
    } = page_impl(
        &mut engine,
        "generation",
        filters(),
        "UPDATED_AT",
        "DESC",
        20,
        through_request(),
        false,
        &[],
    )
    .await
    .unwrap()
    else {
        panic!("indexed page expected")
    };
    assert_eq!(next_cursor, indexed_next);
    assert_eq!(end_cursor, indexed_end);

    // Act on the incomplete row itself, not a different hydrated thread.
    let archived_data = json!({"user":{"id":VIEWER,"soup":{"items":[
        {"__typename":TYPE,"id":id(76),"inboxVisible":false,"isRead":false}
    ]}}});
    let vars = Map::new();
    let updates = projection_updates(
        cache_core::meta::bundled_schema_ref(),
        engine.storage(),
        PARTIAL,
        None,
        &vars,
        &archived_data,
    )
    .await
    .unwrap();
    let (transaction, _) = engine
        .begin_optimistic_write_with_projections(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid: "00000000-0000-0000-0000-000000003076",
                query: PARTIAL,
                operation_name: None,
                variables: &vars,
                data: &archived_data,
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 1,
                identity_bindings: &[],
            },
            optimistic_updates(updates),
        )
        .await
        .unwrap();
    let PageResult::MailPage { keys, .. } = page_impl(
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
    .unwrap() else {
        panic!("Mail page expected")
    };
    assert!(
        !keys.contains(&pending),
        "optimistic archive must override unknown metadata"
    );
    let claim = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: 1,
            lease_expires_at_ms: 100,
        })
        .await
        .unwrap()
        .unwrap();
    engine
        .rollback_optimistic_write(
            transaction,
            MutationClaimToken {
                owner: "test".into(),
                generation: claim.lease_generation,
            },
        )
        .await
        .unwrap();
    let PageResult::MailPage { keys, .. } = page_impl(
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
    .unwrap() else {
        panic!("Mail page expected")
    };
    assert!(
        keys.contains(&pending),
        "rollback restores the retained row"
    );
    write(&mut engine, PARTIAL, &archived_data).await;
    let PageResult::MailPage { keys, .. } = page_impl(
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
    .unwrap() else {
        panic!("Mail page expected")
    };
    assert!(
        !keys.contains(&pending),
        "committed partial archive must still exclude the row"
    );

    write(
        &mut engine,
        PARTIAL,
        &json!({"user":{"id":VIEWER,"soup":{"items":[
            {"__typename":TYPE,"id":id(76),"inboxVisible":true,"isRead":true}
        ]}}}),
    )
    .await;
    let mut unread = filters();
    unread["emailFilter"] = json!({"tree":{"literal":{"read":false}}});
    let PageResult::MailPage { keys, .. } = page_impl(
        &mut engine,
        "generation",
        unread,
        "UPDATED_AT",
        "DESC",
        10,
        request(),
        false,
        &baseline,
    )
    .await
    .unwrap() else {
        panic!("Mail page expected")
    };
    assert!(
        !keys.contains(&pending),
        "known read state must disprove unread membership"
    );

    // A known false branch does not disprove an OR whose other facts are
    // missing. Conversely NOT of a known true flag proves non-membership.
    for (tree, retained) in [
        (
            json!({"or":{"left":{"literal":{"read":false}},"right":{"literal":{"calendarOnly":true}}}}),
            true,
        ),
        (
            json!({"and":{"left":{"literal":{"read":true}},"right":{"literal":{"calendarOnly":true}}}}),
            true,
        ),
        (json!({"not":{"literal":{"read":true}}}), false),
    ] {
        let mut compound = filters();
        compound["emailFilter"] = json!({"tree":tree});
        let PageResult::MailPage { keys, .. } = page_impl(
            &mut engine,
            "generation",
            compound,
            "UPDATED_AT",
            "DESC",
            10,
            request(),
            false,
            &baseline,
        )
        .await
        .unwrap() else {
            panic!("Mail page expected")
        };
        assert_eq!(keys.contains(&pending), retained);
    }

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

#[test]
fn maximum_baseline_does_not_count_indexed_rows_again() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(&mut engine, QUERY, &seed()).await;
        let baseline = (1000..6000)
            .map(|n| {
                reconciliation_baseline_entry(format!("{TYPE}:{}", id(n)), "2026-01-01T00:00:00Z")
                    .unwrap()
            })
            .collect::<Vec<_>>();
        let PageResult::MailPage { keys, .. } = page_impl(
            &mut engine,
            "generation",
            filters(),
            "UPDATED_AT",
            "DESC",
            10,
            PageRequest {
                view: "INBOX".into(),
                cursor: None,
                through: None,
            },
            false,
            &baseline,
        )
        .await
        .unwrap() else {
            panic!("Mail page expected")
        };
        assert_eq!(keys.len(), 10);
    });
}
