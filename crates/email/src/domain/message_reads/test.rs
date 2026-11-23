use super::*;
use std::sync::Mutex;

const OWN: Uuid = Uuid::from_u128(1);
const SECOND: Uuid = Uuid::from_u128(2);
const DELEGATED: Uuid = Uuid::from_u128(3);
const FOREIGN: Uuid = Uuid::from_u128(4);
const MESSAGE: Uuid = Uuid::from_u128(10);
const OTHER: Uuid = Uuid::from_u128(11);
const THREAD: Uuid = Uuid::from_u128(20);
const CALLER: &str = "macro|reader@example.com";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Operation {
    Message,
    Messages,
    Thread,
    Inboxes,
    Newest,
    Senders,
    Histories,
    Owner,
}

#[derive(Debug, PartialEq, Eq)]
enum Call {
    Message(Uuid),
    Messages(Vec<Uuid>),
    Thread(Uuid, i64, i64),
    Inboxes(String),
    Newest(String),
    Senders(Vec<Uuid>, Vec<Uuid>),
    Histories(Vec<Uuid>, Vec<Uuid>),
    Owner(Uuid),
}

#[derive(Debug, thiserror::Error)]
#[error("test query failure")]
struct TestError;

#[derive(Default)]
struct Repository {
    messages: Vec<ParsedMessage>,
    inboxes: Vec<Uuid>,
    newest: Option<Uuid>,
    owner: Option<String>,
    fail: Option<Operation>,
    calls: Mutex<Vec<Call>>,
}

impl Repository {
    fn record(&self, operation: Operation, call: Call) -> Result<(), TestError> {
        self.calls.lock().expect("calls").push(call);
        if self.fail == Some(operation) {
            Err(TestError)
        } else {
            Ok(())
        }
    }
}

impl MessageReadRepository for Repository {
    type Err = TestError;

    async fn message(&self, id: Uuid) -> Result<Option<ParsedMessage>, Self::Err> {
        self.record(Operation::Message, Call::Message(id))?;
        Ok(self.messages.iter().find(|m| m.db_id == id).cloned())
    }
    async fn messages(&self, ids: &[Uuid]) -> Result<Vec<ParsedMessage>, Self::Err> {
        self.record(Operation::Messages, Call::Messages(ids.to_vec()))?;
        Ok(self
            .messages
            .iter()
            .filter(|m| ids.contains(&m.db_id))
            .cloned()
            .collect())
    }
    async fn thread_messages(
        &self,
        id: Uuid,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<ParsedMessage>, Self::Err> {
        self.record(Operation::Thread, Call::Thread(id, offset, limit))?;
        Ok(self.messages.clone())
    }
    async fn readable_inbox_ids(&self, caller: &str) -> Result<Vec<Uuid>, Self::Err> {
        self.record(Operation::Inboxes, Call::Inboxes(caller.into()))?;
        Ok(self.inboxes.clone())
    }
    async fn newest_owned_inbox(&self, caller: &str) -> Result<Option<Uuid>, Self::Err> {
        self.record(Operation::Newest, Call::Newest(caller.into()))?;
        Ok(self.newest)
    }
    async fn senders(
        &self,
        inboxes: &[Uuid],
        ids: &[Uuid],
    ) -> Result<HashMap<Uuid, MessageSenderInfo>, Self::Err> {
        self.record(
            Operation::Senders,
            Call::Senders(inboxes.into(), ids.into()),
        )?;
        Ok(HashMap::from([(
            MESSAGE,
            MessageSenderInfo {
                sender: "sender@example.com".into(),
                pretty_sender: "Sender".into(),
            },
        )]))
    }
    async fn histories(
        &self,
        inboxes: &[Uuid],
        ids: &[Uuid],
    ) -> Result<HashMap<Uuid, ThreadHistoryInfo>, Self::Err> {
        self.record(
            Operation::Histories,
            Call::Histories(inboxes.into(), ids.into()),
        )?;
        Ok(HashMap::from([(
            THREAD,
            ThreadHistoryInfo {
                snippet: Some("summary".into()),
                ..Default::default()
            },
        )]))
    }
    async fn thread_owner(&self, id: Uuid) -> Result<Option<String>, Self::Err> {
        self.record(Operation::Owner, Call::Owner(id))?;
        Ok(self.owner.clone())
    }
}

fn message(id: Uuid, inbox: Uuid) -> ParsedMessage {
    ParsedMessage {
        draft_generation: 7,
        db_id: id,
        link_id: inbox,
        thread_db_id: THREAD,
        subject: Some("subject".into()),
        from: None,
        to: vec![],
        cc: vec![],
        bcc: vec![],
        labels: vec![],
        body_parsed: Some("body".into()),
        internal_date_ts: None,
    }
}

#[tokio::test]
async fn missing_id_warnings_preserve_duplicates_and_the_empty_missing_list() {
    let telemetry = crate::telemetry_capture::Telemetry::default();
    let _guard = telemetry.install();
    let service = MessageReadService {
        repository: Repository {
            messages: vec![message(MESSAGE, OWN)],
            inboxes: vec![OWN],
            ..Default::default()
        },
    };
    for ids in [vec![MESSAGE, MESSAGE], vec![OTHER, MESSAGE, OTHER]] {
        service
            .messages(CALLER, &ids)
            .await
            .expect("public partial");
        service
            .internal_messages(&ids)
            .await
            .expect("internal partial");
    }
    for text in [
        "some ids not found in database or not authorized for access",
        "some ids not found in database",
    ] {
        let events = telemetry.events(text);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].0, tracing::Level::WARN);
        assert_eq!(
            events[0].1.get("missing_ids").map(String::as_str),
            Some("[]")
        );
        assert_eq!(events[1].0, tracing::Level::WARN);
        assert_eq!(
            events[1].1.get("missing_ids"),
            Some(&format!("{:?}", vec![OTHER, OTHER]))
        );
    }
    assert!(matches!(
        service.internal_messages(&[OTHER]).await,
        Err(InternalMessageReadError::NotFound)
    ));
    let absent = telemetry.events("no messages found in database");
    assert_eq!(absent.len(), 1);
    assert_eq!(absent[0].0, tracing::Level::WARN);
    assert!(telemetry.spans("messages").is_empty());
    assert!(telemetry.spans("internal_messages").is_empty());
}

#[tokio::test]
async fn single_message_authorizes_own_second_and_delegated_inboxes_after_lookup() {
    for inbox in [OWN, SECOND, DELEGATED] {
        let service = MessageReadService {
            repository: Repository {
                messages: vec![message(MESSAGE, inbox)],
                inboxes: vec![OWN, SECOND, DELEGATED],
                ..Default::default()
            },
        };
        let result = service.message(CALLER, MESSAGE).await.expect("accessible");
        assert_eq!(result.link_id, inbox);
        assert_eq!(result.body_parsed.as_deref(), Some("body"));
        assert_eq!(
            *service.repository.calls.lock().expect("calls"),
            vec![Call::Message(MESSAGE), Call::Inboxes(CALLER.into())]
        );
    }
    for inboxes in [vec![OWN, SECOND, DELEGATED], vec![]] {
        let service = MessageReadService {
            repository: Repository {
                messages: vec![message(MESSAGE, FOREIGN)],
                inboxes,
                ..Default::default()
            },
        };
        assert!(matches!(
            service.message(CALLER, MESSAGE).await,
            Err(MessageReadError::Unauthorized)
        ));
    }
    let service = MessageReadService {
        repository: Repository::default(),
    };
    assert!(matches!(
        service.message(CALLER, MESSAGE).await,
        Err(MessageReadError::NotFound)
    ));
    assert_eq!(
        *service.repository.calls.lock().expect("calls"),
        vec![Call::Message(MESSAGE)]
    );
}

#[tokio::test]
async fn public_batch_filters_each_message_and_keeps_database_order() {
    let service = MessageReadService {
        repository: Repository {
            messages: vec![
                message(Uuid::from_u128(12), FOREIGN),
                message(OTHER, SECOND),
                message(MESSAGE, OWN),
                message(Uuid::from_u128(13), DELEGATED),
            ],
            inboxes: vec![OWN, SECOND, DELEGATED],
            ..Default::default()
        },
    };
    let ids = [
        MESSAGE,
        OTHER,
        Uuid::from_u128(12),
        Uuid::from_u128(13),
        Uuid::from_u128(99),
    ];
    let result = service
        .messages(CALLER, &ids)
        .await
        .expect("partial success");
    assert_eq!(
        result.iter().map(|m| m.db_id).collect::<Vec<_>>(),
        vec![OTHER, MESSAGE, Uuid::from_u128(13)]
    );
    assert_eq!(
        *service.repository.calls.lock().expect("calls"),
        vec![Call::Messages(ids.to_vec()), Call::Inboxes(CALLER.into())]
    );
    let duplicates = service
        .messages(CALLER, &[MESSAGE, MESSAGE])
        .await
        .expect("duplicates");
    assert_eq!(duplicates.len(), 1);
    let complete = service
        .messages(CALLER, &[MESSAGE, OTHER])
        .await
        .expect("complete");
    assert_eq!(complete.len(), 2);
    assert!(matches!(
        service.messages(CALLER, &[Uuid::from_u128(12)]).await,
        Err(MessageReadError::Unauthorized)
    ));
}

#[tokio::test]
async fn empty_or_unknown_public_batch_stops_before_inbox_lookup() {
    for ids in [vec![], vec![MESSAGE]] {
        let service = MessageReadService {
            repository: Repository::default(),
        };
        assert!(matches!(
            service.messages(CALLER, &ids).await,
            Err(MessageReadError::NotFound)
        ));
        assert_eq!(
            *service.repository.calls.lock().expect("calls"),
            vec![Call::Messages(ids)]
        );
    }
}

#[tokio::test]
async fn public_pagination_rejects_each_invalid_bound_before_querying() {
    for (offset, limit, expected) in [
        (Some(-1), None, "offset must be non-negative"),
        (Some(-1), Some(0), "offset must be non-negative"),
        (None, Some(0), "limit must be positive"),
        (None, Some(-1), "limit must be positive"),
        (None, Some(101), "limit must not exceed 100"),
        (None, Some(i64::MAX), "limit must not exceed 100"),
    ] {
        let service = MessageReadService {
            repository: Repository::default(),
        };
        let error = service
            .thread_messages(
                CALLER,
                ThreadMessagesRequest {
                    thread_id: THREAD,
                    offset,
                    limit,
                },
            )
            .await
            .expect_err("invalid bounds");
        match error {
            ThreadReadError::Validation(error) => assert_eq!(error.to_string(), expected),
            other => panic!("unexpected {other:?}"),
        }
        assert!(service.repository.calls.lock().expect("calls").is_empty());
    }
}

#[tokio::test]
async fn public_thread_queries_inboxes_first_and_filters_after_pagination() {
    for (offset, limit, page) in [
        (None, None, (0, 5)),
        (Some(0), Some(1), (0, 1)),
        (Some(2), Some(100), (2, 100)),
        (Some(i64::MAX), None, (i64::MAX, 5)),
    ] {
        let service = MessageReadService {
            repository: Repository {
                messages: vec![message(OTHER, FOREIGN), message(MESSAGE, DELEGATED)],
                inboxes: vec![OWN, SECOND, DELEGATED],
                ..Default::default()
            },
        };
        let result = service
            .thread_messages(
                CALLER,
                ThreadMessagesRequest {
                    thread_id: THREAD,
                    offset,
                    limit,
                },
            )
            .await
            .expect("page");
        assert_eq!(
            result.iter().map(|m| m.db_id).collect::<Vec<_>>(),
            vec![MESSAGE]
        );
        assert_eq!(
            *service.repository.calls.lock().expect("calls"),
            vec![
                Call::Inboxes(CALLER.into()),
                Call::Thread(THREAD, page.0, page.1)
            ]
        );
    }
    for messages in [vec![], vec![message(MESSAGE, FOREIGN)]] {
        let service = MessageReadService {
            repository: Repository {
                messages,
                inboxes: vec![OWN],
                ..Default::default()
            },
        };
        assert!(matches!(
            service
                .thread_messages(
                    CALLER,
                    ThreadMessagesRequest {
                        thread_id: THREAD,
                        offset: None,
                        limit: None
                    }
                )
                .await,
            Err(ThreadReadError::Unauthorized)
        ));
    }
}

#[tokio::test]
async fn internal_messages_are_unscoped_and_distinguish_empty_from_unknown_batches() {
    let service = MessageReadService {
        repository: Repository {
            messages: vec![message(MESSAGE, FOREIGN)],
            fail: Some(Operation::Inboxes),
            ..Default::default()
        },
    };
    assert_eq!(
        service
            .internal_message(MESSAGE)
            .await
            .expect("unscoped")
            .link_id,
        FOREIGN
    );
    assert!(matches!(
        service.internal_message(OTHER).await,
        Err(InternalMessageReadError::NotFound)
    ));
    assert!(
        service
            .internal_messages(&[])
            .await
            .expect("empty succeeds")
            .is_empty()
    );
    assert_eq!(
        service
            .internal_messages(&[MESSAGE])
            .await
            .expect("complete")
            .len(),
        1
    );
    assert_eq!(
        service
            .internal_messages(&[MESSAGE, MESSAGE])
            .await
            .expect("duplicate")
            .len(),
        1
    );
    assert_eq!(
        service
            .internal_messages(&[MESSAGE, OTHER])
            .await
            .expect("partial")
            .len(),
        1
    );
    assert!(matches!(
        service.internal_messages(&[OTHER]).await,
        Err(InternalMessageReadError::NotFound)
    ));
    assert!(
        !service
            .repository
            .calls
            .lock()
            .expect("calls")
            .iter()
            .any(|c| matches!(c, Call::Inboxes(_)))
    );
}

#[tokio::test]
async fn internal_thread_bounds_fall_back_independently_and_empty_pages_succeed() {
    for (offset, limit, page) in [
        (None, None, (0, 5)),
        (Some(0), Some(1), (0, 1)),
        (Some(2), Some(100), (2, 100)),
        (Some(-1), Some(1), (0, 1)),
        (Some(2), Some(0), (2, 5)),
        (Some(2), Some(-1), (2, 5)),
        (Some(2), Some(101), (2, 5)),
        (Some(-1), Some(i64::MAX), (0, 5)),
        (Some(i64::MAX), None, (i64::MAX, 5)),
    ] {
        let service = MessageReadService {
            repository: Repository {
                fail: Some(Operation::Inboxes),
                ..Default::default()
            },
        };
        assert!(
            service
                .internal_thread_messages(ThreadMessagesRequest {
                    thread_id: THREAD,
                    offset,
                    limit
                })
                .await
                .expect("empty page")
                .is_empty()
        );
        assert_eq!(
            *service.repository.calls.lock().expect("calls"),
            vec![Call::Thread(THREAD, page.0, page.1)]
        );
    }
}

#[tokio::test]
async fn summaries_use_only_the_newest_owned_inbox_even_for_empty_id_lists() {
    for ids in [vec![MESSAGE, OTHER], vec![]] {
        let service = MessageReadService {
            repository: Repository {
                newest: Some(SECOND),
                inboxes: vec![OWN, DELEGATED],
                ..Default::default()
            },
        };
        let result = service
            .senders(MessageSendersRequest {
                user_id: CALLER.into(),
                message_ids: ids.clone(),
            })
            .await
            .expect("senders");
        assert_eq!(
            result
                .sender_map
                .get(&MESSAGE)
                .expect("sender")
                .pretty_sender,
            "Sender"
        );
        assert_eq!(
            *service.repository.calls.lock().expect("calls"),
            vec![
                Call::Newest(CALLER.into()),
                Call::Senders(vec![SECOND], ids.clone())
            ]
        );
        service.repository.calls.lock().expect("calls").clear();
        let result = service
            .histories(ThreadHistoryRequest {
                user_id: CALLER.into(),
                thread_ids: ids.clone(),
            })
            .await
            .expect("histories");
        assert_eq!(
            result
                .history_map
                .get(&THREAD)
                .expect("history")
                .snippet
                .as_deref(),
            Some("summary")
        );
        assert_eq!(
            *service.repository.calls.lock().expect("calls"),
            vec![
                Call::Newest(CALLER.into()),
                Call::Histories(vec![SECOND], ids)
            ]
        );
    }
    let service = MessageReadService {
        repository: Repository::default(),
    };
    assert!(
        matches!(service.senders(MessageSendersRequest { user_id: CALLER.into(), message_ids: vec![MESSAGE] }).await, Err(SummaryReadError::LinkNotFound(user)) if user == CALLER)
    );
    assert!(
        matches!(service.histories(ThreadHistoryRequest { user_id: CALLER.into(), thread_ids: vec![THREAD] }).await, Err(SummaryReadError::LinkNotFound(user)) if user == CALLER)
    );
    assert_eq!(
        *service.repository.calls.lock().expect("calls"),
        vec![Call::Newest(CALLER.into()), Call::Newest(CALLER.into())]
    );
}

#[tokio::test]
async fn thread_owner_validates_the_stored_identifier() {
    let service = MessageReadService {
        repository: Repository {
            owner: Some(CALLER.into()),
            ..Default::default()
        },
    };
    assert_eq!(
        service
            .thread_owner(THREAD)
            .await
            .expect("owner")
            .user_id
            .as_ref(),
        CALLER
    );
    let service = MessageReadService {
        repository: Repository {
            owner: Some("not a macro user id".into()),
            ..Default::default()
        },
    };
    assert!(matches!(
        service.thread_owner(THREAD).await,
        Err(ThreadOwnerError::InvalidOwner)
    ));
    let service = MessageReadService {
        repository: Repository::default(),
    };
    assert!(matches!(
        service.thread_owner(THREAD).await,
        Err(ThreadOwnerError::NotFound)
    ));
}

#[tokio::test]
async fn query_failures_keep_their_stage_and_stop_subsequent_calls() {
    let repository = Repository {
        messages: vec![message(MESSAGE, OWN)],
        fail: Some(Operation::Message),
        ..Default::default()
    };
    let mut service = MessageReadService { repository };
    assert!(matches!(
        service.message(CALLER, MESSAGE).await,
        Err(MessageReadError::Messages(TestError))
    ));
    assert!(matches!(
        service.internal_message(MESSAGE).await,
        Err(InternalMessageReadError::Query(TestError))
    ));
    service.repository.fail = Some(Operation::Messages);
    assert!(matches!(
        service.messages(CALLER, &[MESSAGE]).await,
        Err(MessageReadError::Messages(TestError))
    ));
    assert!(matches!(
        service.internal_messages(&[MESSAGE]).await,
        Err(InternalMessageReadError::Query(TestError))
    ));
    assert!(
        !service
            .repository
            .calls
            .lock()
            .expect("calls")
            .iter()
            .any(|c| matches!(c, Call::Inboxes(_)))
    );
    service.repository.fail = Some(Operation::Inboxes);
    assert!(matches!(
        service.message(CALLER, MESSAGE).await,
        Err(MessageReadError::Inboxes(TestError))
    ));
    assert!(matches!(
        service.messages(CALLER, &[MESSAGE]).await,
        Err(MessageReadError::Inboxes(TestError))
    ));
    service.repository.calls.lock().expect("calls").clear();
    assert!(matches!(
        service
            .thread_messages(
                CALLER,
                ThreadMessagesRequest {
                    thread_id: THREAD,
                    offset: None,
                    limit: None
                }
            )
            .await,
        Err(ThreadReadError::Inboxes(TestError))
    ));
    assert_eq!(
        *service.repository.calls.lock().expect("calls"),
        vec![Call::Inboxes(CALLER.into())]
    );
    service.repository.fail = Some(Operation::Thread);
    assert!(matches!(
        service
            .thread_messages(
                CALLER,
                ThreadMessagesRequest {
                    thread_id: THREAD,
                    offset: None,
                    limit: None
                }
            )
            .await,
        Err(ThreadReadError::Messages(TestError))
    ));
    assert!(matches!(
        service
            .internal_thread_messages(ThreadMessagesRequest {
                thread_id: THREAD,
                offset: None,
                limit: None
            })
            .await,
        Err(TestError)
    ));
    service.repository.fail = Some(Operation::Owner);
    assert!(matches!(
        service.thread_owner(THREAD).await,
        Err(ThreadOwnerError::Query(TestError))
    ));
    for operation in [Operation::Newest, Operation::Senders, Operation::Histories] {
        service.repository.fail = Some(operation);
        service.repository.newest = Some(SECOND);
        if operation != Operation::Histories {
            assert!(matches!(
                service
                    .senders(MessageSendersRequest {
                        user_id: CALLER.into(),
                        message_ids: vec![MESSAGE]
                    })
                    .await,
                Err(SummaryReadError::Query(TestError))
            ));
        }
        if operation != Operation::Senders {
            assert!(matches!(
                service
                    .histories(ThreadHistoryRequest {
                        user_id: CALLER.into(),
                        thread_ids: vec![THREAD]
                    })
                    .await,
                Err(SummaryReadError::Query(TestError))
            ));
        }
    }
}
