//! Queues on Kafka: one topic and one consumer group per queue, and a compacted topic
//! holding each queue's settings so they survive a restart.

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use kafka_util::KafkaEventProducer;
use rdkafka::{
    ClientConfig, Message, Offset, TopicPartitionList,
    admin::{AdminClient, AdminOptions, NewTopic, TopicReplication},
    client::DefaultClientContext,
    consumer::{CommitMode, Consumer, StreamConsumer},
    types::RDKafkaErrorCode,
};
use rootcause::{Report, bail};
use tokio::sync::{Mutex, Notify, RwLock, mpsc};

use crate::state::{Commit, Envelope, Position, QueueState, Settings};

/// Holds each queue's settings, keyed by queue name.
const SETTINGS_TOPIC: &str = "queue-gateway.settings";
/// How many messages a queue holds in memory before its consumer waits.
const MAX_HELD: usize = 10_000;
const BACKPRESSURE_WAIT: Duration = Duration::from_millis(200);
const EXPIRY_INTERVAL: Duration = Duration::from_secs(1);
const SETTINGS_READ_TIMEOUT: Duration = Duration::from_secs(10);
/// A consumer may hold records far longer than Kafka's default poll interval.
const MAX_POLL_INTERVAL_MS: &str = "86400000";

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn topic(queue: &str) -> String {
    format!("queue.{queue}")
}

pub struct Queue {
    pub state: Mutex<QueueState>,
    pub arrived: Notify,
    commits: mpsc::UnboundedSender<Commit>,
}

impl Queue {
    pub fn commit(&self, commit: Option<Commit>) {
        if let Some(commit) = commit
            && self.commits.send(commit).is_err()
        {
            tracing::warn!("queue consumer stopped before a commit");
        }
    }
}

pub struct Queues {
    brokers: String,
    producer: KafkaEventProducer,
    queues: RwLock<HashMap<String, Arc<Queue>>>,
}

impl Queues {
    /// Connects, and restores every queue created before this process started.
    pub async fn start(brokers: String) -> Result<Arc<Self>, Report> {
        let producer = KafkaEventProducer::from_env(&brokers)?;
        let queues = Arc::new(Self {
            brokers,
            producer,
            queues: RwLock::new(HashMap::new()),
        });
        queues.create_settings_topic().await?;
        for (name, settings) in queues.read_settings().await? {
            queues.open(&name, settings).await?;
        }
        tokio::spawn(queues.clone().expire_loop());
        Ok(queues)
    }

    pub async fn get(&self, name: &str) -> Option<Arc<Queue>> {
        self.queues.read().await.get(name).cloned()
    }

    pub async fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.queues.read().await.keys().cloned().collect();
        names.sort();
        names
    }

    /// Creates a queue, or returns the one that exists.
    pub async fn create(&self, name: &str, settings: Settings) -> Result<Arc<Queue>, Report> {
        if let Some(queue) = self.get(name).await {
            return Ok(queue);
        }
        self.save_settings(name, &settings).await?;
        self.open(name, settings).await
    }

    pub async fn update_settings(&self, queue: &Queue, settings: Settings) -> Result<(), Report> {
        let name = queue.state.lock().await.name.clone();
        self.save_settings(&name, &settings).await?;
        queue.state.lock().await.settings = settings;
        Ok(())
    }

    pub async fn delete(&self, name: &str) -> Result<(), Report> {
        self.queues.write().await.remove(name);
        self.producer.send(SETTINGS_TOPIC, name, b"").await?;
        Ok(())
    }

    pub async fn send(&self, queue: &str, envelope: &Envelope) -> Result<(), Report> {
        let key = envelope.group.as_deref().unwrap_or(&envelope.message_id);
        self.producer
            .send(&topic(queue), key, &serde_json::to_vec(envelope)?)
            .await?;
        Ok(())
    }

    async fn save_settings(&self, name: &str, settings: &Settings) -> Result<(), Report> {
        self.producer
            .send(SETTINGS_TOPIC, name, &serde_json::to_vec(settings)?)
            .await?;
        Ok(())
    }

    async fn open(&self, name: &str, settings: Settings) -> Result<Arc<Queue>, Report> {
        self.create_topic(&topic(name), false).await?;
        let (commits, commits_rx) = mpsc::unbounded_channel();
        let queue = Arc::new(Queue {
            state: Mutex::new(QueueState::new(name.to_owned(), settings)),
            arrived: Notify::new(),
            commits,
        });
        let consumer = self.consumer(&format!("queue-gateway.{name}"))?;
        consumer.subscribe(&[&topic(name)])?;
        tokio::spawn(consume(queue.clone(), consumer, topic(name), commits_rx));
        self.queues
            .write()
            .await
            .insert(name.to_owned(), queue.clone());
        Ok(queue)
    }

    fn consumer(&self, group: &str) -> Result<StreamConsumer, Report> {
        Ok(ClientConfig::new()
            .set("bootstrap.servers", &self.brokers)
            .set("group.id", group)
            .set("enable.auto.commit", "false")
            .set("auto.offset.reset", "earliest")
            .set("max.poll.interval.ms", MAX_POLL_INTERVAL_MS)
            .create()?)
    }

    async fn create_settings_topic(&self) -> Result<(), Report> {
        self.create_topic(SETTINGS_TOPIC, true).await
    }

    /// One partition, so a queue's records stay in order; the broker's default
    /// replication, which is the size difference between environments.
    async fn create_topic(&self, name: &str, compacted: bool) -> Result<(), Report> {
        let admin: AdminClient<DefaultClientContext> = ClientConfig::new()
            .set("bootstrap.servers", &self.brokers)
            .create()?;
        let mut new_topic = NewTopic::new(name, 1, TopicReplication::Fixed(-1));
        if compacted {
            new_topic = new_topic.set("cleanup.policy", "compact");
        }
        for result in admin
            .create_topics([&new_topic], &AdminOptions::new())
            .await?
        {
            match result {
                Ok(_) | Err((_, RDKafkaErrorCode::TopicAlreadyExists)) => {}
                Err((topic, code)) => bail!("creating topic {topic}: {code}"),
            }
        }
        Ok(())
    }

    /// The latest settings of every queue not deleted.
    async fn read_settings(&self) -> Result<Vec<(String, Settings)>, Report> {
        let consumer = self.consumer("queue-gateway.settings-reader")?;
        let (_, high) = consumer.fetch_watermarks(SETTINGS_TOPIC, 0, SETTINGS_READ_TIMEOUT)?;
        let mut latest: HashMap<String, Option<Settings>> = HashMap::new();
        let mut assignment = TopicPartitionList::new();
        assignment.add_partition_offset(SETTINGS_TOPIC, 0, Offset::Beginning)?;
        consumer.assign(&assignment)?;
        let mut next = 0;
        while next < high {
            let message = consumer.recv().await?;
            next = message.offset() + 1;
            let Some(key) = message.key() else { continue };
            let settings = match message.payload() {
                Some(payload) if !payload.is_empty() => Some(serde_json::from_slice(payload)?),
                _ => None,
            };
            latest.insert(String::from_utf8_lossy(key).into_owned(), settings);
        }
        Ok(latest
            .into_iter()
            .filter_map(|(name, settings)| Some((name, settings?)))
            .collect())
    }

    /// Returns timed-out messages to their queues, and redrives those out of receives.
    async fn expire_loop(self: Arc<Self>) {
        let mut tick = tokio::time::interval(EXPIRY_INTERVAL);
        loop {
            tick.tick().await;
            let queues: Vec<Arc<Queue>> = self.queues.read().await.values().cloned().collect();
            for queue in queues {
                self.expire(&queue).await;
            }
        }
    }

    async fn expire(&self, queue: &Queue) {
        let dead = queue.state.lock().await.expire(now_ms());
        queue.arrived.notify_waiters();
        for letter in dead {
            match self.send(&letter.queue, &letter.envelope).await {
                Ok(()) => {
                    let commit = queue.state.lock().await.dead_lettered(letter.position);
                    queue.commit(commit);
                }
                // Left uncommitted, so it comes back when this process restarts.
                Err(error) => tracing::error!(
                    ?error,
                    dead_letter_queue = letter.queue,
                    "failed to redrive a message"
                ),
            }
        }
    }
}

/// Moves records from Kafka into the queue's state, and commits what it reports done.
async fn consume(
    queue: Arc<Queue>,
    consumer: StreamConsumer,
    topic: String,
    mut commits: mpsc::UnboundedReceiver<Commit>,
) {
    loop {
        let room = queue.state.lock().await.held() < MAX_HELD;
        tokio::select! {
            biased;
            commit = commits.recv() => {
                let Some(commit) = commit else { return };
                let mut offsets = TopicPartitionList::new();
                let added = offsets.add_partition_offset(
                    &topic,
                    commit.partition,
                    Offset::Offset(commit.next_offset),
                );
                if let Err(error) = added
                    .and_then(|()| consumer.commit(&offsets, CommitMode::Async))
                {
                    tracing::warn!(?error, topic, "failed to commit an offset");
                }
            }
            () = tokio::time::sleep(BACKPRESSURE_WAIT), if !room => {}
            message = consumer.recv(), if room => match message {
                Ok(message) => {
                    let position = Position {
                        partition: message.partition(),
                        offset: message.offset(),
                    };
                    match message.payload().map(serde_json::from_slice::<Envelope>) {
                        Some(Ok(envelope)) => {
                            queue.state.lock().await.ingest(position, envelope);
                            queue.arrived.notify_waiters();
                        }
                        other => tracing::error!(
                            topic,
                            offset = position.offset,
                            malformed = other.is_some(),
                            "skipping a record that is not a queue message"
                        ),
                    }
                }
                Err(error) => {
                    tracing::warn!(?error, topic, "failed to read from Kafka");
                    tokio::time::sleep(BACKPRESSURE_WAIT).await;
                }
            },
        }
    }
}
