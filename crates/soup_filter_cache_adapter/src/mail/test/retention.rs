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

async fn write_current_mail<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    query: &str,
    operation: &str,
    variables: &Map<String, Value>,
    data: &Value,
) {
    let projections = projection_updates(
        engine.schema(),
        engine.storage(),
        query,
        Some(operation),
        variables,
        data,
    )
    .await
    .unwrap();
    let projections = crate::properties::augment_authoritative(
        engine.schema(),
        engine.storage(),
        query,
        Some(operation),
        variables,
        data,
        true,
        projections,
    )
    .await
    .unwrap();
    engine
        .write_query_with_registration_and_projections(
            None,
            None,
            NetworkWrite {
                query,
                operation_name: Some(operation),
                variables,
                data,
                identity: Some(VIEWER),
            },
            projections,
        )
        .await
        .unwrap();
}

async fn stale_baseline_after_authoritative_gap<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    let page_variables = json!({"input":{"initial":{
        "filters":filters(), "sortMethod":"UPDATED_AT", "sortDirection":"DESC",
        "emailView":"INBOX", "limit":3
    }}})
    .as_object()
    .unwrap()
    .clone();
    let old_baseline = [20, 18, 16].map(|n| {
        reconciliation_baseline_entry(format!("{TYPE}:{}", id(n)), "2025-01-02T00:00:00.000002Z")
            .unwrap()
    });
    let omitted = format!("{TYPE}:{}", id(18));
    let request = || PageRequest {
        view: "INBOX".into(),
        cursor: None,
        through: None,
    };
    let soup = include_str!("reconciliation.graphql");
    for (operation, ids) in [
        ("SoupMailBackfill", vec![20, 18, 16]),
        ("Soup", vec![20, 16]),
    ] {
        let query = soup.replace("query Soup(", &format!("query {operation}("));
        let items = ids
            .into_iter()
            .map(|n| {
                let mut item = row(n);
                item["properties"] = json!([]);
                item["isFavorited"] = json!(false);
                item
            })
            .collect::<Vec<_>>();
        let data = json!({"user":{
            "id":VIEWER,"emailLinks":[{"id":id(1000)}],
            "soup":{"items":items,"nextCursor":null}
        }});
        write_current_mail(&mut engine, &query, operation, &page_variables, &data).await;
    }
    for baseline in [&[][..], old_baseline.as_slice()] {
        let PageResult::MailPage { keys, .. } = page_current(
            &mut engine,
            "generation",
            filters(),
            "UPDATED_AT",
            "DESC",
            10,
            request(),
            baseline,
        )
        .await
        .unwrap() else {
            panic!("Mail page expected")
        };
        assert!(
            !keys.contains(&omitted),
            "an older reader's baseline must not reverse authoritative negative evidence"
        );
    }

    // A partial committed update must preserve Dirty, rather than downgrade it
    // to missing metadata that would let the old baseline revive the row.
    let patch = json!({"user":{"id":VIEWER,"soup":{"items":[{
        "__typename":TYPE,"id":id(18),"inboxVisible":true,"isRead":true
    }]}}});
    write_current_mail(&mut engine, PARTIAL, "Partial", &Map::new(), &patch).await;
    let PageResult::MailPage { keys, .. } = page_current(
        &mut engine,
        "generation",
        filters(),
        "UPDATED_AT",
        "DESC",
        10,
        request(),
        &old_baseline,
    )
    .await
    .unwrap() else {
        panic!("Mail page expected")
    };
    assert!(
        !keys.contains(&omitted),
        "partial updates do not restore invalidated facts"
    );

    // A local edit started after invalidation has its own optimistic precedence.
    let variables = Map::new();
    let optimistic_data = json!({"user":{"id":VIEWER,"soup":{"items":[{
        "__typename":TYPE,"id":id(18),"inboxVisible":true,"isRead":false
    }]}}});
    let projections = optimistic_updates(
        projection_updates(
            engine.schema(),
            engine.storage(),
            PARTIAL,
            None,
            &variables,
            &optimistic_data,
        )
        .await
        .unwrap(),
    );
    let projections = crate::properties::augment_optimistic(
        engine.schema(),
        engine.storage(),
        PARTIAL,
        None,
        &variables,
        &optimistic_data,
        projections,
    )
    .await
    .unwrap();
    let (transaction, _) = engine
        .begin_optimistic_write_with_projections(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid: "00000000-0000-0000-0000-000000003118",
                query: PARTIAL,
                operation_name: None,
                variables: &variables,
                data: &optimistic_data,
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 1,
                identity_bindings: &[],
            },
            projections,
        )
        .await
        .unwrap();
    let PageResult::MailPage {
        keys, optimistic, ..
    } = page_current(
        &mut engine,
        "generation",
        filters(),
        "UPDATED_AT",
        "DESC",
        10,
        request(),
        &old_baseline,
    )
    .await
    .unwrap()
    else {
        panic!("Mail page expected")
    };
    assert!(
        keys.contains(&omitted),
        "a pending local edit overrides durable invalidation"
    );
    assert!(optimistic);
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
    let PageResult::MailPage { keys, .. } = page_current(
        &mut engine,
        "generation",
        filters(),
        "UPDATED_AT",
        "DESC",
        10,
        request(),
        &old_baseline,
    )
    .await
    .unwrap() else {
        panic!("Mail page expected")
    };
    assert!(
        !keys.contains(&omitted),
        "rollback restores the durable invalidation"
    );

    let mut restored = row(18);
    restored["properties"] = json!([]);
    restored["isFavorited"] = json!(false);
    let restore_query = soup.replace("query Soup(", "query SoupMailBackfill(");
    let restored_data = json!({"user":{
        "id":VIEWER,"emailLinks":[{"id":id(1000)}],
        "soup":{"items":[restored],"nextCursor":null}
    }});
    write_current_mail(
        &mut engine,
        &restore_query,
        "SoupMailBackfill",
        &page_variables,
        &restored_data,
    )
    .await;
    let PageResult::MailPage {
        keys,
        retained_keys,
        ..
    } = page_current(
        &mut engine,
        "generation",
        filters(),
        "UPDATED_AT",
        "DESC",
        10,
        request(),
        &old_baseline,
    )
    .await
    .unwrap()
    else {
        panic!("Mail page expected")
    };
    assert!(
        keys.contains(&omitted),
        "a fresh complete snapshot restores membership"
    );
    assert!(retained_keys.is_empty());

    let missing = format!("{TYPE}:{}", id(76));
    let partial = json!({"user":{"id":VIEWER,"soup":{"items":[{
        "__typename":TYPE,"id":id(76),"inboxVisible":true,"isRead":false
    }]}}});
    write_current_mail(&mut engine, PARTIAL, "Partial", &variables, &partial).await;
    let baseline =
        [reconciliation_baseline_entry(missing.clone(), "2026-01-01T00:00:00Z").unwrap()];
    let PageResult::MailPage {
        keys,
        retained_keys,
        ..
    } = page_current(
        &mut engine,
        "generation",
        filters(),
        "UPDATED_AT",
        "DESC",
        10,
        request(),
        &baseline,
    )
    .await
    .unwrap()
    else {
        panic!("Mail page expected")
    };
    assert!(
        keys.contains(&missing),
        "never-established metadata still retains server evidence"
    );
    assert_eq!(retained_keys, [missing]);
}

#[test]
fn an_older_reader_cannot_restore_an_authoritatively_invalidated_mail_row() {
    pollster::block_on(stale_baseline_after_authoritative_gap(
        InMemoryStorage::new(),
    ));
}

#[test]
fn turso_older_baseline_respects_invalidation_and_new_evidence() {
    pollster::block_on(stale_baseline_after_authoritative_gap(
        cache_turso::TursoStorage::open_in_memory("mail-stale-baseline").unwrap(),
    ));
}
