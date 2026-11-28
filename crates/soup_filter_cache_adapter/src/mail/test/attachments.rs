use super::*;

const WITH_ATTACHMENTS: &str = r#"query MailAttachments { user { id emailLinks { id } soup(input: {initial:{limit:100,emailView:ALL}}) { items { __typename id cacheProjection ... on GraphqlSoupEmailThread { linkId ownerId inboxVisible isRead isSignal latestInboundMessageTs reminderReturnedAt mailAllPreview { id } mailDraftPreview { id } mailSentPreview { id } updatedAt attachments { __typename id mimeType } } } } } }"#;

const ATTACHMENTS_ONLY: &str = r#"query ThreadAttachments { user { id soup(input:{initial:{limit:1}}) { items { __typename id ... on GraphqlSoupEmailThread { attachments { __typename id mimeType } } } } } }"#;

const ATTACHMENT_IDS_ONLY: &str = r#"query ThreadAttachmentIds { user { id soup(input:{initial:{limit:1}}) { items { __typename id ... on GraphqlSoupEmailThread { attachments { __typename id } } } } } }"#;

/// The MIME types of thread `n`'s attachments: a PDF on every fifth thread, a
/// PNG on every seventh, a spreadsheet on every eleventh, and on thread 9 an
/// attachment of no kind and one with no type.
fn mime_types(n: u128) -> Vec<Option<&'static str>> {
    let mut types = Vec::new();
    if n.is_multiple_of(5) {
        types.push(Some("application/pdf"));
    }
    if n.is_multiple_of(7) {
        types.push(Some("image/png"));
    }
    if n.is_multiple_of(11) {
        types.push(Some(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ));
    }
    if n == 9 {
        types.push(Some("application/zip"));
        types.push(None);
    }
    types
}

fn attachment(n: u128, index: u128, mime_type: Option<&str>) -> Value {
    json!({"__typename":"GraphqlSoupEmailAttachment","id":id(100_000 + n * 10 + index),"mimeType":mime_type})
}

fn attached_row(n: u128, types: &[Option<&str>]) -> Value {
    let mut row = row(n);
    row["attachments"] = json!(
        types
            .iter()
            .zip(0..)
            .map(|(mime_type, index)| attachment(n, index, *mime_type))
            .collect::<Vec<_>>()
    );
    row
}

fn attached_seed() -> Value {
    let mut data = seed();
    data["user"]["soup"]["items"] = json!(
        (1..=75)
            .map(|n| attached_row(n, &mime_types(n)))
            .collect::<Vec<_>>()
    );
    data
}

fn with_tree(tree: Value) -> Value {
    let mut filters = filters();
    filters["emailFilter"] = json!({ "tree": tree });
    filters
}

fn kind(kind: &str) -> Value {
    json!({"literal":{"attachment":kind}})
}

fn key(n: u128) -> String {
    format!("{TYPE}:{}", id(n))
}

/// The threads of `numbers` the ALL view lists, newest first by key as the
/// fixture's equal timestamps order them.
fn listed(numbers: impl Iterator<Item = u128>) -> Vec<String> {
    let mut keys = numbers
        // The ALL view lists the two readable inboxes (1 to 70), less the
        // thread without a message (7).
        .filter(|n| *n <= 70 && *n != 7)
        .map(key)
        .collect::<Vec<_>>();
    keys.sort_unstable_by(|a, b| b.cmp(a));
    keys
}

#[test]
fn an_attachment_kind_lists_the_threads_whose_messages_carry_one() {
    pollster::block_on(lists_threads_by_attachment_kind());
}

async fn lists_threads_by_attachment_kind() {
    let mut engine = Engine::new(InMemoryStorage::new());
    write(&mut engine, WITH_ATTACHMENTS, &attached_seed()).await;

    assert_eq!(
        all_keys(&mut engine, with_tree(kind("PDF")), "ALL").await,
        listed((1..=75).filter(|n: &u128| n.is_multiple_of(5)))
    );
    assert_eq!(
        all_keys(&mut engine, with_tree(kind("IMAGE")), "ALL").await,
        listed((1..=75).filter(|n: &u128| n.is_multiple_of(7)))
    );
    assert_eq!(
        all_keys(&mut engine, with_tree(kind("DOCUMENT")), "ALL").await,
        listed((1..=75).filter(|n: &u128| n.is_multiple_of(11)))
    );
    // Kinds OR together, as the Email view's attachment facets send them.
    assert_eq!(
        all_keys(
            &mut engine,
            with_tree(json!({"or":{"left":kind("PDF"),"right":kind("IMAGE")}})),
            "ALL"
        )
        .await,
        listed((1..=75).filter(|n: &u128| n.is_multiple_of(5) || n.is_multiple_of(7)))
    );
    // And with the Inbox view's facts, as the Inbox tab sends them.
    assert_eq!(
        all_keys(&mut engine, with_tree(kind("PDF")), "INBOX").await,
        listed((1..=75).filter(|n: &u128| n.is_multiple_of(10)))
    );
    // An attachment of no kind, or with no type, matches none (thread 9).
    for filter in ["PDF", "IMAGE", "DOCUMENT"] {
        let keys = all_keys(&mut engine, with_tree(kind(filter)), "ALL").await;
        assert!(!keys.contains(&key(9)), "{filter}");
    }
}

#[test]
fn a_pushed_thread_moves_between_attachment_lists() {
    pollster::block_on(moves_pushed_threads());
}

async fn moves_pushed_threads() {
    let mut engine = Engine::new(InMemoryStorage::new());
    write(&mut engine, WITH_ATTACHMENTS, &attached_seed()).await;

    // A new message brings thread 1 a PDF; the whole row arrives, as a push does.
    let mut update = seed();
    update["user"]["soup"]["items"] = json!([attached_row(1, &[Some("application/pdf")])]);
    write(&mut engine, WITH_ATTACHMENTS, &update).await;
    let keys = all_keys(&mut engine, with_tree(kind("PDF")), "ALL").await;
    assert!(keys.contains(&key(1)));

    // A response that reads only a thread's attachments moves it too, and
    // keeps the attachments it does not name out.
    let attachments_only = json!({"user":{"id":VIEWER,"soup":{"items":[
        {"__typename":"GraphqlSoupEmailThread","id":id(10),"attachments":[attachment(10, 5, Some("image/jpeg"))]}
    ]}}});
    write(&mut engine, ATTACHMENTS_ONLY, &attachments_only).await;
    assert!(
        !all_keys(&mut engine, with_tree(kind("PDF")), "ALL")
            .await
            .contains(&key(10))
    );
    assert!(
        all_keys(&mut engine, with_tree(kind("IMAGE")), "ALL")
            .await
            .contains(&key(10))
    );

    // A response that names attachments without their types reads the types
    // the cache already holds: thread 16 gets thread 5's PDF.
    let ids_only = json!({"user":{"id":VIEWER,"soup":{"items":[
        {"__typename":"GraphqlSoupEmailThread","id":id(16),"attachments":[
            {"__typename":"GraphqlSoupEmailAttachment","id":id(100_000 + 5 * 10)}
        ]}
    ]}}});
    write(&mut engine, ATTACHMENT_IDS_ONLY, &ids_only).await;
    assert!(
        all_keys(&mut engine, with_tree(kind("PDF")), "ALL")
            .await
            .contains(&key(16))
    );

    // A whole row without its attachments keeps the ones the cache holds.
    let mut without = seed();
    without["user"]["soup"]["items"] = json!([row(20)]);
    write(&mut engine, QUERY, &without).await;
    assert!(
        all_keys(&mut engine, with_tree(kind("PDF")), "ALL")
            .await
            .contains(&key(20))
    );
}
