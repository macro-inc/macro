use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Utc;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};

use super::BrokerInitiativeEventPublisher;
use crate::domain::events::{
    InitiativeChange, InitiativeEventPublisher, InitiativeMacroEvent, InitiativeTopicEvent,
};
use crate::domain::models::InitiativeId;

/// Accepts every event but never finishes delivering one, like a broker stuck
/// until its publish timeout.
#[derive(Clone, Default)]
struct StalledBroker(Arc<Mutex<Vec<String>>>);

impl MacroEventBroker for StalledBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.0.lock().unwrap().push(event.key().to_owned());
        Ok(tokio::spawn(std::future::pending()))
    }
}

#[tokio::test]
async fn publish_returns_once_the_broker_has_the_event() {
    let broker = StalledBroker::default();
    let publisher = BrokerInitiativeEventPublisher::new(broker.clone());
    let id = InitiativeId::generate();
    let event = InitiativeMacroEvent::new(
        id,
        InitiativeTopicEvent::Created(InitiativeChange {
            initiative_id: id,
            attribution: None,
            occurred_at: Utc::now(),
        }),
    );

    tokio::time::timeout(Duration::from_secs(1), publisher.publish(event))
        .await
        .expect("a stalled delivery must not delay the committed mutation")
        .expect("scheduling succeeds");

    assert_eq!(broker.0.lock().unwrap().len(), 1);
}
