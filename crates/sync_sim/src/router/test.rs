use super::*;
use std::sync::{Arc, Mutex};
use sync_router::domain::{
    models::{ConnectionId, DocId, DownstreamFailure, EdgeEvent, Event},
    ports::{Downstream, DownstreamFactory, EdgeSink, QueuedFrame},
    router::Router,
};
use tokio::sync::{Semaphore, mpsc};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Observation {
    Deliver(Vec<u8>),
    Forward(String, u64, Vec<u8>),
}
#[derive(Default)]
struct Sink(Mutex<Vec<Vec<u8>>>, Mutex<Vec<Observation>>);
impl EdgeSink for Sink {
    type Err = anyhow::Error;
    async fn deliver(&self, _: &ConnectionId, frame: Vec<u8>) -> Result<(), Self::Err> {
        self.0.lock().unwrap().push(frame.clone());
        self.1.lock().unwrap().push(Observation::Deliver(frame));
        Ok(())
    }
}
struct Opened {
    doc: String,
    token: String,
    epoch: u64,
    receiver: mpsc::Receiver<QueuedFrame>,
    cancel: CancellationToken,
    ready: bool,
}
struct Factory {
    opened: Arc<Mutex<Vec<Opened>>>,
    capacity: usize,
    budget: Arc<Semaphore>,
}
impl DownstreamFactory for Factory {
    fn open(&self, _: ConnectionId, doc: DocId, token: String, epoch: u64) -> Downstream {
        let (sender, receiver) = mpsc::channel(self.capacity);
        let cancel = CancellationToken::new();
        self.opened.lock().unwrap().push(Opened {
            doc: doc.0,
            token,
            epoch,
            receiver,
            cancel: cancel.clone(),
            ready: false,
        });
        Downstream::new(sender, cancel, self.budget.clone())
    }
}
enum Input {
    Wire(Vec<u8>),
    Closed {
        doc: &'static str,
        epoch: u64,
        dial: bool,
    },
    Disconnect,
    Ready {
        doc: &'static str,
        epoch: u64,
    },
    Upstream {
        doc: &'static str,
        epoch: u64,
        frame: Vec<u8>,
    },
}
fn subscribe(doc: &str) -> Input {
    let mut bytes = Vec::new();
    sync_protocol::ToRouter::RouterSubscribe {
        doc_id: doc,
        token: "tok",
    }
    .serialize(&mut bytes)
    .unwrap();
    Input::Wire(bytes)
}
fn frame(doc: &str, payload: &[u8]) -> Input {
    let mut bytes = Vec::new();
    sync_protocol::ToRouter::RouterFrame {
        doc_id: doc,
        payload: SliceWrapper::Raw(payload),
    }
    .serialize(&mut bytes)
    .unwrap();
    Input::Wire(bytes)
}
/// Replay the domain router's story inputs against both implementations. Compare
/// opens, cancellation, queue bounds, exact retained chunks and exact envelopes.
fn parity(capacity: usize, inputs: &[Input]) {
    futures::executor::block_on(async {
        let opened = Arc::new(Mutex::new(Vec::<Opened>::new()));
        let sink = Arc::new(Sink::default());
        let mut real = Router::new(
            sink.clone(),
            Factory {
                opened: opened.clone(),
                capacity,
                budget: Arc::new(Semaphore::new(8 * 1024 * 1024)),
            },
        );
        let mut fake = SimRouter::new(capacity);
        let mut fake_opened = Vec::new();
        let mut fake_delivered = Vec::new();
        let mut fake_observed = Vec::new();
        let conn = ConnectionId("simulation:socket".into());
        for input in inputs {
            let actions = match input {
                Input::Wire(bytes) => {
                    real.handle(Event::Edge(EdgeEvent::Frame {
                        conn: conn.clone(),
                        payload: bytes.clone(),
                    }))
                    .await;
                    fake.receive(bytes).unwrap()
                }
                Input::Closed { doc, epoch, dial } => {
                    real.handle(Event::DownstreamClosed {
                        conn: conn.clone(),
                        doc: DocId((*doc).into()),
                        epoch: *epoch,
                        failure: if *dial {
                            DownstreamFailure::DialFailed
                        } else {
                            DownstreamFailure::Closed("upstream closed")
                        },
                    })
                    .await;
                    fake.closed(doc, *epoch, *dial).unwrap()
                }
                Input::Ready { doc, epoch } => {
                    // Production's downstream pump sends these generated envelopes
                    // only after dial/authorization and only while its cancellation is live.
                    let active = {
                        let mut records = opened.lock().unwrap();
                        if let Some(record) = records.iter_mut().find(|record| {
                            record.doc == *doc
                                && record.epoch == *epoch
                                && !record.cancel.is_cancelled()
                        }) {
                            record.ready = true;
                            true
                        } else {
                            false
                        }
                    };
                    if active {
                        sink.deliver(&conn, sync_router::domain::envelope::subscribed(doc))
                            .await
                            .unwrap();
                    }
                    fake.ready(doc, *epoch).unwrap()
                }
                Input::Upstream { doc, epoch, frame } => {
                    let active = opened.lock().unwrap().iter().any(|record| {
                        record.doc == *doc
                            && record.epoch == *epoch
                            && record.ready
                            && !record.cancel.is_cancelled()
                    });
                    if active {
                        sink.deliver(&conn, sync_router::domain::envelope::doc_frame(doc, frame))
                            .await
                            .unwrap();
                    }
                    fake.frame(doc, *epoch, frame)
                        .unwrap()
                        .map(Action::Deliver)
                        .into_iter()
                        .collect()
                }
                Input::Disconnect => {
                    real.handle(Event::Edge(EdgeEvent::Disconnected { conn: conn.clone() }))
                        .await;
                    fake.disconnect()
                }
            };
            for action in actions {
                match action {
                    Action::Open { doc, token, epoch } => fake_opened.push((doc, token, epoch)),
                    Action::Deliver(bytes) => {
                        fake_delivered.push(bytes.clone());
                        fake_observed.push(Observation::Deliver(bytes));
                    }
                    Action::Cancel { .. } => {}
                    Action::Pump { doc, epoch } => {
                        for frame in fake.drain(&doc, epoch) {
                            fake_observed.push(Observation::Forward(doc.clone(), epoch, frame));
                        }
                    }
                }
            }
            {
                let mut records = opened.lock().unwrap();
                for record in records
                    .iter_mut()
                    .filter(|record| record.ready && !record.cancel.is_cancelled())
                {
                    while let Ok(frame) = record.receiver.try_recv() {
                        sink.1.lock().unwrap().push(Observation::Forward(
                            record.doc.clone(),
                            record.epoch,
                            frame.bytes,
                        ));
                    }
                }
            }
            assert_eq!(*sink.1.lock().unwrap(), fake_observed);
            // A cancelled downstream pump drops its queued frames and byte permits.
            let mut records = opened.lock().unwrap();
            for record in records
                .iter_mut()
                .filter(|record| record.cancel.is_cancelled())
            {
                while record.receiver.try_recv().is_ok() {}
            }
            let real_opened = records
                .iter()
                .map(|r| (r.doc.clone(), r.token.clone(), r.epoch))
                .collect::<Vec<_>>();
            assert_eq!(real_opened, fake_opened);
            let live = records
                .iter()
                .filter(|r| !r.cancel.is_cancelled())
                .map(|r| (r.doc.clone(), (r.epoch, r.receiver.len())))
                .collect::<BTreeMap<_, _>>();
            let simulated = fake
                .routes
                .iter()
                .map(|(doc, route)| (doc.clone(), (route.epoch, route.queue.len())))
                .collect::<BTreeMap<_, _>>();
            assert_eq!(live, simulated);
            assert_eq!(*sink.0.lock().unwrap(), fake_delivered);
        }
        for record in opened
            .lock()
            .unwrap()
            .iter_mut()
            .filter(|r| !r.cancel.is_cancelled())
        {
            let mut frames = Vec::new();
            while let Ok(frame) = record.receiver.try_recv() {
                frames.push(frame.bytes);
            }
            assert_eq!(
                frames,
                fake.routes[&record.doc]
                    .queue
                    .iter()
                    .cloned()
                    .collect::<Vec<_>>()
            );
        }
    });
}
#[test]
fn buffers_before_dial_and_duplicate_subscribe_waits_for_authority() {
    parity(
        8,
        &[
            subscribe("doc-a"),
            frame("doc-a", b"first"),
            frame("doc-a", b"second"),
            subscribe("doc-a"),
            frame("doc-a", b"replacement"),
        ],
    );
}
#[test]
fn disconnect_drops_every_route_and_ignores_late_frames() {
    parity(
        8,
        &[
            subscribe("doc-a"),
            subscribe("doc-b"),
            Input::Disconnect,
            frame("doc-a", b"late"),
        ],
    );
}
#[test]
fn unknown_routes_and_garbage_are_dropped() {
    parity(8, &[frame("absent", b"x"), Input::Wire(vec![0xde, 0xad])]);
}
#[test]
fn failure_resubscribe_and_stale_epoch_match_the_real_router() {
    parity(
        8,
        &[
            subscribe("doc-a"),
            Input::Closed {
                doc: "doc-a",
                epoch: 1,
                dial: true,
            },
            subscribe("doc-a"),
            subscribe("doc-a"),
            Input::Closed {
                doc: "doc-a",
                epoch: 2,
                dial: true,
            },
            frame("doc-a", b"current"),
            Input::Closed {
                doc: "doc-a",
                epoch: 3,
                dial: false,
            },
            subscribe("doc-a"),
        ],
    );
}
#[test]
fn full_queue_closes_instead_of_losing_a_chunk() {
    parity(
        1,
        &[
            subscribe("doc-a"),
            frame("doc-a", &[0, 1]),
            frame("doc-a", &[1, 2]),
            subscribe("doc-a"),
        ],
    );
}
#[test]
fn limits_and_unsubscribe_match_the_real_router() {
    let mut steps = (0..65)
        .map(|i| subscribe(&format!("doc-{i}")))
        .collect::<Vec<_>>();
    steps.push(subscribe(&"x".repeat(513)));
    let mut bytes = Vec::new();
    sync_protocol::ToRouter::RouterUnsubscribe { doc_id: "doc-0" }
        .serialize(&mut bytes)
        .unwrap();
    steps.push(Input::Wire(bytes));
    steps.push(subscribe(""));
    parity(8, &steps);
}

#[test]
fn byte_budget_is_shared_across_document_queues() {
    parity(
        8,
        &[
            subscribe("doc-a"),
            subscribe("doc-b"),
            frame("doc-a", &vec![0; 4 * 1024 * 1024]),
            frame("doc-b", &vec![0; 4 * 1024 * 1024]),
            frame("doc-b", &[1]),
            subscribe("doc-b"),
            frame("doc-b", &[2]),
        ],
    );
}

#[test]
fn ready_precedes_frames_and_stale_pumps_cannot_publish() {
    parity(
        8,
        &[
            subscribe("doc-a"),
            frame("doc-a", b"queued"),
            Input::Upstream {
                doc: "doc-a",
                epoch: 1,
                frame: vec![1, 2],
            },
            Input::Ready {
                doc: "doc-a",
                epoch: 1,
            },
            Input::Upstream {
                doc: "doc-a",
                epoch: 1,
                frame: vec![1, 3],
            },
            frame("doc-a", b"live"),
            subscribe("doc-a"),
            Input::Ready {
                doc: "doc-a",
                epoch: 1,
            },
            Input::Upstream {
                doc: "doc-a",
                epoch: 1,
                frame: vec![1, 4],
            },
            Input::Ready {
                doc: "doc-a",
                epoch: 2,
            },
            Input::Upstream {
                doc: "doc-a",
                epoch: 2,
                frame: vec![1, 5],
            },
        ],
    );
}
