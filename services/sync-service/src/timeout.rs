use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};
use tracing::error;
use worker::wasm_bindgen::JsCast;
use worker::wasm_bindgen_futures::JsFuture;
use worker::worker_sys::web_sys::{WorkerGlobalScope, js_sys};

pub const DEFAULT_TIMEOUT_MS: u32 = 4_500;

/// Error type for timeout operations
#[derive(Debug, Clone)]
pub struct TimeoutError {
    duration_ms: u32,
}
impl From<TimeoutError> for worker::Error {
    fn from(value: TimeoutError) -> Self {
        worker::Error::from(format!("{value}"))
    }
}

impl TimeoutError {
    pub fn new(duration_ms: u32) -> Self {
        Self { duration_ms }
    }
}

impl std::fmt::Display for TimeoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Operation timed out after {}ms", self.duration_ms)
    }
}

impl std::error::Error for TimeoutError {}

/// Timeout result - either the operation completed or it timed out
#[derive(Debug)]
pub enum TimeoutResult<T> {
    /// The operation completed successfully
    Ok(T),
    /// The operation timed out
    Timeout(TimeoutError),
}

/// Creates a timeout future that resolves after the specified duration
fn create_timeout_future(duration_ms: u32) -> JsFuture {
    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        let timeout_id = js_sys::global()
            .unchecked_into::<WorkerGlobalScope>()
            .set_timeout_with_callback_and_timeout_and_arguments_0(&resolve, duration_ms as i32)
            .expect("Failed to set timeout");

        // Store timeout_id if we need to cancel it later
        // For now, we let it run to completion
        _ = timeout_id;
    });

    JsFuture::from(promise)
}

/// A future that races an operation against a timeout
pub struct Timeout<F> {
    future: Pin<Box<F>>,
    timeout_future: Pin<Box<JsFuture>>,
    duration_ms: u32,
    completed: bool,
}

impl<F> Timeout<F>
where
    F: Future,
{
    fn new(future: F, duration_ms: u32) -> Self {
        Self {
            future: Box::pin(future),
            timeout_future: Box::pin(create_timeout_future(duration_ms)),
            duration_ms,
            completed: false,
        }
    }
}

impl<F> Future for Timeout<F>
where
    F: Future,
{
    type Output = TimeoutResult<F::Output>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        if self.completed {
            panic!("Timeout future polled after completion");
        }

        // First check if the main future is ready
        if let Poll::Ready(result) = self.future.as_mut().poll(cx) {
            self.completed = true;
            return Poll::Ready(TimeoutResult::Ok(result));
        }

        // Then check if the timeout has elapsed
        if self.timeout_future.as_mut().poll(cx).is_ready() {
            self.completed = true;
            error!(
                timeout_duration_ms = self.duration_ms,
                "A future has timed out"
            );
            return Poll::Ready(TimeoutResult::Timeout(TimeoutError::new(self.duration_ms)));
        }

        Poll::Pending
    }
}

impl<T> TimeoutResult<T> {
    /// Converts the TimeoutResult into a standard Result
    pub fn into_result(self) -> Result<T, TimeoutError> {
        match self {
            TimeoutResult::Ok(value) => Ok(value),
            TimeoutResult::Timeout(err) => Err(err),
        }
    }
}

/// Applies a timeout to a future, similar to `tokio::time::timeout`
///
/// # Arguments
/// * `future` - The future to wrap with a timeout
/// * `duration_ms` - Timeout duration in milliseconds
///
/// # Returns
/// A `TimeoutResult` indicating whether the operation completed or timed out
///
/// # Examples
/// ```rust
/// use crate::timeout::{timeout, TimeoutResult};
///
/// async fn example() {
///     let result = timeout(some_async_operation(), 5000).await;
///     match result {
///         TimeoutResult::Ok(value) => println!("Got result: {:?}", value),
///         TimeoutResult::Timeout(err) => println!("Operation timed out: {}", err),
///     }
/// }
/// ```
pub fn timeout<F>(future: F, duration_ms: u32) -> Timeout<F>
where
    F: Future,
{
    Timeout::new(future, duration_ms)
}

#[macro_export]
macro_rules! timeout_ez {
    ($future:expr) => {
        $crate::timeout::timeout($future, $crate::timeout::DEFAULT_TIMEOUT_MS)
            .await
            .into_result()?
    };
}
