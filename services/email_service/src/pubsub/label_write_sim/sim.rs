//! Seeded simulation of user label actions, Gmail answers, queue redelivery
//! and inbox syncs, run against the real worker and domain code.
//!
//! SQS is modelled on a virtual clock: the fake SQS endpoint records what the
//! production code sends, deletes and delays, and the simulation decides when
//! each message is delivered to `gmail_ops::process::process_message` or
//! `inbox_sync::process::process_message`.

mod generator;
mod model;
mod test;

use super::fake_gmail::{Kind, Logged, PauseAt, Reply};
use super::fake_sqs::Ack;
use super::wiring::{self, LabelOp};
use super::world::{self, MESSAGES, THREADS, TRACKED, WORK, World};
use aws_sdk_sqs::types::{Message, MessageSystemAttributeName};
use email::domain::models::mailbox_action::MailboxAction;
use email::domain::ports::EmailService;
use models_email::gmail::inbox_sync::{
    InboxSyncOperation, InboxSyncPubsubMessage, UpdateLabelsPayload, UpsertMessagePayload,
};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt::Write as _;
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Queue {
    Ops,
    OpsRetry,
    Sync,
    SyncRetry,
}

impl Queue {
    fn max_receives(self) -> u32 {
        match self {
            Queue::Ops | Queue::Sync => 3,
            Queue::OpsRetry | Queue::SyncRetry => 100,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Queued {
    pub id: String,
    pub queue: Queue,
    pub body: String,
    pub visible_at: u64,
    pub receives: u32,
    /// The label write this message carries, if it is a gmail_ops write.
    pub lineage: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EntryState {
    Live,
    Rejected,
    DeadLettered,
}

#[derive(Clone, Debug)]
struct Entry {
    seq: u64,
    lineage: u64,
    value: bool,
    state: EntryState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OpStatus {
    Queued,
    Applied,
    Rejected,
    Skipped,
    DeadLettered,
}

#[derive(Clone, Debug)]
struct OpTrack {
    seq: u64,
    op: LabelOp,
    label: String,
    value: bool,
    status: OpStatus,
    /// Messages Gmail accepted this write for, over all its deliveries.
    accepted: BTreeSet<String>,
}

#[derive(Clone, Debug)]
pub enum Action {
    Archive(usize, bool),
    Read(usize, bool),
    Star(usize, bool),
    Label(usize, bool),
    Trash(usize, bool),
    BulkArchive(Vec<usize>, bool),
}

#[derive(Clone, Debug)]
pub enum Step {
    Action {
        action: Action,
        enqueue_fails: bool,
    },
    Deliver {
        reply: Reply,
        gate_refuses: bool,
        enqueue_fails: bool,
    },
    Sync {
        message: usize,
        reply: Reply,
    },
    Resync {
        message: usize,
        reply: Reply,
    },
    Wait {
        seconds: u64,
    },
    /// Twelve hours pass: every queued message is worked off, then markers age
    /// past their expiry.
    Expire,
    /// `first` reaches Gmail, `seconds` run to completion, then `first`
    /// finishes.
    Overlap {
        first: Box<Step>,
        seconds: Vec<Step>,
        at: PauseAt,
    },
}

#[derive(Clone, Debug)]
pub struct Violation {
    pub invariant: &'static str,
    pub step: usize,
    pub detail: String,
}

impl Violation {
    /// The kind of step after which the violation showed, e.g. `Sync`.
    pub fn step_kind(&self) -> String {
        let text = self
            .detail
            .trim_start_matches("after ")
            .trim_start_matches("drain ");
        text.split(|c: char| !c.is_alphanumeric())
            .next()
            .unwrap_or("")
            .to_string()
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Config {
    pub steps: usize,
    pub overlap: bool,
    /// Producers send label write batches rather than one operation per
    /// message.
    pub label_write_batches: bool,
}

pub struct Sim<'w> {
    pub world: &'w mut World,
    rng: StdRng,
    pub now: u64,
    pub queued: Vec<Queued>,
    pub dead_letters: Vec<Queued>,
    cells: BTreeMap<(String, String), Vec<Entry>>,
    ops: BTreeMap<u64, OpTrack>,
    lineage_by_body: HashMap<String, u64>,
    /// The lineage carrying each write to each provider message: with label
    /// write batches off, one write is an operation per message.
    lineage_by_write: HashMap<(Uuid, String), u64>,
    next_lineage: u64,
    action_seq: u64,
    next_message: u64,
    pub trace: Vec<String>,
    pub violations: Vec<Violation>,
    /// Cells whose latest write dead-lettered.
    pub lost_cells: BTreeSet<(String, String)>,
    pub stats: Stats,
    step_index: usize,
}

#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub actions: u64,
    pub failed_actions: u64,
    pub deliveries: u64,
    pub syncs: u64,
    pub resyncs: u64,
    pub gmail_writes: u64,
    pub gmail_429: u64,
    pub gmail_5xx: u64,
    pub gmail_400: u64,
    pub transient_stale_applies: u64,
    pub skipped_superseded: u64,
    pub dead_letters: u64,
    pub overlaps: u64,
    pub expiries: u64,
}

pub enum Source {
    Sync(usize),
    Resync(usize),
    /// The earliest message already on the queue.
    Queued(Queue),
}

pub struct Paused {
    delivery: Delivery,
    task: tokio::task::JoinHandle<()>,
    release: tokio::sync::oneshot::Sender<()>,
    window_from: u64,
    at: PauseAt,
    action_seq: u64,
}

struct Delivery {
    queued: Queued,
    message: Message,
    log_from: u64,
    /// Gmail requests made by other steps while this one was paused.
    excluded: std::ops::Range<u64>,
    /// When Gmail applied this delivery's write before later actions ran:
    /// the last action it could have seen.
    applied_before: Option<u64>,
}

impl<'w> Sim<'w> {
    pub fn new(world: &'w mut World, seed: u64) -> Sim<'w> {
        let cells = MESSAGES
            .iter()
            .flat_map(|(id, _, _)| {
                TRACKED
                    .iter()
                    .map(move |label| ((id.to_string(), label.to_string()), Vec::new()))
            })
            .collect();
        Sim {
            world,
            rng: StdRng::seed_from_u64(seed),
            now: 0,
            queued: Vec::new(),
            dead_letters: Vec::new(),
            cells,
            ops: BTreeMap::new(),
            lineage_by_body: HashMap::new(),
            lineage_by_write: HashMap::new(),
            next_lineage: 0,
            action_seq: 0,
            next_message: 0,
            trace: Vec::new(),
            violations: Vec::new(),
            lost_cells: BTreeSet::new(),
            stats: Stats::default(),
            step_index: 0,
        }
    }

    // --------------------------------------------------------------- queues

    fn queue_of(&self, url: &str) -> Option<Queue> {
        let queues = &self.world.queues;
        if url == queues.ops {
            Some(Queue::Ops)
        } else if url == queues.ops_retry {
            Some(Queue::OpsRetry)
        } else if url == queues.sync {
            Some(Queue::Sync)
        } else if url == queues.sync_retry {
            Some(Queue::SyncRetry)
        } else {
            None
        }
    }

    /// Takes what the code sent to SQS since the last call into the model.
    /// Writes first seen here belong to the user action `seq`.
    fn absorb_sends(&mut self, seq: Option<u64>) {
        let (sent, acks) = self.world.sqs.take();
        for sent in sent {
            let Some(queue) = self.queue_of(&sent.queue_url) else {
                continue;
            };
            let lineage = if matches!(queue, Queue::Ops | Queue::OpsRetry) {
                self.lineage_for(&sent.body, seq)
            } else {
                None
            };
            self.queued.push(Queued {
                id: sent.message_id,
                queue,
                body: sent.body,
                visible_at: self.now + sent.delay_seconds,
                receives: 0,
                lineage,
            });
        }
        assert!(acks.is_empty(), "acks outside a delivery: {acks:?}");
    }

    /// A send made by a user action is a new write; any other send of a label
    /// write is a re-enqueue (primary → retry) of the write with that body.
    /// On `main` two actions can produce the same body; the newest wins.
    fn lineage_for(&mut self, body: &str, seq: Option<u64>) -> Option<u64> {
        if seq.is_none()
            && let Some(lineage) = self.lineage_by_body.get(body)
        {
            return Some(*lineage);
        }
        let op = wiring::decode_label_op(body)?;
        let lineage = self.next_lineage;
        self.next_lineage += 1;
        let seq = seq.unwrap_or_else(|| panic!("label write sent outside a user action: {body}"));
        let (label, value) = match (op.add.first(), op.remove.first()) {
            (Some(label), None) => (label.clone(), true),
            (None, Some(label)) => (label.clone(), false),
            _ => panic!("label write changes more than one label: {op:?}"),
        };
        for (_, provider_id) in &op.messages {
            self.cells
                .get_mut(&(provider_id.clone(), label.clone()))
                .unwrap_or_else(|| panic!("untracked cell {provider_id}/{label}"))
                .push(Entry {
                    seq,
                    lineage,
                    value,
                    state: EntryState::Live,
                });
        }
        if let Some(write_id) = op.write_id {
            for (_, provider_id) in &op.messages {
                self.lineage_by_write
                    .insert((write_id, provider_id.clone()), lineage);
            }
        }
        self.lineage_by_body.insert(body.to_string(), lineage);
        self.ops.insert(
            lineage,
            OpTrack {
                seq,
                op,
                label,
                value,
                status: OpStatus::Queued,
                accepted: BTreeSet::new(),
            },
        );
        Some(lineage)
    }

    fn set_entries(&mut self, lineage: u64, messages: &[String], state: EntryState) {
        let label = self.ops[&lineage].label.clone();
        for message in messages {
            for entry in self
                .cells
                .get_mut(&(message.clone(), label.clone()))
                .unwrap()
                .iter_mut()
                .filter(|entry| entry.lineage == lineage)
            {
                entry.state = state;
            }
        }
    }

    /// Picks the next message to deliver: due ones first, otherwise the clock
    /// moves to the earliest.
    fn next_due(&mut self) -> Option<usize> {
        if self.queued.is_empty() {
            return None;
        }
        let earliest = self.queued.iter().map(|queued| queued.visible_at).min()?;
        if earliest > self.now {
            self.now = earliest;
        }
        let due: Vec<usize> = (0..self.queued.len())
            .filter(|index| self.queued[*index].visible_at <= self.now)
            .collect();
        Some(due[self.rng.random_range(0..due.len())])
    }

    /// Takes a message off its queue for delivery, or dead-letters it once it
    /// has used up its receives.
    fn begin_delivery(&mut self, index: usize) -> Option<Delivery> {
        let mut queued = self.queued.remove(index);
        if queued.receives >= queued.queue.max_receives() {
            self.stats.dead_letters += 1;
            if let Some(lineage) = queued.lineage {
                let messages: Vec<String> = self.ops[&lineage]
                    .op
                    .messages
                    .iter()
                    .map(|(_, provider_id)| provider_id.clone())
                    .collect();
                self.ops.get_mut(&lineage).unwrap().status = OpStatus::DeadLettered;
                self.set_entries(lineage, &messages, EntryState::DeadLettered);
            }
            self.trace.push(format!(
                "t={} dead-letter {:?} {}",
                self.now,
                queued.queue,
                short(&queued.body)
            ));
            self.dead_letters.push(queued);
            return None;
        }
        queued.receives += 1;
        let message = Message::builder()
            .message_id(&queued.id)
            .receipt_handle(format!("{}#{}", queued.id, queued.receives))
            .body(&queued.body)
            .attributes(
                MessageSystemAttributeName::ApproximateReceiveCount,
                queued.receives.to_string(),
            )
            .build();
        let log_from = self.world.gmail.lock().log.len() as u64;
        Some(Delivery {
            queued,
            message,
            log_from,
            excluded: 0..0,
            applied_before: None,
        })
    }

    /// Hands the message to the worker entry point for its queue, as the
    /// worker loop does after a receive.
    fn spawn_delivery(world: &World, delivery: &Delivery) -> tokio::task::JoinHandle<()> {
        let message = delivery.message.clone();
        match delivery.queued.queue {
            Queue::Ops | Queue::OpsRetry => {
                let ctx = if delivery.queued.queue == Queue::Ops {
                    world.ops.clone()
                } else {
                    world.ops_retry.clone()
                };
                tokio::spawn(async move {
                    let _ = crate::pubsub::gmail_ops::process::process_message(ctx, &message).await;
                })
            }
            Queue::Sync | Queue::SyncRetry => {
                let ctx = if delivery.queued.queue == Queue::Sync {
                    world.sync.clone()
                } else {
                    world.sync_retry.clone()
                };
                tokio::spawn(async move {
                    let _ =
                        crate::pubsub::inbox_sync::process::process_message(ctx, &message).await;
                })
            }
        }
    }

    async fn run_delivery(world: &World, delivery: &Delivery) {
        Self::spawn_delivery(world, delivery)
            .await
            .expect("worker task panicked");
    }

    /// Applies a finished delivery's acknowledgements and checks that a label
    /// write left its queue only for an accountable reason.
    fn finish_delivery(&mut self, delivery: Delivery) {
        self.stats.deliveries += 1;
        let (sent, acks) = self.world.sqs.take();
        let receipt = delivery.message.receipt_handle().unwrap().to_string();
        let mut queued = delivery.queued;
        let mut deleted = false;
        let mut visibility = None;
        let mut foreign_acks = Vec::new();
        for ack in acks {
            match ack {
                Ack::Deleted { receipt: r } if r == receipt => deleted = true,
                Ack::Visibility {
                    receipt: r,
                    seconds,
                } if r == receipt => visibility = Some(seconds),
                other => foreign_acks.push(other),
            }
        }
        assert!(foreign_acks.is_empty(), "unexpected acks {foreign_acks:?}");
        let resent_to_retry = sent.iter().any(|sent| {
            sent.body == queued.body && self.queue_of(&sent.queue_url) == Some(Queue::OpsRetry)
        });
        // The hand-off to the retry queue carries this delivery's write.
        if resent_to_retry && let Some(lineage) = queued.lineage {
            self.lineage_by_body.insert(queued.body.clone(), lineage);
        }
        // Put the sends back for absorb_sends.
        self.world.sqs.lock().sent.extend(sent);
        let log: Vec<Logged> = self.world.gmail.lock().log[delivery.log_from as usize..]
            .iter()
            .enumerate()
            .filter(|(offset, _)| {
                !delivery
                    .excluded
                    .contains(&(delivery.log_from + *offset as u64))
            })
            .map(|(_, entry)| entry.clone())
            .collect();
        for entry in &log {
            match entry.reply {
                Reply::RateLimited => self.stats.gmail_429 += 1,
                Reply::Unavailable => self.stats.gmail_5xx += 1,
                Reply::Rejected => self.stats.gmail_400 += 1,
                Reply::Ok => {}
            }
        }
        self.trace.push(format!(
            "t={} deliver {:?}#{} {} -> deleted={} visibility={:?} gmail={:?}",
            self.now,
            queued.queue,
            queued.receives,
            short(&queued.body),
            deleted,
            visibility,
            log.iter()
                .map(|entry| format!("{:?}{:?}{:?}", entry.kind, entry.ids, entry.reply))
                .collect::<Vec<_>>()
        ));
        if let Some(lineage) = queued.lineage {
            self.account_write(
                lineage,
                &log,
                deleted,
                resent_to_retry,
                delivery.applied_before,
            );
        }
        if !deleted {
            queued.visible_at = self.now + visibility.unwrap_or(60);
            self.queued.push(queued);
        }
    }

    // ---------------------------------------------------------------- steps

    async fn prepare(&mut self, step: &Step) {
        wiring::reset_admission(&mut self.world.redis, self.world.link_id).await;
        {
            let mut gmail = self.world.gmail.lock();
            gmail.default_write = Reply::Ok;
            gmail.default_read = Reply::Ok;
            gmail.next_writes.clear();
            gmail.next_reads.clear();
        }
        self.world.sqs.set_outage(false);
        match step {
            Step::Deliver {
                reply,
                gate_refuses,
                enqueue_fails,
            } => {
                {
                    let mut gmail = self.world.gmail.lock();
                    gmail.next_writes.push_back(*reply);
                    gmail.next_reads.push_back(*reply);
                }
                if *gate_refuses {
                    wiring::refuse_admission(&mut self.world.redis, self.world.link_id).await;
                }
                self.world.sqs.set_outage(*enqueue_fails);
            }
            Step::Sync { reply, .. } | Step::Resync { reply, .. } => {
                self.world.gmail.lock().next_reads.push_back(*reply);
            }
            Step::Action { enqueue_fails, .. } => self.world.sqs.set_outage(*enqueue_fails),
            _ => {}
        }
    }

    fn sync_message(&mut self, message: usize, resync: bool) -> Queued {
        let provider_message_id = MESSAGES[message].0.to_string();
        let operation = if resync {
            InboxSyncOperation::UpsertMessage(UpsertMessagePayload {
                provider_message_id,
            })
        } else {
            InboxSyncOperation::UpdateLabels(UpdateLabelsPayload {
                provider_message_id,
            })
        };
        self.next_message += 1;
        Queued {
            id: format!("sync-{}", self.next_message),
            queue: Queue::Sync,
            body: serde_json::to_string(&InboxSyncPubsubMessage {
                link_id: self.world.link_id,
                operation,
            })
            .unwrap(),
            visible_at: self.now,
            receives: 0,
            lineage: None,
        }
    }

    pub async fn run_step(&mut self, step: Step) {
        self.prepare(&step).await;
        match step {
            Step::Action {
                action,
                enqueue_fails,
            } => {
                let _ = self.act(action, enqueue_fails).await;
            }
            Step::Deliver { .. } => {
                if let Some(index) = self.next_due()
                    && let Some(delivery) = self.begin_delivery(index)
                {
                    Self::run_delivery(self.world, &delivery).await;
                    self.finish_delivery(delivery);
                }
            }
            Step::Sync { message, .. } | Step::Resync { message, .. } => {
                let resync = matches!(step, Step::Resync { .. });
                if resync {
                    self.stats.resyncs += 1;
                } else {
                    self.stats.syncs += 1;
                }
                let queued = self.sync_message(message, resync);
                self.queued.push(queued);
                let index = self.queued.len() - 1;
                let delivery = self.begin_delivery(index).unwrap();
                Self::run_delivery(self.world, &delivery).await;
                self.finish_delivery(delivery);
            }
            Step::Wait { seconds } => {
                self.now += seconds;
                self.trace.push(format!("t={} wait {seconds}s", self.now));
            }
            Step::Expire => Box::pin(self.expire()).await,
            Step::Overlap { first, seconds, at } => {
                Box::pin(self.overlap(*first, seconds, at)).await
            }
        }
        self.absorb_sends(None);
        self.world.sqs.set_outage(false);
    }

    pub async fn act(&mut self, action: Action, enqueue_fails: bool) -> Result<(), String> {
        self.world.sqs.set_outage(enqueue_fails);
        self.stats.actions += 1;
        self.action_seq += 1;
        let seq = self.action_seq;
        let owner = world::owner();
        let thread = |index: usize| self.world.thread_ids[THREADS[index]];
        let result: Result<(), String> = match &action {
            Action::Archive(t, value) => self
                .world
                .email
                .set_thread_archived(owner, thread(*t), *value)
                .await
                .map_err(|error| format!("{error:?}")),
            Action::Read(t, value) => self
                .world
                .email
                .change_thread_mailbox_state(owner, thread(*t), MailboxAction::Read(*value))
                .await
                .map_err(|error| format!("{error:?}")),
            Action::Star(t, value) => self
                .world
                .email
                .change_thread_mailbox_state(owner, thread(*t), MailboxAction::Flagged(*value))
                .await
                .map_err(|error| format!("{error:?}")),
            Action::Trash(t, value) => self
                .world
                .email
                .change_thread_mailbox_state(owner, thread(*t), MailboxAction::Trashed(*value))
                .await
                .map_err(|error| format!("{error:?}")),
            Action::Label(t, value) => self
                .world
                .email
                .update_thread_labels_for_user(
                    owner,
                    thread(*t),
                    self.world.label_ids[WORK],
                    *value,
                )
                .await
                .map(|_| ())
                .map_err(|error| format!("{error:?}")),
            Action::BulkArchive(threads, value) => {
                let ids = threads.iter().map(|t| thread(*t)).collect();
                wiring::archive_many(&self.world.email, owner, ids, *value)
                    .await
                    .and_then(|failed| {
                        if failed.is_empty() {
                            Ok(())
                        } else {
                            Err(format!("failed threads {failed:?}"))
                        }
                    })
            }
        };
        if result.is_err() {
            self.stats.failed_actions += 1;
        }
        self.trace.push(format!(
            "t={} action#{seq} {action:?} enqueue_fails={enqueue_fails} -> {result:?}",
            self.now
        ));
        self.world.sqs.set_outage(false);
        self.absorb_sends(Some(seq));
        result
    }

    /// Twelve hours: work off the queues with the same mix of Gmail answers,
    /// then age every marker past its expiry.
    async fn expire(&mut self) {
        self.stats.expiries += 1;
        self.trace
            .push(format!("t={} expire: drain then age markers", self.now));
        self.drain(true).await;
        self.now += 12 * 3600;
        let ids: Vec<Uuid> = self.world.message_ids.values().copied().collect();
        wiring::age_markers(&self.world.db, &ids).await;
    }

    /// Delivers until every queue is empty. `faulty` keeps Gmail failing at
    /// random; otherwise Gmail accepts everything.
    pub async fn drain(&mut self, faulty: bool) {
        for _ in 0..5_000 {
            if self.queued.is_empty() {
                return;
            }
            let step = if faulty {
                Step::Deliver {
                    reply: self.random_reply(0.6),
                    gate_refuses: false,
                    enqueue_fails: false,
                }
            } else {
                Step::Deliver {
                    reply: Reply::Ok,
                    gate_refuses: false,
                    enqueue_fails: false,
                }
            };
            let description = format!("drain {step:?}");
            Box::pin(self.run_step(step)).await;
            Box::pin(self.check_step(&description)).await;
        }
        panic!("queues did not drain: {:?}", self.queued);
    }

    async fn overlap(&mut self, first: Step, seconds: Vec<Step>, at: PauseAt) {
        self.stats.overlaps += 1;
        if let Step::Deliver { reply, .. } | Step::Sync { reply, .. } | Step::Resync { reply, .. } =
            &first
        {
            let mut gmail = self.world.gmail.lock();
            gmail.next_writes.push_back(*reply);
            gmail.next_reads.push_back(*reply);
        }
        let started = match &first {
            Step::Deliver { .. } => self.next_due().and_then(|index| self.begin_delivery(index)),
            Step::Sync { message, .. } | Step::Resync { message, .. } => {
                let resync = matches!(first, Step::Resync { .. });
                let queued = self.sync_message(*message, resync);
                self.queued.push(queued);
                let index = self.queued.len() - 1;
                self.begin_delivery(index)
            }
            _ => None,
        };
        let Some(mut delivery) = started else {
            self.clear_replies();
            for step in seconds {
                self.run_concurrently(step).await;
            }
            return;
        };
        let kind = match (&first, delivery.queued.queue) {
            (_, Queue::Ops | Queue::OpsRetry) => Kind::Write,
            (Step::Resync { .. }, _) => Kind::ReadFull,
            _ => Kind::ReadLabels,
        };
        self.trace.push(format!(
            "t={} overlap: {} paused {at:?} at its Gmail {kind:?}",
            self.now,
            short(&delivery.queued.body)
        ));
        let pause = self.world.gmail.pause_next(kind, None, at);
        let mut task = Self::spawn_delivery(self.world, &delivery);
        let arrived = tokio::select! {
            _ = &mut task => false,
            arrived = pause.arrived => arrived.is_ok(),
        };
        self.world.gmail.clear_pause();
        self.clear_replies();
        if !arrived {
            self.finish_delivery(delivery);
            // Its sends (a hand-off to the retry queue) belong to it, not to
            // the next user action.
            self.absorb_sends(None);
            for step in seconds {
                self.run_concurrently(step).await;
            }
            return;
        }
        // `first` is held at Gmail while the other steps run to completion.
        // Their deliveries are accounted as they finish: until the release,
        // every SQS ack and Gmail request is theirs.
        let window_from = self.world.gmail.lock().log.len() as u64;
        if at == PauseAt::AfterApply {
            delivery.applied_before = Some(self.action_seq);
        }
        for step in seconds {
            self.trace
                .push(format!("t={}   while paused: {step:?}", self.now));
            self.run_concurrently(step).await;
        }
        delivery.excluded = window_from..self.world.gmail.lock().log.len() as u64;
        let _ = pause.release.send(());
        tokio::time::timeout(Duration::from_secs(60), task)
            .await
            .expect("paused delivery finished")
            .expect("worker task panicked");
        self.finish_delivery(delivery);
    }

    fn clear_replies(&mut self) {
        let mut gmail = self.world.gmail.lock();
        gmail.next_writes.clear();
        gmail.next_reads.clear();
    }

    /// Runs `step` to completion while another delivery is paused at Gmail.
    async fn run_concurrently(&mut self, step: Step) {
        match step {
            Step::Action {
                action,
                enqueue_fails,
            } => {
                let _ = self.act(action, enqueue_fails).await;
            }
            Step::Deliver { reply, .. } => {
                self.world.gmail.lock().next_writes.push_back(reply);
                self.world.gmail.lock().next_reads.push_back(reply);
                if let Some(index) = self.next_due()
                    && let Some(delivery) = self.begin_delivery(index)
                {
                    Self::run_delivery(self.world, &delivery).await;
                    self.finish_delivery(delivery);
                }
                self.clear_replies();
            }
            Step::Sync { message, reply } | Step::Resync { message, reply } => {
                let resync = matches!(step, Step::Resync { .. });
                self.world.gmail.lock().next_reads.push_back(reply);
                let queued = self.sync_message(message, resync);
                self.queued.push(queued);
                let index = self.queued.len() - 1;
                if let Some(delivery) = self.begin_delivery(index) {
                    Self::run_delivery(self.world, &delivery).await;
                    self.finish_delivery(delivery);
                }
                self.clear_replies();
            }
            _ => {}
        }
        self.absorb_sends(None);
    }

    // ------------------------------------------------------ scenario steps

    /// Delivers the earliest message on `queue` (moving the clock to it)
    /// with Gmail answering `reply`. Returns false when the queue is empty.
    pub async fn deliver_from(&mut self, queue: Queue, reply: Reply, enqueue_fails: bool) -> bool {
        self.deliver_answering(queue, &[reply], enqueue_fails).await
    }

    /// Like [`Self::deliver_from`], with Gmail answering the delivery's
    /// writes with `replies` in order and accepting any after them.
    pub async fn deliver_answering(
        &mut self,
        queue: Queue,
        replies: &[Reply],
        enqueue_fails: bool,
    ) -> bool {
        let Some(index) = (0..self.queued.len())
            .filter(|index| self.queued[*index].queue == queue)
            .min_by_key(|index| (self.queued[*index].visible_at, *index))
        else {
            return false;
        };
        self.now = self.now.max(self.queued[index].visible_at);
        self.prepare(&Step::Deliver {
            reply: replies[0],
            gate_refuses: false,
            enqueue_fails,
        })
        .await;
        self.world
            .gmail
            .lock()
            .next_writes
            .extend(replies[1..].iter().copied());
        if let Some(delivery) = self.begin_delivery(index) {
            Self::run_delivery(self.world, &delivery).await;
            self.finish_delivery(delivery);
        }
        self.absorb_sends(None);
        self.world.sqs.set_outage(false);
        self.clear_replies();
        true
    }

    /// Delivers every message now on `queue` once, oldest first.
    pub async fn deliver_all(&mut self, queue: Queue, reply: Reply) -> usize {
        let count = self
            .queued
            .iter()
            .filter(|queued| queued.queue == queue)
            .count();
        for _ in 0..count {
            self.deliver_from(queue, reply, false).await;
        }
        count
    }

    pub fn queue_len(&self, queue: Queue) -> usize {
        self.queued
            .iter()
            .filter(|queued| queued.queue == queue)
            .count()
    }

    /// Starts a delivery and holds its first Gmail request of `kind`.
    pub async fn start_paused(
        &mut self,
        source: Source,
        kind: Kind,
        at: PauseAt,
    ) -> Option<Paused> {
        self.prepare(&Step::Wait { seconds: 0 }).await;
        let index = match source {
            Source::Sync(message) | Source::Resync(message) => {
                let queued = self.sync_message(message, matches!(source, Source::Resync(_)));
                self.queued.push(queued);
                self.queued.len() - 1
            }
            Source::Queued(queue) => (0..self.queued.len())
                .filter(|index| self.queued[*index].queue == queue)
                .min_by_key(|index| (self.queued[*index].visible_at, *index))?,
        };
        self.now = self.now.max(self.queued[index].visible_at);
        let delivery = self.begin_delivery(index)?;
        let pause = self.world.gmail.pause_next(kind, None, at);
        let mut task = Self::spawn_delivery(self.world, &delivery);
        let arrived = tokio::select! {
            _ = &mut task => false,
            arrived = pause.arrived => arrived.is_ok(),
        };
        assert!(arrived, "delivery finished without reaching Gmail");
        Some(Paused {
            delivery,
            task,
            release: pause.release,
            window_from: self.world.gmail.lock().log.len() as u64,
            at,
            action_seq: self.action_seq,
        })
    }

    pub async fn finish_paused(&mut self, paused: Paused) {
        let Paused {
            mut delivery,
            task,
            release,
            window_from,
            at,
            action_seq,
        } = paused;
        delivery.excluded = window_from..self.world.gmail.lock().log.len() as u64;
        if at == PauseAt::AfterApply {
            delivery.applied_before = Some(action_seq);
        }
        let _ = release.send(());
        task.await.expect("worker task panicked");
        self.finish_delivery(delivery);
        self.absorb_sends(None);
    }

    pub async fn sync(&mut self, message: usize) {
        self.run_step(Step::Sync {
            message,
            reply: Reply::Ok,
        })
        .await;
    }

    pub async fn resync(&mut self, message: usize) {
        self.run_step(Step::Resync {
            message,
            reply: Reply::Ok,
        })
        .await;
    }

    /// Runs one seed: random steps with checks after each, then quiescence.
    pub async fn run(&mut self, config: Config) {
        for index in 0..config.steps {
            self.step_index = index;
            let step = self.random_step(config);
            let description = format!("{step:?}");
            self.run_step(step).await;
            self.check_step(&description).await;
            if !self.violations.is_empty() {
                return;
            }
        }
        self.step_index = config.steps;
        self.quiesce().await;
    }

    pub fn report(&self) -> String {
        let mut out = String::new();
        for violation in &self.violations {
            let _ = writeln!(
                out,
                "  [{}] step {}: {}",
                violation.invariant, violation.step, violation.detail
            );
        }
        let _ = writeln!(out, "  trace:");
        for line in &self.trace {
            let _ = writeln!(out, "    {line}");
        }
        out
    }
}

fn short(body: &str) -> String {
    let value: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    let operation = &value["operation"];
    let text = operation.to_string();
    let text = text.replace(&"0".repeat(8), "");
    if text.len() > 160 {
        format!("{}…", &text[..160])
    } else {
        text
    }
}
