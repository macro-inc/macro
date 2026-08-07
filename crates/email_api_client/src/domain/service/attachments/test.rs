use std::sync::{Arc, Mutex};

use uuid::Uuid;

use super::super::test_support::{Call, FakeRateLimiter, FakeTokenSource, block_on, call_log};
use super::*;
use crate::domain::models::{AccessToken, TokenFreshness};

#[derive(Clone, Default)]
struct AttachmentClient {
    arguments: Arc<Mutex<Option<(String, String, String)>>>,
}

impl MailboxAttachmentClient for AttachmentClient {
    async fn get_attachment(
        &self,
        access_token: &AccessToken,
        message_id: &str,
        attachment_id: &str,
    ) -> Result<Vec<u8>, EmailApiError> {
        *self.arguments.lock().unwrap() = Some((
            access_token.expose_secret().to_string(),
            message_id.to_string(),
            attachment_id.to_string(),
        ));
        Ok(vec![1, 2, 3])
    }
}

#[test]
fn get_attachment_uses_attachment_quota_and_forwards_identifiers() {
    let calls = call_log();
    let repository = AttachmentClient::default();
    let arguments = repository.arguments.clone();
    let link_id = Uuid::new_v4();
    let service = EmailApiClientServiceImpl::new(
        repository,
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("token"))),
        FakeRateLimiter::new(calls.clone(), Ok(())),
    );

    let result = block_on(service.get_attachment(link_id, "message", "attachment"));

    assert_eq!(result.unwrap(), vec![1, 2, 3]);
    assert_eq!(
        *arguments.lock().unwrap(),
        Some(("token".into(), "message".into(), "attachment".into()))
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            Call::RateLimit(link_id, ApiOperationKind::GetAttachment),
            Call::Token(link_id, TokenFreshness::Cached),
        ]
    );
}
