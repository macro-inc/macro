//! Stacks started ahead of the tests that will ask for them.
//!
//! A stack takes a few seconds to start, nearly all of it the services'
//! own startup. The pool keeps a number of them started, so a test that
//! asks for a stack is handed one at once and another is started in its
//! place. A stack is still handed out once and ended by its test: nothing
//! is shared between tests that was not shared before.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::Semaphore;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::stack::{Stack, StackOptions};

/// How many stacks to keep started: unset or `0` starts each stack when it
/// is asked for.
const SIZE_ENV: &str = "EMAIL_E2E_STACK_POOL";

/// What a stack of the web app's suite is started with, besides the test's
/// own environment for the services.
pub(super) fn options(env: Vec<(String, String)>) -> StackOptions {
    // Two steps, so that a field added to the options later takes its
    // default here and neither step names every field.
    let web_app = StackOptions {
        document_storage: true,
        ..StackOptions::default()
    };
    StackOptions { env, ..web_app }
}

/// The size the environment asks for.
pub(super) fn size_from_env() -> usize {
    #[expect(
        clippy::disallowed_methods,
        reason = "test support: the suite's own settings come from the process environment"
    )]
    let size = std::env::var(SIZE_ENV).ok();
    size.and_then(|size| size.parse().ok()).unwrap_or(0)
}

struct Shared {
    size: usize,
    ready: Mutex<VecDeque<Stack>>,
    /// One permit for each stack that is to be started.
    wanted: Semaphore,
    /// The stacks that are ready or being started.
    kept: AtomicUsize,
    stop: CancellationToken,
}

impl Shared {
    fn ready(&self) -> std::sync::MutexGuard<'_, VecDeque<Stack>> {
        // A poisoned lock still guards a usable queue.
        self.ready
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    async fn fill(&self) {
        loop {
            let permit = tokio::select! {
                biased;
                () = self.stop.cancelled() => return,
                permit = self.wanted.acquire() => permit,
            };
            let Ok(permit) = permit else { return };
            permit.forget();
            match Stack::start_with(options(Vec::new())).await {
                Ok(stack) => self.ready().push_back(stack),
                // The pool is one smaller until a test has started a stack
                // of its own: that start fails the same way if the cause
                // lasts, in the test's output, and gives the place back if
                // it does not.
                Err(error) => {
                    self.kept.fetch_sub(1, Ordering::SeqCst);
                    eprintln!("email_e2e: a stack could not be started ahead of its test: {error}");
                }
            }
        }
    }
}

/// What a route does with the pool. The pool itself stays with the server,
/// which ends it whatever is still held of the routes' state.
#[derive(Clone)]
pub(super) struct Taker(Arc<Shared>);

impl Taker {
    /// A started stack, when one is ready; another is started in its place.
    /// Its services may have died while it waited: the caller checks.
    pub(super) fn take(&self) -> Option<Stack> {
        let stack = self.0.ready().pop_front()?;
        self.0.wanted.add_permits(1);
        Some(stack)
    }

    /// Tells the pool that a test started a stack of its own because none
    /// was ready: a place lost to a failed start is filled again.
    pub(super) fn started_outside(&self) {
        let regained = self
            .0
            .kept
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |kept| {
                (kept < self.0.size).then_some(kept + 1)
            })
            .is_ok();
        if regained {
            self.0.wanted.add_permits(1);
        }
    }
}

/// The stacks kept started, and the threads that start them.
pub(super) struct Pool {
    shared: Arc<Shared>,
    fillers: Vec<JoinHandle<()>>,
}

impl Pool {
    /// Starts `size` stacks, and from then on one for each that is taken.
    pub(super) fn start(size: usize) -> Self {
        let shared = Arc::new(Shared {
            size,
            ready: Mutex::new(VecDeque::new()),
            wanted: Semaphore::new(size),
            kept: AtomicUsize::new(size),
            stop: CancellationToken::new(),
        });
        let runtime = tokio::runtime::Handle::current();
        // A stack's start is not `Send`, so each filler has a thread.
        let fillers = (0..size)
            .map(|_| {
                let shared = shared.clone();
                let runtime = runtime.clone();
                tokio::task::spawn_blocking(move || runtime.block_on(shared.fill()))
            })
            .collect();
        Self { shared, fillers }
    }

    /// The routes' side of the pool.
    pub(super) fn taker(&self) -> Taker {
        Taker(self.shared.clone())
    }

    /// Stops starting stacks and ends those no test took.
    pub(super) async fn finish(self) {
        self.shared.stop.cancel();
        self.shared.wanted.close();
        for filler in self.fillers {
            // A start under way is finished first, and its stack ended below.
            let _ = filler.await;
        }
        let left: Vec<Stack> = self.shared.ready().drain(..).collect();
        for stack in left {
            if let Err(error) = stack.finish().await {
                eprintln!("email_e2e: a stack no test took did not end cleanly: {error}");
            }
        }
    }
}
