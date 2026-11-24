use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use uuid::Uuid;

use super::super::test_support::{Call, FakeGate, FakeTokenSource, call_log};
use super::*;
use crate::domain::models::{AccessToken, TokenFreshness};

#[derive(Debug, Clone, PartialEq, Eq)]
enum MessageCall {
    Message(Uuid, String),
    MessageLabels(String),
    Messages(u32, Vec<String>),
    MessagesSince(u32, Vec<String>, i64, Option<String>),
    MessageIdsForThread(String),
    Thread(Uuid, String),
    Threads(u32, Option<String>, Vec<String>),
    ModifyLabels(String, Vec<String>, Vec<String>),
    BatchModifyLabels(Vec<String>, Vec<String>, Vec<String>),
}

#[derive(Clone, Default)]
struct MessageClient {
    call: Arc<Mutex<Option<MessageCall>>>,
    /// When set, per-message label writes answer from it instead of failing.
    label_writes: Option<LabelWrites>,
    /// When set, dated lists answer its pages in turn instead of failing.
    pages: Option<Pages>,
}

/// What one page call asked for: its `max_results` and page token.
type Asked = (u32, Option<String>);

/// Pages a dated list answers, and what each call asked for.
#[derive(Clone, Default)]
struct Pages {
    answers: Arc<Mutex<VecDeque<Result<MessageIdPage, EmailApiError>>>>,
    asked: Arc<Mutex<Vec<Asked>>>,
}

/// Records per-message label writes in order; listed ids answer with an error.
#[derive(Clone, Default)]
struct LabelWrites {
    written: Arc<Mutex<Vec<String>>>,
    errors: Vec<(String, EmailApiError)>,
}

impl MessageClient {
    fn record(&self, access_token: &AccessToken, call: MessageCall) -> EmailApiError {
        assert_eq!(access_token.expose_secret(), "token");
        *self.call.lock().unwrap() = Some(call);
        expected_error()
    }
}

impl MailboxMessageClient for MessageClient {
    async fn get_message(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        message_id: &str,
    ) -> Result<Option<crate::domain::models::MessageWithCalendarParts>, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::Message(link_id, message_id.to_string()),
        ))
    }

    async fn get_message_label_ids(
        &self,
        access_token: &AccessToken,
        message_id: &str,
    ) -> Result<Option<Vec<String>>, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::MessageLabels(message_id.to_string()),
        ))
    }

    async fn list_messages(
        &self,
        access_token: &AccessToken,
        limit: u32,
        label_ids: &[&str],
    ) -> Result<Vec<String>, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::Messages(
                limit,
                label_ids.iter().map(|label| (*label).to_string()).collect(),
            ),
        ))
    }

    async fn list_messages_since(
        &self,
        access_token: &AccessToken,
        max_results: u32,
        label_ids: &[&str],
        since: chrono::DateTime<chrono::Utc>,
        page_token: Option<&str>,
    ) -> Result<MessageIdPage, EmailApiError> {
        if let Some(pages) = &self.pages {
            pages
                .asked
                .lock()
                .unwrap()
                .push((max_results, page_token.map(str::to_string)));
            return pages
                .answers
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok(MessageIdPage::default()));
        }
        Err(self.record(
            access_token,
            MessageCall::MessagesSince(
                max_results,
                label_ids.iter().map(|label| (*label).to_string()).collect(),
                since.timestamp(),
                page_token.map(str::to_string),
            ),
        ))
    }

    async fn get_message_ids_for_thread(
        &self,
        access_token: &AccessToken,
        thread_id: &str,
    ) -> Result<Vec<String>, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::MessageIdsForThread(thread_id.to_string()),
        ))
    }

    async fn get_thread(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        thread_id: &str,
    ) -> Result<Vec<crate::domain::models::MessageWithCalendarParts>, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::Thread(link_id, thread_id.to_string()),
        ))
    }

    async fn list_threads(
        &self,
        access_token: &AccessToken,
        limit: u32,
        page_token: Option<&str>,
        label_ids: &[&str],
    ) -> Result<ThreadListPage, EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::Threads(
                limit,
                page_token.map(str::to_string),
                label_ids.iter().map(|label| (*label).to_string()).collect(),
            ),
        ))
    }

    async fn modify_message_labels(
        &self,
        access_token: &AccessToken,
        message_id: &str,
        labels_to_add: &[String],
        labels_to_remove: &[String],
    ) -> Result<(), EmailApiError> {
        if let Some(writes) = &self.label_writes {
            writes.written.lock().unwrap().push(message_id.to_string());
            return writes
                .errors
                .iter()
                .find(|(id, _)| id == message_id)
                .map_or(Ok(()), |(_, error)| Err(error.clone()));
        }
        Err(self.record(
            access_token,
            MessageCall::ModifyLabels(
                message_id.to_string(),
                labels_to_add.to_vec(),
                labels_to_remove.to_vec(),
            ),
        ))
    }

    async fn batch_modify_message_labels(
        &self,
        access_token: &AccessToken,
        message_ids: &[String],
        labels_to_add: &[String],
        labels_to_remove: &[String],
    ) -> Result<(), EmailApiError> {
        Err(self.record(
            access_token,
            MessageCall::BatchModifyLabels(
                message_ids.to_vec(),
                labels_to_add.to_vec(),
                labels_to_remove.to_vec(),
            ),
        ))
    }
}

fn expected_error() -> EmailApiError {
    EmailApiError::Permanent {
        message: "provider error".to_string(),
    }
}

async fn assert_call<F, E>(operation: ApiOperationKind, expected_repository_call: E, invoke: F)
where
    E: FnOnce(Uuid) -> MessageCall,
    F: AsyncFnOnce(
        &EmailApiClientServiceImpl<MessageClient, FakeTokenSource, FakeGate>,
        Uuid,
    ) -> Result<(), EmailApiError>,
{
    let calls = call_log();
    let repository = MessageClient::default();
    let repository_call = repository.call.clone();
    let link_id = Uuid::new_v4();
    let service = EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeGate::new(calls.clone(), Ok(())),
    );

    assert_eq!(invoke(&service, link_id).await, Err(expected_error()));
    assert_eq!(
        *repository_call.lock().unwrap(),
        Some(expected_repository_call(link_id))
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Acquire(link_id, operation),
            Call::Token(link_id, TokenFreshness::Cached),
            Call::Finish(link_id, Some(expected_error())),
        ]
    );
}

#[tokio::test]
async fn message_reads_use_correct_operation_kinds_and_forward_parameters() {
    assert_call(
        ApiOperationKind::GetMessage,
        |link_id| MessageCall::Message(link_id, "message".into()),
        async |service, link_id| service.get_message(link_id, "message").await.map(|_| ()),
    )
    .await;
    assert_call(
        ApiOperationKind::GetMessage,
        |_| MessageCall::MessageLabels("message".into()),
        async |service, link_id| {
            service
                .get_message_label_ids(link_id, "message")
                .await
                .map(|_| ())
        },
    )
    .await;
    assert_call(
        ApiOperationKind::ListMessages,
        |_| MessageCall::Messages(25, vec!["inbox".into(), "unread".into()]),
        async |service, link_id| {
            service
                .list_messages(link_id, 25, &["inbox", "unread"])
                .await
                .map(|_| ())
        },
    )
    .await;
    assert_call(
        ApiOperationKind::ListMessages,
        |_| MessageCall::MessagesSince(500, vec!["INBOX".into()], 1_700_000_000, None),
        async |service, link_id| {
            let since = chrono::DateTime::from_timestamp(1_700_000_000, 0).unwrap();
            service
                .list_messages_since(link_id, 500, &["INBOX"], since)
                .await
                .map(|_| ())
        },
    )
    .await;
    assert_call(
        ApiOperationKind::GetThread,
        |_| MessageCall::MessageIdsForThread("thread".into()),
        async |service, link_id| {
            service
                .get_message_ids_for_thread(link_id, "thread")
                .await
                .map(|_| ())
        },
    )
    .await;
    assert_call(
        ApiOperationKind::GetThread,
        |link_id| MessageCall::Thread(link_id, "thread".into()),
        async |service, link_id| service.get_thread(link_id, "thread").await.map(|_| ()),
    )
    .await;
    assert_call(
        ApiOperationKind::ListThreads,
        |_| {
            MessageCall::Threads(
                50,
                Some("next-page".into()),
                vec!["inbox".into(), "starred".into()],
            )
        },
        async |service, link_id| {
            service
                .list_threads(link_id, 50, Some("next-page"), &["inbox", "starred"])
                .await
                .map(|_| ())
        },
    )
    .await;
    assert_call(
        ApiOperationKind::ModifyMessageLabels,
        |_| {
            MessageCall::ModifyLabels(
                "message".into(),
                vec!["starred".into()],
                vec!["unread".into()],
            )
        },
        async |service, link_id| {
            service
                .modify_message_labels(
                    link_id,
                    &["message".into()],
                    &["starred".into()],
                    &["unread".into()],
                )
                .await
        },
    )
    .await;
}

#[tokio::test]
async fn label_writes_on_ten_or_more_messages_use_one_batch_request() {
    let message_ids: Vec<String> = (0..10).map(|index| format!("message-{index}")).collect();
    assert_call(
        ApiOperationKind::BatchModifyMessageLabels,
        |_| MessageCall::BatchModifyLabels(message_ids.clone(), vec![], vec!["INBOX".into()]),
        async |service, link_id| {
            service
                .modify_message_labels(link_id, &message_ids, &[], &["INBOX".into()])
                .await
        },
    )
    .await;
}

fn page(ids: &[&str], next: Option<&str>) -> MessageIdPage {
    MessageIdPage {
        ids: ids.iter().map(|id| (*id).to_string()).collect(),
        next_page_token: next.map(str::to_string),
    }
}

/// Lists `limit` ids since a fixed time from `answers`; returns the ids,
/// what each page asked for, and the gate and token calls.
async fn list_since(
    answers: Vec<MessageIdPage>,
    limit: u32,
) -> (Vec<String>, Vec<Asked>, Vec<Call>) {
    let (ids, asked, calls) =
        list_since_answers(answers.into_iter().map(Ok).collect(), limit).await;
    (ids.unwrap(), asked, calls)
}

/// [`list_since`] from pages that may fail.
async fn list_since_answers(
    answers: Vec<Result<MessageIdPage, EmailApiError>>,
    limit: u32,
) -> (Result<Vec<String>, EmailApiError>, Vec<Asked>, Vec<Call>) {
    let calls = call_log();
    let pages = Pages {
        answers: Arc::new(Mutex::new(answers.into())),
        ..Default::default()
    };
    let service = EmailApiClientServiceImpl::new(
        MessageClient {
            pages: Some(pages.clone()),
            ..Default::default()
        },
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeGate::new(calls.clone(), Ok(())),
    );
    let since = chrono::DateTime::from_timestamp(1_700_000_000, 0).unwrap();
    let ids = service
        .list_messages_since(Uuid::nil(), limit, &["INBOX"], since)
        .await;
    let asked = pages.asked.lock().unwrap().clone();
    let calls = calls.lock().unwrap().clone();
    (ids, asked, calls)
}

#[tokio::test]
async fn a_dated_list_admits_each_page_and_asks_for_what_is_left() {
    let (ids, asked, calls) = list_since(
        vec![page(&["a", "b"], Some("p2")), page(&["c", "d"], Some("p3"))],
        3,
    )
    .await;

    assert_eq!(ids, vec!["a", "b", "c"]);
    assert_eq!(asked, vec![(3, None), (1, Some("p2".to_string()))]);
    let admitted = calls
        .iter()
        .filter(|call| matches!(call, Call::Acquire(_, ApiOperationKind::ListMessages)))
        .count();
    assert_eq!(admitted, 2);
}

#[tokio::test]
async fn a_dated_list_stops_at_an_empty_page_or_a_token_it_has_seen() {
    let (ids, asked, _) = list_since(
        vec![
            page(&["a"], Some("p2")),
            page(&["b"], Some("p2")),
            page(&["c"], None),
        ],
        10,
    )
    .await;
    assert_eq!(ids, vec!["a", "b"]);
    assert_eq!(asked.len(), 2);

    let (ids, asked, _) = list_since(vec![page(&[], Some("p2")), page(&["b"], None)], 10).await;
    assert!(ids.is_empty());
    assert_eq!(asked.len(), 1);
}

#[tokio::test]
async fn a_dated_list_follows_at_most_its_page_cap() {
    let answers = (0..10)
        .map(|n| MessageIdPage {
            ids: vec![format!("m{n}")],
            next_page_token: Some(format!("p{}", n + 1)),
        })
        .collect();

    let (ids, asked, _) = list_since(answers, 500).await;

    assert_eq!(asked.len(), 5);
    assert_eq!(ids.len(), 5);
}

#[tokio::test]
async fn a_dated_list_keeps_what_it_listed_when_a_later_page_fails() {
    let refused = || EmailApiError::RateLimited {
        retry_after: None,
        origin: crate::domain::models::RateLimitOrigin::Local,
    };
    let (ids, asked, _) =
        list_since_answers(vec![Ok(page(&["a", "b"], Some("p2"))), Err(refused())], 10).await;
    assert_eq!(ids.unwrap(), vec!["a", "b"]);
    assert_eq!(asked.len(), 2);

    // The first page's failure is the answer, for the caller to wait out.
    let (ids, _, _) = list_since_answers(vec![Err(refused())], 10).await;
    assert!(matches!(ids, Err(EmailApiError::RateLimited { .. })));
}

fn label_write_service(
    writes: LabelWrites,
    calls: super::super::test_support::CallLog,
) -> EmailApiClientServiceImpl<MessageClient, FakeTokenSource, FakeGate> {
    EmailApiClientServiceImpl::new(
        MessageClient {
            label_writes: Some(writes),
            ..Default::default()
        },
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeGate::new(calls, Ok(())),
    )
}

#[tokio::test]
async fn label_writes_on_few_messages_go_out_one_request_each_skipping_deleted_messages() {
    let calls = call_log();
    let writes = LabelWrites {
        errors: vec![("message-2".into(), EmailApiError::NotFound)],
        ..Default::default()
    };
    let written = writes.written.clone();
    let link_id = Uuid::new_v4();

    label_write_service(writes, calls.clone())
        .modify_message_labels(
            link_id,
            &["message-1".into(), "message-2".into(), "message-3".into()],
            &["TRASH".into()],
            &[],
        )
        .await
        .unwrap();

    assert_eq!(
        *written.lock().unwrap(),
        ["message-1", "message-2", "message-3"]
    );
    // Each write takes its own permit, so the gate counts its quota and slot.
    assert_eq!(
        *calls.lock().unwrap(),
        [None, Some(EmailApiError::NotFound), None]
            .into_iter()
            .flat_map(|provider_error| [
                Call::Acquire(link_id, ApiOperationKind::ModifyMessageLabels),
                Call::Token(link_id, TokenFreshness::Cached),
                Call::Finish(link_id, provider_error),
            ])
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn separate_label_writes_stop_at_the_first_failure() {
    let rate_limited = EmailApiError::RateLimited {
        retry_after: None,
        origin: crate::domain::models::RateLimitOrigin::Provider { concurrency: true },
    };
    let writes = LabelWrites {
        errors: vec![("message-2".into(), rate_limited.clone())],
        ..Default::default()
    };
    let written = writes.written.clone();

    let result = label_write_service(writes, call_log())
        .modify_message_labels(
            Uuid::new_v4(),
            &["message-1".into(), "message-2".into(), "message-3".into()],
            &["TRASH".into()],
            &[],
        )
        .await;

    assert_eq!(result, Err(rate_limited));
    assert_eq!(*written.lock().unwrap(), ["message-1", "message-2"]);
}

#[tokio::test]
async fn a_lone_label_write_on_a_deleted_message_fails() {
    let writes = LabelWrites {
        errors: vec![("message-1".into(), EmailApiError::NotFound)],
        ..Default::default()
    };

    let result = label_write_service(writes, call_log())
        .modify_message_labels(
            Uuid::new_v4(),
            &["message-1".into()],
            &["TRASH".into()],
            &[],
        )
        .await;

    assert_eq!(result, Err(EmailApiError::NotFound));
}

#[tokio::test]
async fn label_writes_without_messages_make_no_provider_call() {
    let calls = call_log();
    let repository = MessageClient::default();
    let repository_call = repository.call.clone();
    let service = EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeGate::new(calls.clone(), Ok(())),
    );

    service
        .modify_message_labels(Uuid::new_v4(), &[], &[], &["INBOX".into()])
        .await
        .unwrap();
    assert_eq!(*repository_call.lock().unwrap(), None);
    assert!(calls.lock().unwrap().is_empty());
}
