use aws_lambda_events::{eventbridge::EventBridgeEvent, sqs::SqsEvent};
use serde::{Deserialize, Serialize};

pub mod key;

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IncomingEvent {
    EventBridgeEvent(EventBridgeEvent),
    SqsEvent(SqsEvent),
}
