use std::sync::{Arc, Mutex};

use uuid::Uuid;

use super::super::test_support::{Call, FakeGate, FakeTokenSource, call_log};
use super::*;
use crate::domain::models::{AccessToken, InboxChanges, TokenFreshness};

#[derive(Clone, Default)]
struct SyncClient {
    cursor: Arc<Mutex<Option<String>>>,
}

impl MailboxSyncClient for SyncClient {
    async fn get_thread_count(&self, access_token: &AccessToken) -> Result<u64, EmailApiError> {
        assert_eq!(access_token.expose_secret(), "token");
        Ok(42)
    }

    async fn list_changes(
        &self,
        access_token: &AccessToken,
        cursor: &SyncCursor,
    ) -> Result<ChangeBatch, EmailApiError> {
        assert_eq!(access_token.expose_secret(), "token");
        *self.cursor.lock().unwrap() = Some(cursor.as_str().to_string());
        Ok(ChangeBatch::new(
            InboxChanges::default(),
            SyncCursor::gmail("next"),
        ))
    }
}

fn service(
    repository: SyncClient,
    calls: &super::super::test_support::CallLog,
) -> EmailApiClientServiceImpl<SyncClient, FakeTokenSource, FakeGate> {
    EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeGate::new(calls.clone(), Ok(())),
    )
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
    let repository = SyncClient::default();
    let captured_cursor = repository.cursor.clone();
    let link_id = Uuid::new_v4();
    let cursor = SyncCursor::gmail("cursor");

    let result = service(repository, &calls)
        .list_changes(link_id, &cursor)
        .await;

    assert_eq!(result.unwrap().next_cursor, SyncCursor::gmail("next"));
    assert_eq!(*captured_cursor.lock().unwrap(), Some("cursor".into()));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::Acquire(link_id, ApiOperationKind::ListChanges),
            Call::Token(link_id, TokenFreshness::Cached),
            Call::Finish(link_id, None),
        ]
    );
}
