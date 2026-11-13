//! Delivers what the workers queue, as SQS would: a message is received
//! again until a worker deletes it, and its queue's redrive policy
//! dead-letters it after the queue's maximum receives
//! (`infra/stacks/email-service`). Redelivery is immediate: send delays and
//! visibility timeouts are ignored, so specs count receives, not time.

use crate::pubsub::test_support::fake_sqs::{Ack, FakeSqs, Sent};
use aws_sdk_sqs::types::{Message, MessageSystemAttributeName};
use std::collections::VecDeque;

/// A queue the harness delivers from, and its redrive policy.
#[derive(Clone, Debug)]
pub struct QueueSpec {
    pub url: String,
    pub max_receives: u32,
}

#[derive(Clone, Debug)]
pub struct Queued {
    pub queue_url: String,
    pub body: String,
    pub receives: u32,
    id: String,
}

pub struct Queues {
    sqs: FakeSqs,
    specs: Vec<QueueSpec>,
    pending: VecDeque<Queued>,
    /// Messages a queue gave up on after its maximum receives.
    pub dead_letters: Vec<Queued>,
}

impl Queues {
    pub fn new(sqs: FakeSqs, specs: Vec<QueueSpec>) -> Queues {
        Queues {
            sqs,
            specs,
            pending: VecDeque::new(),
            dead_letters: Vec::new(),
        }
    }

    /// The fake SQS endpoint the queues live on.
    pub fn sqs_url(&self) -> String {
        self.sqs.url.clone()
    }

    /// Takes what was sent since the last call onto its queue.
    pub fn absorb(&mut self) {
        let (sent, _) = self.sqs.take();
        self.enqueue(sent);
    }

    /// Receives the next message, or `None` when every queue is empty.
    pub fn receive(&mut self) -> Option<(Queued, Message)> {
        let mut queued = self.pending.pop_front()?;
        queued.receives += 1;
        let message = Message::builder()
            .message_id(&queued.id)
            .receipt_handle(receipt(&queued))
            .body(&queued.body)
            .attributes(
                MessageSystemAttributeName::ApproximateReceiveCount,
                queued.receives.to_string(),
            )
            .build();
        Some((queued, message))
    }

    /// After a worker handled `queued`: keeps what it sent, and puts the
    /// message back unless the worker deleted it or its queue gave up on it.
    pub fn settle(&mut self, queued: Queued) {
        let (sent, acks) = self.sqs.take();
        self.enqueue(sent);
        let handle = receipt(&queued);
        let deleted = acks
            .iter()
            .any(|ack| matches!(ack, Ack::Deleted { receipt } if *receipt == handle));
        if deleted {
            return;
        }

        let max_receives = self
            .spec(&queued.queue_url)
            .map_or(1, |spec| spec.max_receives);
        if queued.receives >= max_receives {
            self.dead_letters.push(queued);
        } else {
            self.pending.push_back(queued);
        }
    }

    fn spec(&self, url: &str) -> Option<&QueueSpec> {
        self.specs.iter().find(|spec| spec.url == url)
    }

    fn enqueue(&mut self, sent: Vec<Sent>) {
        for message in sent {
            // Nothing delivers from other queues, so their messages are dropped.
            if self.spec(&message.queue_url).is_none() {
                continue;
            }
            self.pending.push_back(Queued {
                queue_url: message.queue_url,
                body: message.body,
                receives: 0,
                id: message.message_id,
            });
        }
    }
}

fn receipt(queued: &Queued) -> String {
    format!("{}#{}", queued.id, queued.receives)
}
