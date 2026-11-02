use std::collections::{HashSet, VecDeque};
use std::sync::Mutex;
use std::time::Duration;

use uuid::Uuid;

use super::super::test_support::{Call, CallLog, FakeGate, FakeTokenSource, call_log};
use super::*;
use crate::domain::models::{
    AccessToken, ChangePage, InboxChanges, RateLimitOrigin, RateLimitRefusal, RequestPermit,
    TokenFreshness,
};

#[derive(Default)]
struct SyncClient {
    pages: Mutex<VecDeque<ChangePage>>,
    requests: Mutex<Vec<(String, Option<String>)>>,
}

impl SyncClient {
    fn with_pages(pages: Vec<ChangePage>) -> Self {
        Self {
            pages: Mutex::new(pages.into()),
            requests: Mutex::default(),
        }
    }
}

impl MailboxSyncClient for SyncClient {
    async fn get_thread_count(&self, access_token: &AccessToken) -> Result<u64, EmailApiError> {
        assert_eq!(access_token.expose_secret(), "token");
        Ok(42)
    }

    async fn list_changes_page(
        &self,
        access_token: &AccessToken,
        cursor: &SyncCursor,
        page_token: Option<&str>,
    ) -> Result<ChangePage, EmailApiError> {
        assert_eq!(access_token.expose_secret(), "token");
        self.requests
            .lock()
            .unwrap()
            .push((cursor.as_str().to_string(), page_token.map(str::to_string)));
        Ok(self
            .pages
            .lock()
            .unwrap()
            .pop_front()
            .expect("the test configures every page the service reads"))
    }
}

/// Admits the first `admitted` requests and refuses the rest.
struct AdmitsFirst {
    calls: CallLog,
    admitted: Mutex<usize>,
}

impl ProviderRequestGate for AdmitsFirst {
    async fn acquire(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
    ) -> Result<RequestPermit, RateLimitRefusal> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Acquire(link_id, operation));
        let mut admitted = self.admitted.lock().unwrap();
        if *admitted == 0 {
            return Err(RateLimitRefusal::new(Some(Duration::from_secs(1))));
        }
        *admitted -= 1;
        Ok(RequestPermit::new(link_id, Uuid::nil(), |_, _| {}))
    }

    async fn finish(&self, permit: RequestPermit, error: Option<&EmailApiError>) {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Finish(permit.link_id(), error.cloned()));
        permit.disarm();
    }
}

fn service(
    repository: SyncClient,
    calls: &CallLog,
) -> EmailApiClientServiceImpl<SyncClient, FakeTokenSource, FakeGate> {
    EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeGate::new(calls.clone(), Ok(())),
    )
}

fn ids(values: &[&str]) -> HashSet<String> {
    values.iter().map(|value| value.to_string()).collect()
}

#[tokio::test]
async fn get_thread_count_uses_profile_quota_and_forwards_link_id() {
    let calls = call_log();
    let link_id = Uuid::new_v4();

    assert_eq!(
        service(SyncClient::default(), &calls)
            .get_thread_count(link_id)
            .await,
        Ok(42)
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Acquire(link_id, ApiOperationKind::GetProfile),
            Call::Token(link_id, TokenFreshness::Cached),
            Call::Finish(link_id, None),
        ]
    );
}

#[tokio::test]
async fn list_changes_uses_changes_quota_and_forwards_cursor() {
    let calls = call_log();
    let repository = SyncClient::with_pages(vec![ChangePage {
        changes: InboxChanges::default(),
        cursor: Some(SyncCursor::gmail("next")),
        next_page_token: None,
    }]);
    let link_id = Uuid::new_v4();

    let service = service(repository, &calls);
    let result = service
        .list_changes(link_id, &SyncCursor::gmail("cursor"))
        .await;

    assert_eq!(result.unwrap().next_cursor, SyncCursor::gmail("next"));
    assert_eq!(
        *service.repository.requests.lock().unwrap(),
        vec![("cursor".into(), None)]
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Acquire(link_id, ApiOperationKind::ListChanges),
            Call::Token(link_id, TokenFreshness::Cached),
            Call::Finish(link_id, None),
        ]
    );
}

#[tokio::test]
async fn each_history_page_is_admitted_on_its_own_and_later_pages_win() {
    let calls = call_log();
    let repository = SyncClient::with_pages(vec![
        ChangePage {
            changes: InboxChanges {
                message_ids_to_upsert: ids(&["kept", "deleted-later"]),
                ..InboxChanges::default()
            },
            cursor: Some(SyncCursor::gmail("200")),
            next_page_token: Some("page-2".into()),
        },
        ChangePage {
            changes: InboxChanges {
                message_ids_to_delete: ids(&["deleted-later"]),
                labels_to_update: ids(&["relabelled"]),
                ..InboxChanges::default()
            },
            cursor: Some(SyncCursor::gmail("300")),
            next_page_token: Some("page-3".into()),
        },
        ChangePage {
            changes: InboxChanges::default(),
            cursor: None,
            next_page_token: None,
        },
    ]);
    let link_id = Uuid::new_v4();

    let service = service(repository, &calls);
    let batch = service
        .list_changes(link_id, &SyncCursor::gmail("100"))
        .await
        .unwrap();

    assert_eq!(
        batch,
        ChangeBatch::new(
            InboxChanges {
                message_ids_to_upsert: ids(&["kept"]),
                message_ids_to_delete: ids(&["deleted-later"]),
                labels_to_update: ids(&["relabelled"]),
            },
            SyncCursor::gmail("300"),
        )
    );
    assert_eq!(
        *service.repository.requests.lock().unwrap(),
        vec![
            ("100".into(), None),
            ("100".into(), Some("page-2".into())),
            ("100".into(), Some("page-3".into())),
        ]
    );
    let page = [
        Call::Acquire(link_id, ApiOperationKind::ListChanges),
        Call::Token(link_id, TokenFreshness::Cached),
        Call::Finish(link_id, None),
    ];
    assert_eq!(
        *calls.lock().unwrap(),
        [page.clone(), page.clone(), page].concat()
    );
}

#[tokio::test]
async fn a_refused_page_fails_the_read_so_it_is_redelivered() {
    let calls = call_log();
    let repository = SyncClient::with_pages(vec![ChangePage {
        changes: InboxChanges {
            message_ids_to_upsert: ids(&["first-page"]),
            ..InboxChanges::default()
        },
        cursor: Some(SyncCursor::gmail("200")),
        next_page_token: Some("page-2".into()),
    }]);
    let link_id = Uuid::new_v4();
    let service = EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        AdmitsFirst {
            calls: calls.clone(),
            admitted: Mutex::new(1),
        },
    );

    let result = service
        .list_changes(link_id, &SyncCursor::gmail("100"))
        .await;

    assert_eq!(
        result,
        Err(EmailApiError::RateLimited {
            retry_after: Some(Duration::from_secs(1)),
            origin: RateLimitOrigin::Local,
        })
    );
    assert_eq!(
        *service.repository.requests.lock().unwrap(),
        vec![("100".into(), None)]
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Acquire(link_id, ApiOperationKind::ListChanges),
            Call::Token(link_id, TokenFreshness::Cached),
            Call::Finish(link_id, None),
            Call::Acquire(link_id, ApiOperationKind::ListChanges),
        ]
    );
}
