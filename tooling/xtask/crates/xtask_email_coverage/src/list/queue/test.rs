use super::ConsumedQueues;

/// A worker built through another name of its type still consumes its
/// queue.
#[test]
fn a_worker_built_under_an_imported_alias_is_seen() {
    let file = syn::parse_file(
        r#"
fn start() {
    let contacts = macro_queues::ContactsQueue::new();
    let direct = SQSWorker::new(client.clone(), contacts.to_string(), 1, 1);
    let aliased = Worker::new(client, contacts.to_string(), 1, 1);
}

// After its use: an import is in scope for the whole module.
use sqs_worker::SQSWorker as Worker;
"#,
    )
    .unwrap();

    let consumed = ConsumedQueues::of(&file);

    let queues: Vec<&str> = consumed
        .worker_queues
        .iter()
        .map(|(variable, _)| variable.as_str())
        .collect();
    assert_eq!(queues, ["contacts", "contacts"]);
    assert_eq!(consumed.queue_types["contacts"], "ContactsQueue");
}

/// A worker's variable that is bound again to something else no longer
/// says which queue the worker reads.
#[test]
fn a_shadowed_queue_variable_is_ambiguous() {
    let file = syn::parse_file(
        r#"
fn start() {
    let queue = macro_queues::ContactsQueue::new();
    let queue: String = other_queue_url;
    let worker = SQSWorker::new(client, queue.to_string(), 1, 1);
}
"#,
    )
    .unwrap();

    let consumed = ConsumedQueues::of(&file);

    assert_eq!(
        consumed.ambiguous.map(|(variable, _)| variable),
        Some("queue".to_owned())
    );
}
