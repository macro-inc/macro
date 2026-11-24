use super::*;
use macro_event_broker::{EventBrokerError, MacroEvent};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, thiserror::Error)]
#[error("test persistence or enqueue failure")]
struct TestError;

#[derive(Debug, PartialEq, Eq)]
enum Call {
    Inbox(String, Uuid),
    Label(Uuid, Uuid),
    Messages(Vec<Uuid>, String),
    Stage,
    Event,
    Enqueue,
    Revert(Uuid, Vec<Uuid>, Vec<Uuid>, Uuid),
    Facts(Uuid, Uuid),
    Command,
}

type Calls = std::sync::Arc<Mutex<Vec<Call>>>;

struct Repository {
    calls: Calls,
    inbox: Option<MessageLabelInbox>,
    label: Option<MessageLabelDefinition>,
    messages: Vec<MessageLabelTarget>,
    provider_messages: Vec<(Uuid, String)>,
    restored: Result<Vec<Uuid>, TestError>,
    staged: Mutex<Vec<StagedLabelWrite>>,
    /// Each Outlook message's facts beside its thread.
    facts: Vec<(Uuid, MailboxActionMessage)>,
    command_fails: bool,
    /// A failed command found the inbox locked past the lock timeout.
    command_contended: bool,
    commands: Mutex<Vec<Command>>,
}

#[derive(Debug)]
struct Command {
    link_id: Uuid,
    actor: String,
    action: MailboxAction,
    targets: Vec<Uuid>,
}

impl MessageLabelRepository for Repository {
    type Err = TestError;

    fn is_contended(&self, _: &TestError) -> bool {
        self.command_contended
    }

    async fn inbox_for_message(
        &self,
        caller: &str,
        id: Uuid,
    ) -> Result<Option<MessageLabelInbox>, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Inbox(caller.into(), id));
        Ok(self.inbox.clone())
    }

    async fn label(
        &self,
        id: Uuid,
        link_id: Uuid,
    ) -> Result<Option<MessageLabelDefinition>, Self::Err> {
        self.calls.lock().unwrap().push(Call::Label(id, link_id));
        Ok(self.label.clone())
    }

    async fn messages(
        &self,
        ids: &[Uuid],
        caller: &str,
    ) -> Result<Vec<MessageLabelTarget>, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Messages(ids.to_vec(), caller.into()));
        Ok(self.messages.clone())
    }

    async fn stage(&self, write: StagedLabelWrite) -> Result<Vec<(Uuid, String)>, StageFailure> {
        self.calls.lock().unwrap().push(Call::Stage);
        self.staged.lock().unwrap().push(write);
        Ok(self.provider_messages.clone())
    }

    async fn revert_unsent(
        &self,
        link: Uuid,
        threads: &[Uuid],
        messages: &[Uuid],
        write: Uuid,
    ) -> Result<Vec<Uuid>, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Revert(link, threads.into(), messages.into(), write));
        self.restored.clone()
    }

    async fn mailbox_action_messages(
        &self,
        link_id: Uuid,
        thread_id: Uuid,
    ) -> Result<Vec<MailboxActionMessage>, Self::Err> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Facts(link_id, thread_id));
        Ok(self
            .facts
            .iter()
            .filter(|(thread, _)| *thread == thread_id)
            .map(|(_, fact)| fact.clone())
            .collect())
    }

    async fn enqueue_mailbox_action(
        &self,
        link_id: Uuid,
        actor: MacroUserIdStr<'static>,
        action: &MailboxAction,
        targets: &[MailboxActionTarget],
    ) -> Result<Uuid, Self::Err> {
        self.calls.lock().unwrap().push(Call::Command);
        self.commands.lock().unwrap().push(Command {
            link_id,
            actor: actor.to_string(),
            action: action.clone(),
            targets: targets.iter().map(|t| t.message_id).collect(),
        });
        if self.command_fails {
            Err(TestError)
        } else {
            Ok(Uuid::from_u128(99))
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct ProviderWrite {
    link_id: Uuid,
    messages: Vec<(Uuid, String)>,
    add: Vec<String>,
    remove: Vec<String>,
    write_id: Uuid,
}

struct Enqueuer {
    calls: Calls,
    fail: bool,
    writes: Mutex<Vec<ProviderWrite>>,
}

impl EmailMessageEnqueuer for Enqueuer {
    type Err = TestError;
    const MAX_LABEL_WRITE_MESSAGES: usize = 1000;

    async fn enqueue_scheduled_message(
        &self,
        _: Uuid,
        _: Uuid,
        _: Option<i32>,
    ) -> Result<(), Self::Err> {
        panic!("unexpected scheduled message")
    }

    async fn enqueue_gmail_ops_modify_labels_batch(
        &self,
        link_id: Uuid,
        messages: Vec<(Uuid, String)>,
        add: Vec<String>,
        remove: Vec<String>,
        write_id: Uuid,
    ) -> Result<(), Self::Err> {
        self.calls.lock().unwrap().push(Call::Enqueue);
        self.writes.lock().unwrap().push(ProviderWrite {
            link_id,
            messages,
            add,
            remove,
            write_id,
        });
        if self.fail { Err(TestError) } else { Ok(()) }
    }

    async fn enqueue_gmail_ops_block_sender(&self, _: Uuid, _: String) -> Result<(), Self::Err> {
        panic!("unexpected sender block")
    }

    async fn enqueue_gmail_ops_unblock_sender(&self, _: Uuid, _: String) -> Result<(), Self::Err> {
        panic!("unexpected sender unblock")
    }
}

struct Broker {
    calls: Calls,
    events: Mutex<Vec<serde_json::Value>>,
}

impl MacroEventBroker for Broker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.calls.lock().unwrap().push(Call::Event);
        self.events
            .lock()
            .unwrap()
            .push(serde_json::to_value(event.event()).unwrap());
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

// Explicit fixture values keep request order and database order independently visible.
fn service() -> MessageLabelService<Repository, Enqueuer, Broker> {
    let calls = Calls::default();
    MessageLabelService {
        repository: Repository {
            calls: calls.clone(),
            inbox: Some(MessageLabelInbox {
                id: Uuid::from_u128(1),
                macro_id: MacroUserIdStr::try_from("macro|owner@example.com").unwrap(),
                provider: UserProvider::Gmail,
            }),
            label: Some(MessageLabelDefinition {
                id: Some(Uuid::from_u128(2)),
                provider_label_id: "Label_3".into(),
                name: Some("Review".into()),
            }),
            messages: Vec::new(),
            provider_messages: Vec::new(),
            restored: Ok(Vec::new()),
            staged: Mutex::default(),
            facts: Vec::new(),
            command_fails: false,
            command_contended: false,
            commands: Mutex::default(),
        },
        enqueuer: Enqueuer {
            calls: calls.clone(),
            fail: false,
            writes: Mutex::default(),
        },
        broker: Broker {
            calls,
            events: Mutex::default(),
        },
    }
}

fn message(id: u128, thread: u128) -> MessageLabelTarget {
    MessageLabelTarget {
        db_id: Uuid::from_u128(id),
        thread_db_id: Uuid::from_u128(thread),
        provider_id: Some(format!("provider-{id}")),
    }
}

fn request(message_ids: Vec<Uuid>) -> MessageLabelChange {
    MessageLabelChange {
        caller: MacroUserIdStr::try_from("macro|caller@example.com").unwrap(),
        caller_fusionauth_user_id: "caller-auth".into(),
        message_ids,
        label_id: Uuid::from_u128(2),
        add: true,
    }
}

#[tokio::test]
async fn batch_bounds_reject_before_lookups_and_accept_ten() {
    let service = service();
    assert!(matches!(
        service.change(request(vec![])).await,
        Err(MessageLabelError::BatchSize)
    ));
    assert!(matches!(
        service.change(request(vec![Uuid::from_u128(3); 11])).await,
        Err(MessageLabelError::BatchSize)
    ));
    assert!(service.repository.calls.lock().unwrap().is_empty());
    let outcome = service
        .change(request(vec![Uuid::from_u128(3); 10]))
        .await
        .unwrap();
    assert_eq!(outcome.missing_ids, vec![Uuid::from_u128(3); 10]);
    assert_eq!(service.repository.staged.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn missing_inbox_stops_before_label_lookup() {
    let mut service = service();
    service.repository.inbox = None;
    assert!(matches!(
        service.change(request(vec![Uuid::from_u128(3)])).await,
        Err(MessageLabelError::MessageNotFound)
    ));
    assert_eq!(
        *service.repository.calls.lock().unwrap(),
        vec![Call::Inbox(
            "macro|caller@example.com".into(),
            Uuid::from_u128(3)
        )]
    );
}

#[tokio::test]
async fn missing_label_stops_before_message_lookup() {
    let mut service = service();
    service.repository.label = None;
    assert!(matches!(
        service.change(request(vec![Uuid::from_u128(3)])).await,
        Err(MessageLabelError::LabelNotFound)
    ));
    assert_eq!(
        *service.repository.calls.lock().unwrap(),
        vec![
            Call::Inbox("macro|caller@example.com".into(), Uuid::from_u128(3)),
            Call::Label(Uuid::from_u128(2), Uuid::from_u128(1))
        ]
    );
}

#[tokio::test]
async fn missing_ids_keep_request_order_and_successes_keep_repository_order() {
    let mut service = service();
    service.repository.messages = vec![message(4, 9), message(3, 9)];
    let outcome = service
        .change(request(vec![
            Uuid::from_u128(3),
            Uuid::from_u128(8),
            Uuid::from_u128(4),
            Uuid::from_u128(7),
            Uuid::from_u128(8),
        ]))
        .await
        .unwrap();
    assert_eq!(
        outcome,
        MessageLabelOutcome {
            successful_ids: vec![Uuid::from_u128(4), Uuid::from_u128(3)],
            failed_ids: vec![],
            missing_ids: vec![Uuid::from_u128(8), Uuid::from_u128(7), Uuid::from_u128(8)],
        }
    );
    assert!(service.enqueuer.writes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn unchanged_messages_still_publish_each_distinct_thread_without_queueing() {
    let mut service = service();
    service.repository.messages = vec![message(3, 9), message(4, 8), message(5, 9)];
    let outcome = service
        .change(request(vec![
            Uuid::from_u128(3),
            Uuid::from_u128(4),
            Uuid::from_u128(5),
        ]))
        .await
        .unwrap();
    assert_eq!(
        outcome.successful_ids,
        vec![Uuid::from_u128(3), Uuid::from_u128(4), Uuid::from_u128(5)]
    );
    let events = service.broker.events.lock().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(
        events[0]["metadata"]["thread_id"],
        Uuid::from_u128(8).to_string()
    );
    assert_eq!(
        events[1]["metadata"]["thread_id"],
        Uuid::from_u128(9).to_string()
    );
    assert!(service.enqueuer.writes.lock().unwrap().is_empty());
    assert_eq!(
        service.repository.staged.lock().unwrap()[0].thread_ids,
        vec![Uuid::from_u128(8), Uuid::from_u128(9)]
    );
}

#[tokio::test]
async fn provider_write_uses_exact_staged_messages_and_write_id_after_events() {
    let mut service = service();
    service.repository.messages = vec![message(3, 9), message(4, 9), message(5, 9)];
    service.repository.provider_messages = vec![
        (Uuid::from_u128(5), "provider-5".into()),
        (Uuid::from_u128(3), "provider-3".into()),
    ];
    let mut request = request(vec![
        Uuid::from_u128(3),
        Uuid::from_u128(4),
        Uuid::from_u128(5),
    ]);
    request.add = false;
    service.change(request).await.unwrap();
    let staged = service.repository.staged.lock().unwrap();
    assert_eq!(staged[0].write_id.get_version_num(), 7);
    assert_eq!(
        *service.enqueuer.writes.lock().unwrap(),
        vec![ProviderWrite {
            link_id: Uuid::from_u128(1),
            messages: vec![
                (Uuid::from_u128(5), "provider-5".into()),
                (Uuid::from_u128(3), "provider-3".into())
            ],
            add: vec![],
            remove: vec!["Label_3".into()],
            write_id: staged[0].write_id,
        }]
    );
    assert_eq!(
        *service.repository.calls.lock().unwrap(),
        vec![
            Call::Inbox("macro|caller@example.com".into(), Uuid::from_u128(3)),
            Call::Label(Uuid::from_u128(2), Uuid::from_u128(1)),
            Call::Messages(
                vec![Uuid::from_u128(3), Uuid::from_u128(4), Uuid::from_u128(5)],
                "caller-auth".into()
            ),
            Call::Stage,
            Call::Event,
            Call::Enqueue,
        ]
    );
}

#[tokio::test]
async fn enqueue_failure_reports_only_restored_messages_as_failed() {
    let mut service = service();
    service.repository.messages = vec![message(3, 9), message(4, 9)];
    service.repository.provider_messages = vec![(Uuid::from_u128(3), "provider-3".into())];
    service.repository.restored = Ok(vec![Uuid::from_u128(3)]);
    service.enqueuer.fail = true;
    let outcome = service
        .change(request(vec![Uuid::from_u128(3), Uuid::from_u128(4)]))
        .await
        .unwrap();
    assert_eq!(outcome.successful_ids, vec![Uuid::from_u128(4)]);
    assert_eq!(outcome.failed_ids, vec![Uuid::from_u128(3)]);
    let write_id = service.repository.staged.lock().unwrap()[0].write_id;
    let calls = service.repository.calls.lock().unwrap();
    let reverted = calls
        .iter()
        .position(|call| {
            *call
                == Call::Revert(
                    Uuid::from_u128(1),
                    vec![Uuid::from_u128(9)],
                    vec![Uuid::from_u128(3)],
                    write_id,
                )
        })
        .unwrap();
    // The change was published before the write was undone, so the thread is
    // reindexed once the old labels are back.
    assert_eq!(calls[reverted + 1..], [Call::Event]);
    let events = service.broker.events.lock().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["event_type"], "email.thread_labels_updated");
    assert_eq!(events[1]["event_type"], "email.threads_reindex_requested");
    assert_eq!(
        events[1]["metadata"]["thread_ids"],
        serde_json::json!([Uuid::from_u128(9)])
    );
}

#[tokio::test]
async fn a_write_that_can_be_neither_queued_nor_undone_fails_the_request() {
    let mut service = service();
    service.repository.messages = vec![message(3, 9)];
    service.repository.provider_messages = vec![(Uuid::from_u128(3), "provider-3".into())];
    service.repository.restored = Err(TestError);
    service.enqueuer.fail = true;
    assert!(matches!(
        service.change(request(vec![Uuid::from_u128(3)])).await,
        Err(MessageLabelError::Unqueued(TestError))
    ));
}

fn outlook() -> MessageLabelService<Repository, Enqueuer, Broker> {
    let mut service = service();
    if let Some(inbox) = service.repository.inbox.as_mut() {
        inbox.provider = UserProvider::Outlook;
    }
    service
}

fn fact(id: u128, is_present: bool) -> MailboxActionMessage {
    MailboxActionMessage {
        id: Uuid::from_u128(id),
        provider_id: Some(format!("provider-{id}")),
        is_draft: false,
        is_sent: false,
        is_read: true,
        in_inbox: true,
        in_trash: false,
        in_junk: false,
        is_present,
    }
}

#[tokio::test]
async fn outlook_queues_one_category_command_for_the_requested_messages_it_still_holds() {
    let mut service = outlook();
    service.repository.messages = vec![message(3, 9), message(4, 8), message(5, 9)];
    service.repository.facts = vec![
        (Uuid::from_u128(9), fact(3, true)),
        (Uuid::from_u128(9), fact(5, false)),
        (Uuid::from_u128(9), fact(6, true)),
        (Uuid::from_u128(8), fact(4, true)),
    ];
    let outcome = service
        .change(request(vec![
            Uuid::from_u128(3),
            Uuid::from_u128(4),
            Uuid::from_u128(5),
            Uuid::from_u128(7),
        ]))
        .await
        .unwrap();
    assert_eq!(
        outcome,
        MessageLabelOutcome {
            successful_ids: vec![Uuid::from_u128(3), Uuid::from_u128(4)],
            failed_ids: vec![Uuid::from_u128(5)],
            missing_ids: vec![Uuid::from_u128(7)],
        }
    );
    let commands = service.repository.commands.lock().unwrap();
    assert_eq!(commands.len(), 1);
    assert_eq!(commands[0].link_id, Uuid::from_u128(1));
    assert_eq!(commands[0].actor, "macro|caller@example.com");
    assert_eq!(
        commands[0].action,
        MailboxAction::Category {
            name: "Label_3".into(),
            present: true,
        }
    );
    assert_eq!(
        commands[0].targets,
        vec![Uuid::from_u128(4), Uuid::from_u128(3)]
    );
    assert_eq!(
        *service.repository.calls.lock().unwrap(),
        vec![
            Call::Inbox("macro|caller@example.com".into(), Uuid::from_u128(3)),
            Call::Label(Uuid::from_u128(2), Uuid::from_u128(1)),
            Call::Messages(
                vec![
                    Uuid::from_u128(3),
                    Uuid::from_u128(4),
                    Uuid::from_u128(5),
                    Uuid::from_u128(7)
                ],
                "caller-auth".into()
            ),
            Call::Facts(Uuid::from_u128(1), Uuid::from_u128(8)),
            Call::Facts(Uuid::from_u128(1), Uuid::from_u128(9)),
            Call::Command,
        ]
    );
    assert!(service.repository.staged.lock().unwrap().is_empty());
    assert!(service.enqueuer.writes.lock().unwrap().is_empty());
    assert!(service.broker.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn outlook_removal_takes_the_category_off() {
    let mut service = outlook();
    service.repository.messages = vec![message(3, 9)];
    service.repository.facts = vec![(Uuid::from_u128(9), fact(3, true))];
    let mut request = request(vec![Uuid::from_u128(3)]);
    request.add = false;
    service.change(request).await.unwrap();
    assert_eq!(
        service.repository.commands.lock().unwrap()[0].action,
        MailboxAction::Category {
            name: "Label_3".into(),
            present: false,
        }
    );
}

#[tokio::test]
async fn outlook_command_that_cannot_be_queued_fails_the_request() {
    let mut service = outlook();
    service.repository.messages = vec![message(3, 9), message(4, 9)];
    service.repository.facts = vec![
        (Uuid::from_u128(9), fact(3, true)),
        (Uuid::from_u128(9), fact(4, true)),
    ];
    service.repository.command_fails = true;
    assert!(matches!(
        service
            .change(request(vec![Uuid::from_u128(3), Uuid::from_u128(4)]))
            .await,
        Err(MessageLabelError::Command(TestError))
    ));
}

#[tokio::test]
async fn outlook_command_behind_a_busy_inbox_is_a_retryable_failure() {
    let mut service = outlook();
    service.repository.messages = vec![message(3, 9)];
    service.repository.facts = vec![(Uuid::from_u128(9), fact(3, true))];
    service.repository.command_fails = true;
    service.repository.command_contended = true;
    assert!(matches!(
        service.change(request(vec![Uuid::from_u128(3)])).await,
        Err(MessageLabelError::Contended)
    ));
}

#[tokio::test]
async fn outlook_messages_the_inbox_no_longer_holds_queue_no_command() {
    let mut service = outlook();
    service.repository.messages = vec![message(3, 9)];
    service.repository.facts = vec![(Uuid::from_u128(9), fact(3, false))];
    let outcome = service
        .change(request(vec![Uuid::from_u128(3)]))
        .await
        .unwrap();
    assert_eq!(outcome.failed_ids, vec![Uuid::from_u128(3)]);
    assert!(outcome.successful_ids.is_empty());
    assert!(service.repository.commands.lock().unwrap().is_empty());
}
