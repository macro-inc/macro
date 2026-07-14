//! Bounded, best-effort event publishing with managed shutdown.

#[cfg(test)]
mod test;

use std::any::type_name;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use macro_event_topics::Topic as _;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tracing::Instrument as _;

use crate::domain::models::{EventBrokerError, MacroEvent};
use crate::domain::ports::{EventPublisher, MacroEventBroker};

const DEFAULT_QUEUE_CAPACITY: usize = 1_024;
const DEFAULT_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Configuration for a [`BufferedMacroEventBroker`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BufferedBrokerConfig {
    /// Maximum number of events waiting to be published.
    pub queue_capacity: usize,
    /// Maximum time graceful shutdown may spend draining accepted events.
    pub shutdown_timeout: Duration,
}

impl Default for BufferedBrokerConfig {
    fn default() -> Self {
        Self {
            queue_capacity: DEFAULT_QUEUE_CAPACITY,
            shutdown_timeout: DEFAULT_SHUTDOWN_TIMEOUT,
        }
    }
}

/// A point-in-time view of buffered broker counters.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct BufferedBrokerStats {
    /// Events accepted into the bounded queue.
    pub accepted: u64,
    /// Events rejected because the queue was full.
    pub full: u64,
    /// Events rejected because intake was closed.
    pub closed: u64,
    /// Events delivered successfully by the publisher.
    pub delivered: u64,
    /// Events rejected by the publisher.
    pub failed: u64,
    /// Accepted events not completed before the worker stopped.
    pub abandoned: u64,
}

/// Final delivery counts from a buffered broker shutdown.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct BufferedBrokerShutdownReport {
    /// Events delivered successfully over the broker's lifetime.
    pub delivered: u64,
    /// Publisher failures over the broker's lifetime.
    pub failed: u64,
    /// Accepted events abandoned when the worker stopped.
    pub abandoned: u64,
    /// Whether shutdown exceeded its configured drain timeout.
    pub timed_out: bool,
}

#[derive(Debug)]
struct SerializedEvent {
    topic: &'static str,
    key: String,
    payload: Vec<u8>,
    enqueued_at: Instant,
}

#[derive(Debug, Default)]
struct Counters {
    accepted: AtomicU64,
    full: AtomicU64,
    closed: AtomicU64,
    delivered: AtomicU64,
    failed: AtomicU64,
    abandoned: AtomicU64,
}

impl Counters {
    fn snapshot(&self) -> BufferedBrokerStats {
        BufferedBrokerStats {
            accepted: self.accepted.load(Ordering::Relaxed),
            full: self.full.load(Ordering::Relaxed),
            closed: self.closed.load(Ordering::Relaxed),
            delivered: self.delivered.load(Ordering::Relaxed),
            failed: self.failed.load(Ordering::Relaxed),
            abandoned: self.abandoned.load(Ordering::Relaxed),
        }
    }
}

#[derive(Debug, Default)]
struct Lifecycle {
    closed: bool,
    terminated: bool,
}

#[derive(Debug, Default)]
struct SharedState {
    counters: Counters,
    lifecycle: Mutex<Lifecycle>,
}

impl SharedState {
    fn close(&self) {
        self.lifecycle.lock().unwrap().closed = true;
    }

    fn is_closed(&self) -> bool {
        self.lifecycle.lock().unwrap().closed
    }

    fn record_delivery(&self, delivered: bool) {
        let lifecycle = self.lifecycle.lock().unwrap();
        if lifecycle.terminated {
            return;
        }

        if delivered {
            self.counters.delivered.fetch_add(1, Ordering::Relaxed);
        } else {
            self.counters.failed.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn terminate(&self) -> u64 {
        let mut lifecycle = self.lifecycle.lock().unwrap();
        lifecycle.closed = true;
        if lifecycle.terminated {
            return 0;
        }
        lifecycle.terminated = true;

        let stats = self.counters.snapshot();
        let completed = stats
            .delivered
            .saturating_add(stats.failed)
            .saturating_add(stats.abandoned);
        let abandoned = stats.accepted.saturating_sub(completed);
        self.counters
            .abandoned
            .fetch_add(abandoned, Ordering::Relaxed);
        abandoned
    }

    fn snapshot(&self) -> BufferedBrokerStats {
        let _lifecycle = self.lifecycle.lock().unwrap();
        self.counters.snapshot()
    }
}

/// A cloneable broker that acknowledges local queue acceptance, not delivery.
///
/// [`MacroEventBroker::send_event`] serializes an event and uses a non-blocking
/// enqueue operation. A single worker owned by [`BufferedBrokerRuntime`] performs
/// all publisher I/O.
#[derive(Clone)]
pub struct BufferedMacroEventBroker {
    sender: mpsc::Sender<SerializedEvent>,
    state: Arc<SharedState>,
    queue_capacity: usize,
}

impl BufferedMacroEventBroker {
    /// Start a bounded broker and its managed publishing worker.
    ///
    /// # Panics
    ///
    /// Panics if `config.queue_capacity` is zero. A zero-capacity Tokio channel
    /// is invalid, so the configuration is checked before channel construction.
    pub fn start<P: EventPublisher>(
        publisher: P,
        config: BufferedBrokerConfig,
    ) -> (Self, BufferedBrokerRuntime) {
        assert!(
            config.queue_capacity > 0,
            "buffered broker queue capacity must be greater than zero"
        );

        let state = Arc::new(SharedState::default());
        let (sender, receiver) = mpsc::channel(config.queue_capacity);
        let (shutdown_sender, shutdown_receiver) = oneshot::channel();

        tracing::info!(
            publisher_type = type_name::<P>(),
            queue_capacity = config.queue_capacity,
            shutdown_timeout_ms = duration_millis(config.shutdown_timeout),
            "starting buffered macro event broker worker"
        );

        let worker_state = Arc::clone(&state);
        let worker = tokio::spawn(run_worker(
            publisher,
            receiver,
            shutdown_receiver,
            worker_state,
        ));

        let broker = Self {
            sender,
            state: Arc::clone(&state),
            queue_capacity: config.queue_capacity,
        };
        let runtime = BufferedBrokerRuntime {
            shutdown_sender: Some(shutdown_sender),
            worker: Some(worker),
            state,
            shutdown_timeout: config.shutdown_timeout,
            publisher_type: type_name::<P>(),
        };

        (broker, runtime)
    }

    /// Return a read-only snapshot of the broker's counters.
    pub fn stats(&self) -> BufferedBrokerStats {
        self.state.snapshot()
    }
}

impl MacroEventBroker for BufferedMacroEventBroker {
    #[tracing::instrument(
        err,
        skip(self, event),
        fields(topic = tracing::field::Empty, key = %event.key())
    )]
    async fn send_event<E: MacroEvent + ?Sized>(&self, event: &E) -> Result<(), EventBrokerError> {
        let topic = event.topic().as_str();
        tracing::Span::current().record("topic", tracing::field::display(topic));

        let payload = serde_json::to_vec(event.event())?;
        let serialized_event = SerializedEvent {
            topic,
            key: event.key().to_owned(),
            payload,
            enqueued_at: Instant::now(),
        };

        let mut lifecycle = self.state.lifecycle.lock().unwrap();
        if lifecycle.closed {
            self.state.counters.closed.fetch_add(1, Ordering::Relaxed);
            let error = EventBrokerError::QueueClosed;
            tracing::warn!(
                topic,
                key = %serialized_event.key,
                error = ?error,
                "rejected buffered macro event because intake is closed"
            );
            return Err(error);
        }

        match self.sender.try_send(serialized_event) {
            Ok(()) => {
                self.state.counters.accepted.fetch_add(1, Ordering::Relaxed);
                Ok(())
            }
            Err(mpsc::error::TrySendError::Full(event)) => {
                self.state.counters.full.fetch_add(1, Ordering::Relaxed);
                let error = EventBrokerError::QueueFull {
                    capacity: self.queue_capacity,
                };
                tracing::warn!(
                    topic = event.topic,
                    key = %event.key,
                    capacity = self.queue_capacity,
                    error = ?error,
                    "rejected buffered macro event because the queue is full"
                );
                Err(error)
            }
            Err(mpsc::error::TrySendError::Closed(event)) => {
                lifecycle.closed = true;
                self.state.counters.closed.fetch_add(1, Ordering::Relaxed);
                let error = EventBrokerError::QueueClosed;
                tracing::error!(
                    topic = event.topic,
                    key = %event.key,
                    error = ?error,
                    "rejected buffered macro event because the worker is unavailable"
                );
                Err(error)
            }
        }
    }
}

/// Non-cloneable owner of a buffered broker's shutdown signal and worker task.
///
/// Production composition roots should retain this value and call
/// [`shutdown`](Self::shutdown) after event producers have stopped.
pub struct BufferedBrokerRuntime {
    shutdown_sender: Option<oneshot::Sender<()>>,
    worker: Option<JoinHandle<()>>,
    state: Arc<SharedState>,
    shutdown_timeout: Duration,
    publisher_type: &'static str,
}

impl BufferedBrokerRuntime {
    /// Return a read-only snapshot of the broker's counters.
    pub fn stats(&self) -> BufferedBrokerStats {
        self.state.snapshot()
    }

    /// Close intake, drain accepted events, and stop within the configured timeout.
    pub async fn shutdown(mut self) -> BufferedBrokerShutdownReport {
        self.begin_shutdown();
        let mut timed_out = false;
        let worker_result = {
            let worker = self
                .worker
                .as_mut()
                .expect("buffered broker runtime must own its worker");
            tokio::time::timeout(self.shutdown_timeout, worker).await
        };

        match worker_result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                tracing::error!(
                    error = ?error,
                    publisher_type = self.publisher_type,
                    "buffered macro event broker worker terminated unexpectedly"
                );
            }
            Err(_) => {
                timed_out = true;
                if let Some(worker) = self.worker.as_mut() {
                    worker.abort();
                    let _ = worker.await;
                }
                self.state.terminate();

                let stats = self.state.snapshot();
                tracing::warn!(
                    publisher_type = self.publisher_type,
                    shutdown_timeout_ms = duration_millis(self.shutdown_timeout),
                    delivered = stats.delivered,
                    failed = stats.failed,
                    abandoned = stats.abandoned,
                    "buffered macro event broker shutdown timed out"
                );
            }
        }

        let _ = self.worker.take();
        self.state.terminate();
        let stats = self.state.snapshot();
        let report = BufferedBrokerShutdownReport {
            delivered: stats.delivered,
            failed: stats.failed,
            abandoned: stats.abandoned,
            timed_out,
        };

        tracing::info!(
            publisher_type = self.publisher_type,
            delivered = report.delivered,
            failed = report.failed,
            abandoned = report.abandoned,
            timed_out = report.timed_out,
            "buffered macro event broker shutdown complete"
        );

        report
    }

    fn begin_shutdown(&mut self) {
        self.state.close();
        if let Some(shutdown_sender) = self.shutdown_sender.take() {
            let _ = shutdown_sender.send(());
        }
    }
}

impl Drop for BufferedBrokerRuntime {
    fn drop(&mut self) {
        self.begin_shutdown();
        if let Some(worker) = self.worker.take() {
            worker.abort();
        }
        self.state.terminate();
    }
}

struct WorkerExitGuard {
    state: Arc<SharedState>,
}

impl Drop for WorkerExitGuard {
    fn drop(&mut self) {
        let shutdown_requested = self.state.is_closed();
        self.state.terminate();
        let stats = self.state.snapshot();

        if shutdown_requested {
            tracing::info!(
                delivered = stats.delivered,
                failed = stats.failed,
                abandoned = stats.abandoned,
                "buffered macro event broker worker exited"
            );
        } else {
            tracing::error!(
                delivered = stats.delivered,
                failed = stats.failed,
                abandoned = stats.abandoned,
                "buffered macro event broker worker exited unexpectedly"
            );
        }
    }
}

async fn run_worker<P: EventPublisher>(
    publisher: P,
    mut receiver: mpsc::Receiver<SerializedEvent>,
    mut shutdown_receiver: oneshot::Receiver<()>,
    state: Arc<SharedState>,
) {
    let _exit_guard = WorkerExitGuard {
        state: Arc::clone(&state),
    };
    let mut draining = false;

    loop {
        let next_event = if draining {
            receiver.recv().await
        } else {
            tokio::select! {
                biased;
                _ = &mut shutdown_receiver => {
                    state.close();
                    receiver.close();
                    draining = true;
                    receiver.recv().await
                }
                event = receiver.recv() => event,
            }
        };

        let Some(event) = next_event else {
            break;
        };

        publish_event(&publisher, event, &state).await;
    }
}

async fn publish_event<P: EventPublisher>(
    publisher: &P,
    event: SerializedEvent,
    state: &SharedState,
) {
    let queue_delay_ms = duration_millis(event.enqueued_at.elapsed());
    let span = tracing::debug_span!(
        "publish_buffered_macro_event",
        topic = event.topic,
        key = %event.key,
        queue_delay_ms,
    );
    let result = publisher
        .publish(event.topic, &event.key, &event.payload)
        .instrument(span)
        .await;

    match result {
        Ok(()) => state.record_delivery(true),
        Err(error) => {
            state.record_delivery(false);
            tracing::error!(
                topic = event.topic,
                key = %event.key,
                queue_delay_ms,
                error = ?error,
                "buffered macro event delivery failed"
            );
        }
    }
}

fn duration_millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}
