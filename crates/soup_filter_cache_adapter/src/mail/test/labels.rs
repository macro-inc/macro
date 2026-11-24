use super::*;

const LABELED: &str = r#"query MailLabels { user { id emailLinks { id } soup(input: {initial:{limit:100,emailView:ALL}}) { items { __typename id cacheProjection ... on GraphqlSoupEmailThread { linkId ownerId inboxVisible isRead isSignal latestInboundMessageTs reminderReturnedAt mailAllPreview { id } mailDraftPreview { id } mailSentPreview { id } updatedAt labels { __typename id } } } } } }"#;

/// A label made in the viewer's own inbox, on every sixth thread.
const MADE: u128 = 5000;
/// One of Gmail's system labels, which a shared thread's reader also sees.
const SYSTEM: u128 = 5001;

fn labeled_row(n: u128, labels: &[u128]) -> Value {
    let mut row = row(n);
    row["labels"] = json!(
        labels
            .iter()
            .map(|label| json!({"__typename":"GraphqlSoupEmailLabel","id":id(*label)}))
            .collect::<Vec<_>>()
    );
    row
}

fn labels_of(n: u128) -> Vec<u128> {
    let mut labels = Vec::new();
    if n.is_multiple_of(6) {
        labels.push(MADE);
    }
    // Thread 72 is shared from an inbox the viewer neither owns nor manages.
    if n == 10 || n == 72 {
        labels.push(SYSTEM);
    }
    labels
}

fn labeled_seed() -> Value {
    let mut data = seed();
    data["user"]["soup"]["items"] = json!(
        (1..=75)
            .map(|n| labeled_row(n, &labels_of(n)))
            .collect::<Vec<_>>()
    );
    data
}

fn with_tree(tree: Value) -> Value {
    let mut filters = filters();
    filters["emailFilter"] = json!({ "tree": tree });
    filters
}

fn label(n: u128) -> Value {
    json!({"literal":{"label":id(n)}})
}

#[test]
fn a_label_lists_the_threads_that_carry_it_in_the_viewers_inboxes() {
    pollster::block_on(lists_labeled_threads());
}

async fn lists_labeled_threads() {
    let mut engine = Engine::new(InMemoryStorage::new());
    write(&mut engine, LABELED, &labeled_seed()).await;

    // Every sixth thread of the two readable inboxes (6 to 66).
    assert_eq!(
        all_keys(&mut engine, with_tree(label(MADE)), "ALL")
            .await
            .len(),
        11
    );
    assert_eq!(
        all_keys(
            &mut engine,
            with_tree(json!({"or":{"left":label(MADE),"right":label(SYSTEM)}})),
            "ALL"
        )
        .await
        .len(),
        12
    );
    // A shared thread can carry Gmail's system labels, but a label matches only
    // in an inbox the viewer owns or manages, as on the server.
    let shared = json!({"and":{"left":label(SYSTEM),"right":{"literal":{"shared":"INCLUDE"}}}});
    let keys = all_keys(&mut engine, with_tree(shared), "ALL").await;
    assert_eq!(keys, vec![format!("{TYPE}:{}", id(10))]);

    // Taking the label off one thread and putting it on another moves them.
    let mut update = seed();
    update["user"]["soup"]["items"] = json!([labeled_row(6, &[]), labeled_row(1, &[MADE])]);
    write(&mut engine, LABELED, &update).await;
    let keys = all_keys(&mut engine, with_tree(label(MADE)), "ALL").await;
    assert_eq!(keys.len(), 11);
    assert!(keys.contains(&format!("{TYPE}:{}", id(1))));
    assert!(!keys.contains(&format!("{TYPE}:{}", id(6))));
}
