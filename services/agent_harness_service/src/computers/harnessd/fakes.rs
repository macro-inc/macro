//! In-memory harnessd and locks for the control plane's tests.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::Mutex;

use harness_id::HarnessId;
use harnessd_protocol::{Request, Response};
use harnesses::domain::account_logins::AccountLoginChange;
use harnesses::domain::ports::MockHarnessRepo;
use harnesses::domain::service::HarnessServiceImpl;
use hosted_runtimes::domain::ids::ComputerId;

use super::{ComputerLock, ComputerLocks, HarnessdError, HarnessdTransport};

/// harnessd answering each request with `answer`, recording every request
/// it was sent. With `hold_complete`, a completion waits until a cancel
/// arrives, as a real one waits on Claude.
pub(crate) struct FakeHarnessd {
    pub(crate) requests: Mutex<Vec<Request>>,
    answer: Box<dyn Fn(&Request) -> Response + Send + Sync>,
    hold_complete: bool,
    /// Signalled when a completion starts waiting.
    pub(crate) complete_started: tokio::sync::Notify,
    cancelled: tokio::sync::Semaphore,
}

impl FakeHarnessd {
    pub(crate) fn new(answer: impl Fn(&Request) -> Response + Send + Sync + 'static) -> Self {
        Self {
            requests: Mutex::new(Vec::new()),
            answer: Box::new(answer),
            hold_complete: false,
            complete_started: tokio::sync::Notify::new(),
            cancelled: tokio::sync::Semaphore::new(0),
        }
    }

    /// Let a waiting completion answer, as a cancel would.
    pub(crate) fn release_complete(&self) {
        self.cancelled.add_permits(1);
    }

    /// Make a completion wait for a cancel.
    pub(crate) fn holding_complete(mut self) -> Self {
        self.hold_complete = true;
        self
    }
}

impl HarnessdTransport for FakeHarnessd {
    fn round_trip(
        &self,
        _computer_id: ComputerId,
        request: Request,
    ) -> Pin<Box<dyn Future<Output = Result<Response, HarnessdError>> + Send + '_>> {
        Box::pin(async move {
            self.requests.lock().unwrap().push(request.clone());
            match &request {
                Request::SignInComplete { .. } if self.hold_complete => {
                    self.complete_started.notify_one();
                    let _permit = self.cancelled.acquire().await.unwrap();
                }
                Request::SignInCancel { .. } => self.cancelled.add_permits(1),
                _ => {}
            }
            Ok((self.answer)(&request))
        })
    }
}

/// One lock for every computer.
#[derive(Default)]
pub(crate) struct FakeLocks {
    lock: Arc<tokio::sync::Mutex<()>>,
}

impl ComputerLocks for FakeLocks {
    fn lock(
        &self,
        _computer_id: ComputerId,
    ) -> Pin<Box<dyn Future<Output = Result<ComputerLock, HarnessdError>> + Send + '_>> {
        Box::pin(async move { Ok(Box::new(Arc::clone(&self.lock).lock_owned().await) as ComputerLock) })
    }
}

/// A harness service whose repo records every login change.
pub(crate) fn recording_harnesses(
    changes: Arc<Mutex<Vec<(HarnessId, AccountLoginChange)>>>,
) -> HarnessServiceImpl<MockHarnessRepo> {
    let mut repo = MockHarnessRepo::new();
    repo.expect_record_account_login()
        .returning(move |harness_id, change| {
            changes.lock().unwrap().push((harness_id, change));
            Box::pin(async { Ok(true) })
        });
    HarnessServiceImpl::new(repo)
}
