use std::{sync::Arc, time::Duration};

use dashmap::DashMap;
use tokio::task::JoinHandle;
use tokio_util::task::TaskTracker;

pub trait Spawner {
    fn spawn<F>(&self, f: F) -> JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send;
}

#[derive(Debug, Clone, Copy)]
pub struct GlobalSpawner;

impl Spawner for GlobalSpawner {
    fn spawn<F>(&self, f: F) -> JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send,
    {
        tokio::spawn(f)
    }
}

impl Spawner for tokio_util::task::TaskTracker {
    fn spawn<F>(&self, f: F) -> JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send,
    {
        TaskTracker::spawn(self, f)
    }
}

pub struct BroadcastManager<T, K, V> {
    spawner: T,
    broadcast_buffer: usize,
    channel: Arc<DashMap<K, tokio::sync::broadcast::Sender<V>>>,
}

pub enum ExitReason<V> {
    /// we failed to send some incoming value because the receiver is closed
    FailedToSend(tokio::sync::mpsc::error::TrySendError<V>),
    /// the receiver end closed while we were waiting for a new broadcast message
    ReceiverClosed,
    /// This task is lagging too far behind other subscribers, we should close it
    Lagging(tokio::sync::broadcast::error::RecvError),
    /// The broadcast sender is closed and the channel is shutting down
    SenderClosed,
}

pub enum PublishFailure<V> {
    /// there are no listeners to key K which have subscribed
    NobodyIsListening,
    SendErr(tokio::sync::broadcast::error::SendError<V>),
}

impl<K: std::hash::Hash + Eq + Send + 'static, V: Clone + Send + 'static, T: Spawner>
    BroadcastManager<T, K, V>
{
    pub fn subscribe(&self, this_key: K, capacity: usize) -> tokio::sync::mpsc::Receiver<V> {
        let (tx, rx) = tokio::sync::mpsc::channel(capacity);

        let entry = self
            .channel
            .entry(this_key)
            .or_insert_with(|| tokio::sync::broadcast::Sender::new(self.broadcast_buffer));

        let mut broadcast_rx = entry.subscribe();
        drop(entry);

        self.spawner.spawn(async move {
            loop {
                tokio::select! {
                    msg = broadcast_rx.recv() => {
                        match msg {
                            Ok(v) => {
                                match tx.try_send(v) {
                                    Ok(_) => {},
                                    Err(e) => return ExitReason::FailedToSend(e),
                                }
                            }
                            Err(e @ tokio::sync::broadcast::error::RecvError::Lagged(_)) => return ExitReason::Lagging(e),
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => return ExitReason::SenderClosed
                        }
                    }
                    () = tx.closed() => {
                        return ExitReason::ReceiverClosed
                    }
                }
            }
        });
        rx
    }

    pub fn publish(&self, key: K, val: V) -> Result<usize, PublishFailure<V>> {
        let Some(tx) = self.channel.get(&key) else {
            return Err(PublishFailure::NobodyIsListening);
        };
        tx.send(val).map_err(PublishFailure::SendErr)
    }

    pub fn new(spawner: T, broadcast_buffer: usize) -> Self {
        let channel = Arc::new(DashMap::<K, tokio::sync::broadcast::Sender<V>>::new());

        Self {
            spawner,
            broadcast_buffer,
            channel,
        }
    }
}

impl<K: std::hash::Hash + Eq + Send + Sync + 'static, V: Clone + Send + 'static, T: Spawner>
    BroadcastManager<T, K, V>
{
    pub fn new_with_gc(spawner: T, broadcast_buffer: usize, gc_interval: Duration) -> Self {
        let channel = Arc::new(DashMap::<K, tokio::sync::broadcast::Sender<V>>::new());

        let weak = Arc::downgrade(&channel);
        spawner.spawn(async move {
            let mut i = tokio::time::interval(gc_interval);
            loop {
                i.tick().await;
                match weak.upgrade() {
                    Some(map) => map.retain(|_k, v| v.receiver_count() > 0),
                    None => {
                        tracing::info!(
                            "No more strong references to Broadcast map, closing gc loop."
                        );
                        return;
                    }
                }
            }
        });

        Self {
            spawner,
            broadcast_buffer,
            channel,
        }
    }
}

impl<K, V> BroadcastManager<tokio_util::task::TaskTracker, K, V> {
    pub async fn shutdown(self) {
        let Self {
            channel, spawner, ..
        } = self;
        drop(channel);
        spawner.close();
        spawner.wait().await;
    }
}
