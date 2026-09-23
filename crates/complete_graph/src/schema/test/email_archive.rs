use super::*;

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
        .soup_service
        .set_raw_response(vec![soup_email_thread(thread_id)]);
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
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        *harness.email_service.archive_mutation_calls.lock().unwrap(),
        [true, false, true].map(|archived| (
            MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap(),
            thread_id,
            archived,
        ))
    );
}
