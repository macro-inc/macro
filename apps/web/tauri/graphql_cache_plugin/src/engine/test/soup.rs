use super::*;
use cache_turso::TursoFileDatabase;
use predicate_index::RecordKey;
use serde_json::{Value, json};
use soup_filter_projection::{
    MailCacheProjectionFacts, SoupCacheProjectionSupplement, encode_cache_projection_supplement,
};

const VIEWER: &str = "macro|native@example.com";
const MAIL: &str = include_str!("mail.graphql");
const PARTIAL: &str = include_str!("partial-mail.graphql");
const ROWS: &[u16] = &[4, 6, 8, 9, 10, 12];
const TIMESTAMP: &str = "2025-01-04T00:00:00Z";
const TIMESTAMP_MICROS: i64 = 1_735_948_800_000_000;

fn id(n: u16) -> String {
    format!("00000000-0000-0000-0000-{n:012}")
}
fn key(n: u16) -> String {
    format!("GraphqlSoupEmailThread:{}", id(n))
}

fn preview(n: u16, offset: u16) -> Value {
    json!({"id": id(n + offset), "subject": format!("Mail {n}"), "snippet": "preview",
        "isDraft": offset == 2000, "senderEmail": null, "senderName": null, "senderPhotoUrl": null})
}

fn row(n: u16) -> Value {
    let capsule = encode_cache_projection_supplement(&SoupCacheProjectionSupplement::mail(
        RecordKey::new(key(n)).unwrap(),
        MailCacheProjectionFacts::new(
            Some(TIMESTAMP_MICROS),
            n.is_multiple_of(4).then_some(TIMESTAMP_MICROS),
            false,
            false,
        ),
    ))
    .unwrap();
    json!({
        "__typename": "GraphqlSoupEmailThread", "id": id(n), "name": format!("Mail {n}"),
        "ownerId": VIEWER, "linkId": id(1000), "isRead": n.is_multiple_of(4),
        "inboxVisible": n.is_multiple_of(2), "isSignal": n.is_multiple_of(3),
        "cacheProjection": capsule, "latestInboundMessageTs": TIMESTAMP, "updatedAt": TIMESTAMP,
        "mailAllPreview": preview(n, 1000),
        "mailDraftPreview": n.is_multiple_of(3).then(|| preview(n, 2000)),
        "mailSentPreview": n.is_multiple_of(4).then(|| preview(n, 3000)),
    })
}

fn seed() -> Value {
    json!({"user": {"id": VIEWER, "emailLinks": [{"id": id(1000)}], "soup": {
        "items": ROWS.iter().copied().map(row).collect::<Vec<_>>(), "nextCursor": null,
    }}})
}

fn filters() -> Value {
    let nil = id(0);
    json!({
        "documentFilter": {"literal": {"id": nil}},
        "projectFilter": {"literal": {"projectId": nil}},
        "chatFilter": {"literal": {"chatId": nil}},
        "calendarEventFilter": {"literal": {"id": nil}},
        "channelFilter": {"literal": {"channelId": nil}},
        "channelThreadFilter": {"literal": {"channelId": nil}},
        "reminderFilter": {"literal": {"id": nil}},
        "agentSessionFilter": {"literal": {"id": nil}},
        "callFilter": {"literal": {"callId": nil}},
        "crmCompanyFilter": {"literal": {"id": nil}},
        "foreignEntityFilter": {"literal": {"id": nil}},
    })
}

fn request(
    view: &str,
    importance: Option<bool>,
    limit: u16,
    cursor: Option<&str>,
) -> EntityFilterRequest {
    let mut filters = filters();
    if let Some(importance) = importance {
        filters["emailFilter"] = json!({"tree": {"literal": {"importance": importance}}});
    }
    serde_json::from_value(json!({"filters": filters, "sortMethod": "UPDATED_AT",
        "sortDirection": "DESC", "limit": limit, "mail": {"view": view, "cursor": cursor}}))
    .unwrap()
}

fn evaluate(handle: &EngineHandle, request: EntityFilterRequest) -> Value {
    serde_json::to_value(block_on(handle.entity_filter(request)).unwrap()).unwrap()
}

fn keys(page: &Value) -> Vec<String> {
    assert_eq!(page["kind"], "mail-page", "{page}");
    serde_json::from_value(page["keys"].clone()).unwrap()
}

fn hydrate(handle: &EngineHandle) {
    let result = block_on(handle.hydrate_query(
        MAIL.into(),
        Some("NativeMailBackfill".into()),
        Variables::new(),
        seed(),
        Some(VIEWER.into()),
    ))
    .unwrap();
    assert_eq!(
        result.data,
        Some(json!({"user": {"soup": {"nextCursor": null}}}))
    );
}

fn patch(viewer: &str, n: u16, inbox: bool) -> Value {
    json!({"user": {"id": viewer, "emailLinks": [{"id": id(1000)}], "soup": {"items": [{
        "__typename": "GraphqlSoupEmailThread", "id": id(n), "isRead": true, "inboxVisible": inbox,
    }]}}})
}

fn write_data(
    handle: &EngineHandle,
    query: &str,
    data: Value,
    identity: Option<&str>,
) -> WriteResultWire {
    block_on(handle.write(WriteRequest {
        origin_op_id: None,
        registration: None,
        query: query.into(),
        operation_name: None,
        variables: Variables::new(),
        data,
        identity: identity.map(str::to_owned),
    }))
    .unwrap()
}

#[test]
fn native_backfill_evaluates_unseen_mail_filters_without_query_baselines() {
    let handle = spawn_handle();
    assert_eq!(
        evaluate(&handle, request("ALL", None, 100, None))["kind"],
        "incomplete"
    );
    hydrate(&handle);
    for (view, importance, expected) in [
        ("INBOX", Some(true), vec![12, 6]),
        ("INBOX", Some(false), vec![10, 8, 4]),
        ("ALL", None, vec![12, 10, 9, 8, 6, 4]),
        ("DRAFTS", None, vec![12, 9, 6]),
        ("SENT", None, vec![12, 8, 4]),
    ] {
        let page = evaluate(&handle, request(view, importance, 100, None));
        assert_eq!(
            keys(&page),
            expected.into_iter().map(key).collect::<Vec<_>>()
        );
        assert_eq!(
            page["sortTimestamps"].as_array().unwrap().len(),
            keys(&page).len()
        );
        assert_eq!(page["optimistic"], false);
    }
    let mut unread = request("ALL", None, 100, None);
    unread.filters["emailFilter"] = json!({"tree": {"literal": {"read": false}}});
    assert_eq!(
        keys(&evaluate(&handle, unread)),
        vec![key(10), key(9), key(6)]
    );
}

#[test]
fn native_mail_pagination_and_revision_bound_cursors() {
    let handle = spawn_handle();
    write_data(&handle, MAIL, seed(), Some(VIEWER));
    let first = evaluate(&handle, request("ALL", None, 2, None));
    let first_cursor = first["nextCursor"].as_str().unwrap();
    let second = evaluate(&handle, request("ALL", None, 2, Some(first_cursor)));
    let third = evaluate(
        &handle,
        request("ALL", None, 2, second["nextCursor"].as_str()),
    );
    assert_eq!(
        [keys(&first), keys(&second), keys(&third)].concat(),
        vec![12, 10, 9, 8, 6, 4]
            .into_iter()
            .map(key)
            .collect::<Vec<_>>()
    );
    assert!(third["nextCursor"].is_null());
    assert_eq!(
        evaluate(&handle, request("INBOX", None, 2, Some(first_cursor)))["kind"],
        "stale-cursor"
    );
    write_data(&handle, PARTIAL, patch(VIEWER, 4, false), None);
    assert_eq!(
        evaluate(&handle, request("ALL", None, 2, Some(first_cursor)))["kind"],
        "stale-cursor"
    );
    assert!(block_on(handle.entity_filter(request("ALL", None, 2, Some("not a cursor")))).is_err());
}

#[test]
fn native_mail_projections_persist_and_reopen_with_a_new_cursor_generation() {
    let dir = tempfile::tempdir().unwrap();
    let database = TursoFileDatabase::new(dir.path().join("cache.turso")).unwrap();
    let handle = EngineHandle::new(database.open_or_reset("native-mail").unwrap(), None);
    hydrate(&handle);
    let page = evaluate(&handle, request("ALL", None, 2, None));
    let generation = handle.mail_generation.clone();
    handle.shutdown().unwrap();
    let reopened = EngineHandle::new(database.open_or_reset("native-mail").unwrap(), None);
    assert_ne!(generation, reopened.mail_generation);
    assert_eq!(
        keys(&evaluate(
            &reopened,
            request("INBOX", Some(false), 100, None)
        )),
        vec![key(10), key(8), key(4)]
    );
    assert_eq!(
        evaluate(
            &reopened,
            request("ALL", None, 2, page["nextCursor"].as_str())
        )["kind"],
        "stale-cursor"
    );
    reopened.shutdown().unwrap();
}

#[test]
fn native_invalidation_and_deletion_do_not_leave_stale_mail_candidates() {
    let handle = spawn_handle();
    hydrate(&handle);
    block_on(handle.invalidate(vec![key(4)])).unwrap();
    assert_eq!(
        keys(&evaluate(&handle, request("INBOX", Some(false), 100, None))),
        vec![key(10), key(8)]
    );
    hydrate(&handle);
    assert_eq!(
        keys(&evaluate(&handle, request("INBOX", Some(false), 100, None))),
        vec![key(10), key(8), key(4)]
    );
    block_on(handle.delete_records(vec![key(4)])).unwrap();
    assert_eq!(
        keys(&evaluate(&handle, request("INBOX", Some(false), 100, None))),
        vec![key(10), key(8)]
    );
    block_on(handle.clear()).unwrap();
    assert_eq!(
        evaluate(&handle, request("ALL", None, 100, None))["kind"],
        "incomplete"
    );
}

fn enqueue_archive(handle: &EngineHandle, n: u16) -> (String, String) {
    let result = block_on(handle.enqueue_optimistic_mutation(
        None,
        "00000000-0000-7000-8000-000000000001".into(),
        PARTIAL.into(),
        None,
        Variables::new(),
        patch(VIEWER, n, false),
        vec![],
        vec![],
        0,
        "native-runner".into(),
        10,
        1000,
    ))
    .unwrap();
    let InitialMutationClaimWire::Claimed { mutation } = result.initial_claim else {
        panic!("claim expected")
    };
    (result.transaction_id, mutation.lease_generation)
}

#[test]
fn native_optimistic_archive_rollback_and_commit_update_filter_membership() {
    let handle = spawn_handle();
    hydrate(&handle);
    let (transaction, generation) = enqueue_archive(&handle, 4);
    let optimistic = evaluate(&handle, request("INBOX", Some(false), 100, None));
    assert_eq!(keys(&optimistic), vec![key(10), key(8)]);
    assert_eq!(optimistic["optimistic"], true);
    block_on(handle.rollback_optimistic_write(transaction, "native-runner".into(), generation))
        .unwrap();
    assert_eq!(
        keys(&evaluate(&handle, request("INBOX", Some(false), 100, None))),
        vec![key(10), key(8), key(4)]
    );
    let (transaction, generation) = enqueue_archive(&handle, 4);
    block_on(handle.commit_optimistic_write(
        transaction,
        "native-runner".into(),
        generation,
        PARTIAL.into(),
        None,
        Variables::new(),
        patch(VIEWER, 4, false),
    ))
    .unwrap();
    let committed = evaluate(&handle, request("INBOX", Some(false), 100, None));
    assert_eq!(keys(&committed), vec![key(10), key(8)]);
    assert_eq!(committed["optimistic"], false);
}

#[test]
fn native_optimistic_mail_membership_survives_engine_restart() {
    let dir = tempfile::tempdir().unwrap();
    let database = TursoFileDatabase::new(dir.path().join("cache.turso")).unwrap();
    let handle = EngineHandle::new(database.open_or_reset("queued-mail").unwrap(), None);
    hydrate(&handle);
    let (transaction, generation) = enqueue_archive(&handle, 4);
    handle.shutdown().unwrap();
    let reopened = EngineHandle::new(database.open_or_reset("queued-mail").unwrap(), None);
    let page = evaluate(&reopened, request("INBOX", Some(false), 100, None));
    assert_eq!(keys(&page), vec![key(10), key(8)]);
    assert_eq!(page["optimistic"], true);
    block_on(reopened.rollback_optimistic_write(transaction, "native-runner".into(), generation))
        .unwrap();
    assert_eq!(
        keys(&evaluate(
            &reopened,
            request("INBOX", Some(false), 100, None)
        )),
        vec![key(10), key(8), key(4)]
    );
    reopened.shutdown().unwrap();
}

#[test]
fn native_identity_switch_does_not_borrow_old_mail_projection_inputs() {
    for hydration in [false, true] {
        let handle = spawn_handle();
        hydrate(&handle);
        let data = patch("macro|new@example.com", 4, true);
        let reset = if hydration {
            block_on(handle.hydrate_query(
                PARTIAL.into(),
                None,
                Variables::new(),
                data,
                Some("macro|new@example.com".into()),
            ))
            .unwrap()
            .write_result
            .reset
        } else {
            write_data(&handle, PARTIAL, data, Some("macro|new@example.com")).reset
        };
        assert!(reset);
        assert!(
            keys(&evaluate(&handle, request("ALL", None, 100, None))).is_empty(),
            "partial new-viewer data cannot borrow old-viewer proof"
        );
    }
}

#[test]
fn native_general_soup_filter_and_server_baseline_reconciliation() {
    let handle = spawn_handle();
    let project_key = format!("GraphqlSoupProject:{}", id(100));
    write_data(
        &handle,
        include_str!("project.graphql"),
        json!({"user": {"id": VIEWER, "soup": {
            "items": [{"__typename": "GraphqlSoupProject", "id": id(100), "cacheProjection": null,
                "ownerId": VIEWER, "parentId": null, "createdAt": TIMESTAMP, "updatedAt": TIMESTAMP,
                "notifications": []}],
        }}}),
        Some(VIEWER),
    );
    let general_request = || {
        let mut request = request("ALL", None, 100, None);
        request.mail = None;
        request.filters["emailFilter"] = json!({"tree": {"literal": {"threadId": id(0)}}});
        request.filters["projectFilter"] = json!({"literal": {"projectIdSelf": id(100)}});
        request
    };
    let complete = evaluate(&handle, general_request());
    assert_eq!(complete["kind"], "complete");
    assert_eq!(complete["keys"], json!([project_key]));
    block_on(handle.invalidate(vec![project_key.clone()])).unwrap();
    let mut reconciled = general_request();
    reconciled.baseline = Some(vec![PredicateBaselineEntry {
        key: project_key.clone(),
        sort_timestamp: TIMESTAMP.into(),
    }]);
    let page = evaluate(&handle, reconciled);
    assert_eq!(page["kind"], "reconciled");
    assert_eq!(page["keys"], json!([project_key]));
    assert_eq!(page["retainedKeys"], json!([project_key]));
    let mut too_many = general_request();
    too_many.baseline = Some(
        (0..5001)
            .map(|_| PredicateBaselineEntry {
                key: project_key.clone(),
                sort_timestamp: TIMESTAMP.into(),
            })
            .collect(),
    );
    let error = block_on(handle.entity_filter(too_many)).err().unwrap();
    assert_eq!(error, "reconciliation baseline is too large");
    let mut unsupported = general_request();
    unsupported.sort_method = "VIEWED_UPDATED".into();
    assert_eq!(evaluate(&handle, unsupported)["kind"], "unsupported");
}

#[test]
fn native_mail_confinement_never_admits_nonempty_deferred_partitions() {
    let handle = spawn_handle();
    hydrate(&handle);
    for (partition, id_field) in [
        ("reminderFilter", "id"),
        ("agentSessionFilter", "id"),
        ("channelThreadFilter", "channelId"),
    ] {
        for tree in [
            json!({"literal": {id_field: id(999)}}),
            json!({"not": {"literal": {id_field: id(0)}}}),
            json!({"or": {"left": {"literal": {id_field: id(0)}}, "right": {"literal": {id_field: id(999)}}}}),
        ] {
            let mut query = request("ALL", None, 100, None);
            query.filters[partition] = tree;
            assert_eq!(
                evaluate(&handle, query)["kind"],
                "unsupported",
                "{partition}"
            );
        }
    }
}

#[test]
fn native_filter_rejects_malformed_requests_and_preserves_unsupported() {
    let handle = spawn_handle();
    hydrate(&handle);
    assert!(block_on(handle.entity_filter(request("ALL", None, 0, None))).is_err());
    let mut unsupported = request("ALL", None, 100, None);
    unsupported.sort_method = "VIEWED_UPDATED".into();
    assert_eq!(evaluate(&handle, unsupported)["kind"], "unsupported");
    assert!(
        serde_json::from_value::<EntityFilterRequest>(json!({
            "filters": {}, "sortMethod": "UPDATED_AT", "sortDirection": "DESC", "limit": -1,
        }))
        .is_err()
    );
}
