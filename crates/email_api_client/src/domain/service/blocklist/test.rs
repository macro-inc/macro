use std::future::Future;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};

use uuid::Uuid;

use super::super::super::models::{AccessToken, EmailApiError, TokenFreshness};
use super::super::super::ports::MailboxBlocklistClient;
use super::super::test_support::{Call, FakeRateLimiter, FakeTokenSource, call_log};
use super::EmailApiClientServiceImpl;

#[derive(Clone)]
struct BlocklistClient {
    calls: super::super::test_support::CallLog,
}

impl MailboxBlocklistClient for BlocklistClient {
    async fn block_sender(
        &self,
        _: &AccessToken,
        email_address: &str,
    ) -> Result<(), EmailApiError> {
        assert_eq!(email_address, "blocked@example.com");
        self.record("block_sender");
        Ok(())
    }

    async fn unblock_sender(
        &self,
        _: &AccessToken,
        email_address: &str,
    ) -> Result<(), EmailApiError> {
        assert_eq!(email_address, "blocked@example.com");
        self.record("unblock_sender");
        Ok(())
    }

    async fn list_blocked_senders(&self, _: &AccessToken) -> Result<Vec<String>, EmailApiError> {
        self.record("list_blocked_senders");
        Ok(vec!["blocked@example.com".to_string()])
    }
}

impl BlocklistClient {
    fn record(&self, method: &'static str) {
        self.calls.lock().unwrap().push(Call::Repository(method));
    }
}

#[test]
fn blocklist_methods_use_their_matching_costs_and_operations() {
    for (operation, repository_call) in [
        (super::ApiOperationKind::BlockSender, "block_sender"),
        (super::ApiOperationKind::UnblockSender, "unblock_sender"),
        (
            super::ApiOperationKind::ListBlockedSenders,
            "list_blocked_senders",
        ),
    ] {
        let calls = call_log();
        let service = service(calls.clone());

        match operation {
            super::ApiOperationKind::BlockSender => {
                block_on(service.block_sender(Uuid::nil(), "blocked@example.com")).unwrap()
            }
            super::ApiOperationKind::UnblockSender => {
                block_on(service.unblock_sender(Uuid::nil(), "blocked@example.com")).unwrap()
            }
            super::ApiOperationKind::ListBlockedSenders => {
                assert_eq!(
                    block_on(service.list_blocked_senders(Uuid::nil())).unwrap(),
                    vec!["blocked@example.com"]
                );
            }
            _ => unreachable!(),
        }

        assert_eq!(
            *calls.lock().unwrap(),
            vec![
                Call::RateLimit(Uuid::nil(), operation),
                Call::Token(Uuid::nil(), TokenFreshness::Cached),
                Call::Repository(repository_call),
            ]
        );
    }
}

fn service(
    calls: super::super::test_support::CallLog,
) -> EmailApiClientServiceImpl<BlocklistClient, FakeTokenSource, FakeRateLimiter> {
    EmailApiClientServiceImpl::new(
        BlocklistClient {
            calls: calls.clone(),
        },
        FakeTokenSource::new(calls.clone(), Ok(AccessToken::new("access-token"))),
        FakeRateLimiter::new(calls, Ok(())),
    )
}

struct NoopWaker;

impl Wake for NoopWaker {
    fn wake(self: Arc<Self>) {}
}

fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(NoopWaker));
    let mut context = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        match future.as_mut().poll(&mut context) {
            Poll::Ready(output) => return output,
            Poll::Pending => std::thread::yield_now(),
        }
    }
}
