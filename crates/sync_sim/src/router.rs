//! Single-threaded protocol fake for one physical router connection.
//! Policy is pinned against sync_router's domain-router stories in the parity test.
use crate::Failure;
use bebop::{Record, SliceWrapper};
use std::collections::{BTreeMap, VecDeque};

pub(crate) enum Action {
    Open {
        doc: String,
        token: String,
        epoch: u64,
    },
    Cancel {
        doc: String,
        epoch: u64,
    },
    Pump {
        doc: String,
        epoch: u64,
    },
    Deliver(Vec<u8>),
}
struct Route {
    epoch: u64,
    ready: bool,
    queue: VecDeque<Vec<u8>>,
}
/// Sans-IO router protocol adapter. Each instance belongs to one physical socket.
pub struct SimRouter {
    routes: BTreeMap<String, Route>,
    next_epoch: u64,
    capacity: usize,
    queued_bytes: usize,
}
impl Default for SimRouter {
    fn default() -> Self {
        Self::new(8)
    }
}
impl SimRouter {
    /// Bounded downstream queues; production uses eight frames and an 8 MiB session budget.
    pub fn new(capacity: usize) -> Self {
        Self {
            routes: BTreeMap::new(),
            next_epoch: 0,
            capacity,
            queued_bytes: 0,
        }
    }
    pub(crate) fn current(&self, doc: &str, epoch: u64) -> bool {
        self.routes
            .get(doc)
            .is_some_and(|route| route.epoch == epoch)
    }
    fn remove(&mut self, doc: &str) -> Option<Action> {
        let route = self.routes.remove(doc)?;
        self.queued_bytes = self
            .queued_bytes
            .saturating_sub(route.queue.iter().map(Vec::len).sum());
        Some(Action::Cancel {
            doc: doc.to_owned(),
            epoch: route.epoch,
        })
    }
    pub(crate) fn disconnect(&mut self) -> Vec<Action> {
        let docs = self.routes.keys().cloned().collect::<Vec<_>>();
        docs.iter().filter_map(|doc| self.remove(doc)).collect()
    }
    pub(crate) fn receive(&mut self, bytes: &[u8]) -> Result<Vec<Action>, Failure> {
        let mut actions = Vec::new();
        // Production drops malformed/unknown envelopes and keeps the physical socket.
        let Ok(message) = sync_protocol::ToRouter::deserialize(bytes) else {
            return Ok(actions);
        };
        match message {
            sync_protocol::ToRouter::RouterSubscribe { doc_id, token } => {
                if doc_id.len() > 512 || token.len() > 16 * 1024 {
                    actions.push(Action::Deliver(encode(
                        sync_protocol::FromRouter::RouterSubscribeFailed {
                            doc_id,
                            reason: "invalid subscription",
                        },
                    )?));
                    return Ok(actions);
                }
                let doc = doc_id.to_owned();
                actions.extend(self.remove(&doc));
                if self.routes.len() >= 64 {
                    actions.push(Action::Deliver(encode(
                        sync_protocol::FromRouter::RouterSubscribeFailed {
                            doc_id,
                            reason: "too many open documents",
                        },
                    )?));
                    return Ok(actions);
                }
                self.next_epoch = self.next_epoch.saturating_add(1);
                let epoch = self.next_epoch;
                self.routes.insert(
                    doc.to_owned(),
                    Route {
                        epoch,
                        ready: false,
                        queue: VecDeque::new(),
                    },
                );
                actions.push(Action::Open {
                    doc,
                    token: token.into(),
                    epoch,
                });
            }
            sync_protocol::ToRouter::RouterUnsubscribe { doc_id } => {
                actions.extend(self.remove(doc_id));
            }
            sync_protocol::ToRouter::RouterFrame { doc_id, payload } => {
                let doc = doc_id.to_owned();
                let Some(route) = self.routes.get_mut(&doc) else {
                    return Ok(actions);
                };
                if route.queue.len() >= self.capacity
                    || self.queued_bytes.saturating_add(payload.len()) > 8 * 1024 * 1024
                {
                    actions.extend(self.remove(&doc));
                    actions.push(Action::Deliver(encode(
                        sync_protocol::FromRouter::RouterDocClosed {
                            doc_id,
                            reason: "downstream queue unavailable",
                        },
                    )?));
                } else {
                    let frame = payload.iter().collect::<Vec<_>>();
                    self.queued_bytes += frame.len();
                    route.queue.push_back(frame);
                    if route.ready {
                        actions.push(Action::Pump {
                            doc,
                            epoch: route.epoch,
                        });
                    }
                }
            }
            sync_protocol::ToRouter::Unknown => {}
        }
        Ok(actions)
    }
    pub(crate) fn ready(&mut self, doc: &str, epoch: u64) -> Result<Vec<Action>, Failure> {
        let Some(route) = self
            .routes
            .get_mut(doc)
            .filter(|route| route.epoch == epoch)
        else {
            return Ok(Vec::new());
        };
        route.ready = true;
        Ok(vec![
            Action::Deliver(encode(sync_protocol::FromRouter::RouterSubscribed {
                doc_id: doc,
            })?),
            Action::Pump {
                doc: doc.to_owned(),
                epoch,
            },
        ])
    }
    pub(crate) fn drain(&mut self, doc: &str, epoch: u64) -> Vec<Vec<u8>> {
        let Some(route) = self
            .routes
            .get_mut(doc)
            .filter(|route| route.epoch == epoch && route.ready)
        else {
            return Vec::new();
        };
        let frames = route.queue.drain(..).collect::<Vec<_>>();
        self.queued_bytes = self
            .queued_bytes
            .saturating_sub(frames.iter().map(Vec::len).sum());
        frames
    }
    pub(crate) fn closed(
        &mut self,
        doc: &str,
        epoch: u64,
        dial: bool,
    ) -> Result<Vec<Action>, Failure> {
        if !self.current(doc, epoch) {
            return Ok(Vec::new());
        }
        let mut actions = self.remove(doc).into_iter().collect::<Vec<_>>();
        actions.push(Action::Deliver(encode(if dial {
            sync_protocol::FromRouter::RouterSubscribeFailed {
                doc_id: doc,
                reason: "dial failed",
            }
        } else {
            sync_protocol::FromRouter::RouterDocClosed {
                doc_id: doc,
                reason: "upstream closed",
            }
        })?));
        Ok(actions)
    }
    pub(crate) fn frame(
        &self,
        doc: &str,
        epoch: u64,
        frame: &[u8],
    ) -> Result<Option<Vec<u8>>, Failure> {
        if !self
            .routes
            .get(doc)
            .is_some_and(|route| route.epoch == epoch && route.ready)
        {
            return Ok(None);
        }
        encode(sync_protocol::FromRouter::RouterDocFrame {
            doc_id: doc,
            payload: SliceWrapper::Raw(frame),
        })
        .map(Some)
    }
}
fn encode(message: sync_protocol::FromRouter<'_>) -> Result<Vec<u8>, Failure> {
    let mut bytes = Vec::new();
    message
        .serialize(&mut bytes)
        .map_err(|error| Failure::new("router_encode", error))?;
    Ok(bytes)
}

#[cfg(test)]
mod test;
