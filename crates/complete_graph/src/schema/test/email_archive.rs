use super::*;

#[tokio::test]
async fn thread_read_repository_errors_are_masked_before_soup_lookup() {
    let harness = harness();
    *harness.email_service.thread_read_fails.lock().unwrap() = true;
    let response = harness
        .execute(&format!(
            r#"{{ user {{ emailThread(input: {{threadId: "{}"}}) {{id}} }} }}"#,
            Uuid::from_u128(44),
        ))
        .await;
    assert_eq!(response.errors.len(), 1);
    let error = &response.errors[0];
    assert_eq!(error.message, "email draft mutation failed");
    assert_eq!(
        error.extensions.as_ref().unwrap().get("code"),
        Some(&async_graphql::Value::from("INTERNAL"))
    );
    assert!(!format!("{response:?}").contains("private repository diagnostic"));
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn ordinary_email_queries_use_the_replica_while_mutations_reload_from_primary() {
    let harness = harness();
    let id = Uuid::from_u128(44);
    harness
        .thread_reader
        .set_threads(vec![soup_email_thread(id)]);
    let query = format!(
        r#"{{ user {{ emailThread(input: {{threadId: "{id}"}}) {{isRead inboxVisible}} }} }}"#
    );
    let before = harness.execute(&query).await;
    assert!(before.errors.is_empty(), "{:?}", before.errors);
    let before = before.data.into_json().unwrap();
    assert_eq!(before["user"]["emailThread"]["isRead"], false);
    assert_eq!(before["user"]["emailThread"]["inboxVisible"], true);
    assert_eq!(harness.thread_reads.load(Ordering::SeqCst), 1);

    let mutation = harness.execute_authenticated_mutation(&format!(
        r#"mutation {{
            seen: markEmailThreadSeen(input: {{threadId: "{id}"}}) {{isRead}}
            archived: setEmailThreadArchived(input: {{threadId: "{id}", archived: true}}) {{isRead inboxVisible}}
        }}"#
    )).await;
    assert!(mutation.errors.is_empty(), "{:?}", mutation.errors);
    let mutation = mutation.data.into_json().unwrap();
    assert_eq!(mutation["seen"]["isRead"], true);
    assert_eq!(mutation["archived"]["isRead"], true);
    assert_eq!(mutation["archived"]["inboxVisible"], false);
    // Neither mutation consulted the lagging replica reader.
    assert_eq!(harness.thread_reads.load(Ordering::SeqCst), 1);

    let after = harness.execute(&query).await;
    assert!(after.errors.is_empty(), "{:?}", after.errors);
    assert_eq!(after.data.into_json().unwrap(), before);
    assert_eq!(harness.thread_reads.load(Ordering::SeqCst), 2);

    // Normal reads catch up only when the replica does, not by silently
    // escalating their pool after a mutation.
    let SoupItem::EmailThread(mut replica) = soup_email_thread_with_read_status(id, true) else {
        unreachable!()
    };
    replica.thread.inbox_visible = false;
    harness
        .thread_reader
        .set_threads(vec![SoupItem::EmailThread(replica)]);
    let caught_up = harness.execute(&query).await;
    assert!(caught_up.errors.is_empty(), "{:?}", caught_up.errors);
    let caught_up = caught_up.data.into_json().unwrap();
    assert_eq!(caught_up["user"]["emailThread"]["isRead"], true);
    assert_eq!(caught_up["user"]["emailThread"]["inboxVisible"], false);
}

#[tokio::test]
async fn sequential_read_mutations_do_not_reuse_the_first_mutation_snapshot() {
    let harness = harness();
    let id = Uuid::from_u128(44);
    let response = harness
        .execute_authenticated_mutation(&format!(
            r#"mutation {{ seen: markEmailThreadSeen(input: {{threadId: "{id}"}}) {{isRead}}
        unread: markEmailThreadUnread(input: {{threadId: "{id}"}}) {{isRead}} }}"#
        ))
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["seen"]["isRead"], true);
    assert_eq!(data["unread"]["isRead"], false);
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn archive_undo_and_redo_return_primary_state_without_reading_the_soup_replica() {
    let harness = harness();
    let thread_id = Uuid::from_u128(44);
    // The replica never changes during these writes.
    harness
        .thread_reader
        .set_threads(vec![soup_email_thread(thread_id)]);
    for archived in [true, false, true] {
        let response = harness.execute_authenticated_mutation(&format!(
            r#"mutation {{ setEmailThreadArchived(input: {{threadId: "{thread_id}", archived: {archived}}}) {{__typename id inboxVisible}} }}"#
        )).await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let data = response.data.into_json().unwrap();
        let thread = &data["setEmailThreadArchived"];
        assert_eq!(thread["__typename"], "GraphqlSoupEmailThread");
        assert_eq!(thread["id"], thread_id.to_string());
        assert_eq!(thread["inboxVisible"], !archived);
    }
    assert_eq!(harness.thread_reads.load(Ordering::SeqCst), 0);
    assert_eq!(
        *harness.email_service.archive_mutation_calls.lock().unwrap(),
        [true, false, true].map(|archived| (
            MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
            thread_id,
            archived,
        ))
    );
}
