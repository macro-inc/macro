use syn::visit::Visit;

use super::ConsumedQueues;

/// A worker built through another name of its type still consumes its
/// queue.
#[test]
fn a_worker_built_under_an_imported_alias_is_seen() {
    let file = syn::parse_file(
        r#"
use sqs_worker::SQSWorker as Worker;

fn start() {
    let contacts = macro_queues::ContactsQueue::new();
    let direct = SQSWorker::new(client.clone(), contacts.to_string(), 1, 1);
    let aliased = Worker::new(client, contacts.to_string(), 1, 1);
}
"#,
    )
    .unwrap();

    let mut consumed = ConsumedQueues::default();
    consumed.visit_file(&file);

    let queues: Vec<&str> = consumed
        .worker_queues
        .iter()
        .map(|(variable, _)| variable.as_str())
        .collect();
    assert_eq!(queues, ["contacts", "contacts"]);
    assert_eq!(consumed.queue_types["contacts"], "ContactsQueue");
}
