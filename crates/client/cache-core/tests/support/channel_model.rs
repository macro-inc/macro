//! Sequences of server changes, answers that arrive in any order, reloads and
//! evictions, checked against the server after every one.

use crate::channel_device::Device;
use crate::channel_server::{Anchor, Answer, Entry, List, Request, Server};
use cache_core::channel_timeline::ChannelTimelineStorage;
use proptest::prelude::*;
use std::collections::{BTreeSet, VecDeque};

const CHANNELS: [&str; 2] = ["c1", "c2"];
/// As large as a page gets, so a window ends where its stretch does.
const WHOLE: u16 = 100;

/// One thing that happens; picks are taken modulo what there is to pick from.
#[derive(Clone, Copy, Debug)]
pub enum Op {
    Post {
        list: u16,
        skew: u8,
    },
    Edit(u16),
    Delete(u16),
    /// The log moves on by changes of other kinds.
    Jump {
        channel: u16,
        by: u16,
    },
    Latest {
        list: u16,
        limit: u8,
        reset: bool,
    },
    Older {
        list: u16,
        at: u16,
        limit: u8,
    },
    Newer {
        list: u16,
        at: u16,
        limit: u8,
    },
    CatchUp(u16),
    One {
        pick: u16,
        stamped: bool,
    },
    /// The server reads what a request asked for; its sequence was read when
    /// the request arrived.
    Serve(u16),
    Deliver(u16),
    Lose(u16),
    /// The next push of a channel arrives, or is lost.
    Push {
        channel: u16,
        lost: bool,
    },
    Touch(u16),
    DropThread(u16),
    Evict,
    Reload,
    Send(u16),
    /// The server takes the pending send, or refuses it.
    Sent {
        refused: bool,
    },
    /// The answer to a taken send arrives.
    Settle,
}

pub fn op() -> impl Strategy<Value = Op> {
    let pick = any::<u16>;
    let limit = || 1_u8..5;
    prop_oneof![
        12 => (pick(), prop_oneof![4 => Just(0_u8), 1 => 1_u8..4])
            .prop_map(|(list, skew)| Op::Post { list, skew }),
        5 => pick().prop_map(Op::Edit),
        6 => pick().prop_map(Op::Delete),
        1 => (pick(), 1_u16..700).prop_map(|(channel, by)| Op::Jump { channel, by }),
        8 => (pick(), limit(), prop::bool::weighted(0.1))
            .prop_map(|(list, limit, reset)| Op::Latest { list, limit, reset }),
        6 => (pick(), pick(), limit()).prop_map(|(list, at, limit)| Op::Older { list, at, limit }),
        3 => (pick(), pick(), limit()).prop_map(|(list, at, limit)| Op::Newer { list, at, limit }),
        7 => pick().prop_map(Op::CatchUp),
        5 => (pick(), any::<bool>()).prop_map(|(pick, stamped)| Op::One { pick, stamped }),
        8 => pick().prop_map(Op::Serve),
        22 => pick().prop_map(Op::Deliver),
        2 => pick().prop_map(Op::Lose),
        14 => (pick(), prop::bool::weighted(0.15))
            .prop_map(|(channel, lost)| Op::Push { channel, lost }),
        1 => pick().prop_map(Op::Touch),
        1 => pick().prop_map(Op::DropThread),
        1 => Just(Op::Evict),
        2 => Just(Op::Reload),
        3 => pick().prop_map(Op::Send),
        3 => prop::bool::weighted(0.2).prop_map(|refused| Op::Sent { refused }),
        3 => Just(Op::Settle),
    ]
}

/// What a device got wrong.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Wrong {
    /// A message deleted by the watermark is in a list the device answers.
    DeletedListed,
    /// A message deleted by the watermark is in a stored answer, or its
    /// content is.
    DeletedReadable,
    /// A list answered as complete lacks a message it held by the watermark.
    Missing,
    /// A listed message is older than it was at the watermark.
    Outdated,
    /// Caught up, the device does not show what the server does.
    NotConverged,
}

#[derive(Debug)]
pub struct Violation {
    pub wrong: Wrong,
    pub detail: String,
}

fn violation<T>(wrong: Wrong, detail: String) -> Result<T, Violation> {
    Err(Violation { wrong, detail })
}

struct Flight {
    request: Request,
    seq: u64,
    answer: Option<Answer>,
}

enum Sent {
    Waiting {
        local: String,
        list: List,
    },
    Taken {
        local: String,
        seq: u64,
        entry: Entry,
    },
}

struct World<S: ChannelTimelineStorage> {
    server: Server,
    device: Device<S>,
    flights: Vec<Flight>,
    pushes: Vec<VecDeque<Answer>>,
    sent: Option<Sent>,
    sends: usize,
    clock: i64,
    /// Messages an answer without a sequence brought: such an answer may
    /// leave a record of one the device did not hold, never a list entry.
    undated: BTreeSet<String>,
}

fn pick<T>(items: &[T], at: u16) -> Option<&T> {
    items.get(usize::from(at).checked_rem(items.len())?)
}

/// Runs `ops`, checking the device after each, then catches it up and checks
/// it shows what the server does. `reopen` is how storage comes back from a
/// reload.
pub async fn run<S: ChannelTimelineStorage>(
    storage: S,
    mut reopen: impl FnMut(S) -> S,
    ops: &[Op],
) -> Result<(), Violation> {
    let mut world = World {
        server: Server::new(&CHANNELS),
        device: Device::new(storage),
        flights: Vec::new(),
        pushes: vec![VecDeque::new(); CHANNELS.len()],
        sent: None,
        sends: 0,
        clock: 0,
        undated: BTreeSet::new(),
    };
    for (turn, op) in ops.iter().enumerate() {
        world = world.apply(*op, &mut reopen).await;
        world.check(turn).await.map_err(|violation| Violation {
            detail: format!("after {op:?} (#{turn}): {}", violation.detail),
            ..violation
        })?;
    }
    world.converge().await
}

impl<S: ChannelTimelineStorage> World<S> {
    fn lists(&self) -> Vec<List> {
        let roots = |channel: &str| {
            self.server
                .messages
                .values()
                .filter(move |m| m.channel == channel && m.thread.is_none())
                .map(|m| Some(m.id.clone()))
                .collect::<Vec<_>>()
        };
        CHANNELS
            .into_iter()
            .flat_map(|channel| {
                std::iter::once(None)
                    .chain(roots(channel))
                    .map(|thread| List {
                        channel: channel.to_owned(),
                        thread,
                    })
            })
            .collect()
    }

    /// A list to post in or read: half the time a channel's roots.
    fn list(&self, at: u16) -> List {
        let lists: Vec<_> = self
            .lists()
            .into_iter()
            .filter(|list| list.thread.is_none() == (at.is_multiple_of(2)))
            .collect();
        pick(&lists, at / 2).cloned().unwrap_or(List {
            channel: CHANNELS[0].to_owned(),
            thread: None,
        })
    }

    fn message(&self, at: u16, live: bool) -> Option<String> {
        let ids: Vec<_> = self
            .server
            .messages
            .values()
            .filter(|m| !live || m.deleted.is_none())
            .map(|m| m.id.clone())
            .collect();
        pick(&ids, at).cloned()
    }

    fn ask(&mut self, request: Request) {
        let channel = match &request {
            Request::Page { list, .. } => &list.channel,
            Request::Changes { channel, .. } => channel,
            Request::Stamped(id) | Request::Undated(id) => &self.server.messages[id].channel,
        };
        let seq = self.server.head(channel);
        self.flights.push(Flight {
            request,
            seq,
            answer: None,
        });
    }

    /// Pushes what `channel` changed since `from` to everyone connected.
    fn push(&mut self, channel: &str, from: u64) {
        let at = CHANNELS.iter().position(|c| *c == channel).unwrap();
        let seq = self.server.head(channel);
        self.pushes[at].push_back(self.server.changes(channel, from, seq));
    }

    async fn store(&mut self, answer: Answer) {
        match &answer {
            Answer::Undated(entry) => {
                self.undated.insert(entry.message.id.clone());
            }
            Answer::Page { list, .. } => {
                self.clock += 1;
                let (channel, now) = (list.channel.clone(), self.clock);
                self.device.touch(&channel, now).await;
            }
            Answer::Changes { .. } | Answer::Stamped { .. } => {}
        }
        self.device.store(&answer).await;
    }

    async fn apply(mut self, op: Op, reopen: &mut impl FnMut(S) -> S) -> Self {
        match op {
            Op::Post { list, skew } => {
                let list = self.list(list);
                let gone = |root: &String| self.server.messages[root].deleted.is_some();
                if !list.thread.as_ref().is_some_and(gone) {
                    let from = self.server.head(&list.channel);
                    self.server.post(&list, usize::from(skew));
                    self.push(&list.channel, from);
                }
            }
            Op::Edit(at) | Op::Delete(at) => {
                if let Some(id) = self.message(at, true) {
                    let channel = self.server.messages[&id].channel.clone();
                    let from = self.server.head(&channel);
                    match op {
                        Op::Edit(_) => self.server.edit(&id),
                        _ => self.server.delete(&id),
                    }
                    self.push(&channel, from);
                }
            }
            Op::Jump { channel, by } => {
                let channel = *pick(&CHANNELS, channel).unwrap();
                self.server.advance(channel, u64::from(by));
            }
            Op::Latest { list, limit, reset } => {
                let mut list = self.list(list);
                if reset {
                    list.thread = None;
                }
                self.ask(Request::Page {
                    list,
                    anchor: Anchor::Latest,
                    limit: usize::from(limit),
                    reset,
                });
            }
            Op::Older { list, at, limit } | Op::Newer { list, at, limit } => {
                let list = self.list(list);
                let keys: Vec<_> = self
                    .server
                    .messages
                    .values()
                    .filter(|m| m.channel == list.channel && m.thread == list.thread)
                    .map(|m| m.sort_key.clone())
                    .collect();
                if let Some(at) = pick(&keys, at).cloned() {
                    self.ask(Request::Page {
                        list,
                        anchor: match op {
                            Op::Older { .. } => Anchor::Before(at),
                            _ => Anchor::After(at),
                        },
                        limit: usize::from(limit),
                        reset: false,
                    });
                }
            }
            Op::CatchUp(channel) => {
                let channel = *pick(&CHANNELS, channel).unwrap();
                if let Some(from) = self.device.watermark(channel).await {
                    self.ask(Request::Changes {
                        channel: channel.to_owned(),
                        from,
                    });
                }
            }
            Op::One { pick, stamped } => {
                if let Some(id) = self.message(pick, true) {
                    self.ask(match stamped {
                        true => Request::Stamped(id),
                        false => Request::Undated(id),
                    });
                }
            }
            Op::Serve(at) => self.serve(at),
            Op::Deliver(at) => {
                self.serve(at);
                if !self.flights.is_empty() {
                    let flight = self.flights.remove(usize::from(at) % self.flights.len());
                    if let Some(answer) = flight.answer {
                        self.store(answer).await;
                    }
                }
            }
            Op::Lose(at) => {
                if !self.flights.is_empty() {
                    self.flights.remove(usize::from(at) % self.flights.len());
                }
            }
            Op::Push { channel, lost } => {
                let pushes = &mut self.pushes[usize::from(channel) % CHANNELS.len()];
                if let Some(push) = pushes.pop_front()
                    && !lost
                {
                    self.store(push).await;
                }
            }
            Op::Touch(channel) => {
                self.clock += 1;
                let (channel, now) = (*pick(&CHANNELS, channel).unwrap(), self.clock);
                self.device.touch(channel, now).await;
            }
            Op::DropThread(at) => {
                let list = self.list(at | 1);
                if list.thread.is_some() {
                    self.device.drop_thread(&list).await;
                }
            }
            Op::Evict => self.device.evict(self.clock.max(1)).await,
            Op::Reload => {
                if !self.device.sending() {
                    self.device = self.device.reload(reopen);
                }
            }
            Op::Send(list) => {
                let list = self.list(list);
                let local = format!("local-{}", self.sends);
                self.sends += 1;
                if self.device.send(&local, &list).await {
                    self.sent = Some(Sent::Waiting { local, list });
                }
            }
            Op::Sent { refused } => self.take_send(refused).await,
            Op::Settle => self.settle().await,
        }
        self
    }

    fn serve(&mut self, at: u16) {
        if self.flights.is_empty() {
            return;
        }
        let at = usize::from(at) % self.flights.len();
        let flight = &mut self.flights[at];
        if flight.answer.is_none() {
            flight.answer = self.server.answer(&flight.request, flight.seq);
        }
    }

    async fn take_send(&mut self, refused: bool) {
        match self.sent.take() {
            Some(Sent::Waiting { local, list }) => {
                let gone = |root: &String| self.server.messages[root].deleted.is_some();
                if refused || list.thread.as_ref().is_some_and(gone) {
                    self.device.settle(&local, None).await;
                    return;
                }
                let from = self.server.head(&list.channel);
                let id = self.server.post(&list, 0);
                self.push(&list.channel, from);
                let seq = self.server.head(&list.channel);
                if let Some(Answer::Stamped { entry, .. }) =
                    self.server.answer(&Request::Stamped(id), seq)
                {
                    self.sent = Some(Sent::Taken { local, seq, entry });
                }
            }
            sent => self.sent = sent,
        }
    }

    async fn settle(&mut self) {
        match self.sent.take() {
            Some(Sent::Taken { local, seq, entry }) => {
                self.device.settle(&local, Some((seq, &entry))).await;
            }
            sent => self.sent = sent,
        }
    }

    /// Nothing shown is older than the watermark says the device is.
    async fn check(&mut self, turn: usize) -> Result<(), Violation> {
        for channel in CHANNELS {
            let Some(held) = self.device.watermark(channel).await else {
                continue;
            };
            for list in self.lists() {
                if list.channel != channel {
                    continue;
                }
                self.check_window(&list, &Anchor::Latest, held).await?;
                let keys = self.keys(&list);
                if let Some(at) = pick(&keys, turn as u16) {
                    self.check_window(&list, &Anchor::Before(at.clone()), held)
                        .await?;
                    self.check_window(&list, &Anchor::After(at.clone()), held)
                        .await?;
                }
                for id in self.device.shown(&list).await {
                    self.check_gone(&id, held, "a stored answer")?;
                }
            }
            let gone: Vec<_> = self
                .server
                .messages
                .values()
                .filter(|m| m.channel == channel && m.gone_by(held))
                .map(|m| m.id.clone())
                .collect();
            for id in gone {
                if self.device.version(&id).await.is_some() {
                    self.check_gone(&id, held, "the records")?;
                }
            }
        }
        Ok(())
    }

    fn check_gone(&self, id: &str, held: u64, place: &str) -> Result<(), Violation> {
        match self.server.messages.get(id) {
            Some(message) if message.gone_by(held) && !self.undated.contains(id) => violation(
                Wrong::DeletedReadable,
                format!(
                    "{id}, deleted at {:?}, is in {place} at {held}",
                    message.deleted
                ),
            ),
            _ => Ok(()),
        }
    }

    /// The sort keys a list ever had.
    fn keys(&self, list: &List) -> Vec<String> {
        self.server
            .messages
            .values()
            .filter(|m| m.channel == list.channel && m.thread == list.thread)
            .map(|m| m.sort_key.clone())
            .collect()
    }

    async fn check_window(
        &mut self,
        list: &List,
        anchor: &Anchor,
        held: u64,
    ) -> Result<(), Violation> {
        let Some(window) = self.device.window(list, anchor, WHOLE).await else {
            return Ok(());
        };
        let place = format!("{list:?} {anchor:?} at {held}");
        for id in &window.ids {
            let message = &self.server.messages[id];
            if message.gone_by(held) {
                return violation(
                    Wrong::DeletedListed,
                    format!("{id}, deleted at {:?}, is in {place}", message.deleted),
                );
            }
            let wanted = message.version(held);
            let version = self.device.version(id).await;
            if version.is_none_or(|version| version < wanted) {
                return violation(
                    Wrong::Outdated,
                    format!("{id} is {version:?}, not {wanted}, in {place}"),
                );
            }
        }
        // What the page says it lists in full. A cursor continues after the
        // last entry, or after the stretch when there is none.
        let inside = |key: &str| {
            let above = match anchor {
                Anchor::After(after) => key > after.as_str(),
                _ => window.older.as_deref().is_none_or(|older| key >= older),
            };
            let below = match anchor {
                Anchor::Before(before) => key < before.as_str(),
                Anchor::After(_) => window.newer.as_deref().is_none_or(|newer| key <= newer),
                Anchor::Latest => true,
            };
            above && below
        };
        for message in self.server.listed(list) {
            if message.created <= held
                && inside(&message.sort_key)
                && !window.ids.contains(&message.id)
            {
                return violation(
                    Wrong::Missing,
                    format!("{} is not in {place}, {:?}", message.id, window.ids),
                );
            }
        }
        Ok(())
    }

    /// Catches both channels up and compares every
    /// stretch held with the server.
    async fn converge(mut self) -> Result<(), Violation> {
        for channel in CHANNELS {
            for _ in 0..10 {
                let head = self.server.head(channel);
                let Some(from) = self.device.watermark(channel).await else {
                    break;
                };
                if from == head {
                    break;
                }
                let request = Request::Changes {
                    channel: channel.to_owned(),
                    from,
                };
                if let Some(answer) = self.server.answer(&request, head) {
                    self.store(answer).await;
                }
            }
            let head = self.server.head(channel);
            match self.device.watermark(channel).await {
                None => continue,
                Some(held) if held == head => {}
                held => {
                    return violation(
                        Wrong::NotConverged,
                        format!("{channel} is at {held:?}, not {head}"),
                    );
                }
            }
            for list in self.lists() {
                if list.channel != channel {
                    continue;
                }
                self.check_window(&list, &Anchor::Latest, head).await?;
                for at in self.keys(&list) {
                    self.check_window(&list, &Anchor::Before(at.clone()), head)
                        .await?;
                    self.check_window(&list, &Anchor::After(at), head).await?;
                }
            }
        }
        Ok(())
    }
}
