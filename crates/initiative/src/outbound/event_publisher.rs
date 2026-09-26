//! Initiative event publication through Macro's shared event broker.

use macro_event_broker::MacroEventBroker;
use std::{future::Future, pin::Pin};

use crate::domain::{
    events::{InitiativeEventPublisher, InitiativeMacroEvent},
    models::InitiativeError,
};

/// Adapter for the broker assembled by the host composition root.
pub struct BrokerInitiativeEventPublisher<B> {
    broker: B,
}

impl<B> BrokerInitiativeEventPublisher<B> {
    /// Compose from the host's shared broker.
    pub fn new(broker: B) -> Self {
        Self { broker }
    }
}

impl<B: MacroEventBroker + 'static> InitiativeEventPublisher for BrokerInitiativeEventPublisher<B> {
    fn publish(
        &self,
        event: InitiativeMacroEvent,
    ) -> Pin<Box<dyn Future<Output = Result<(), InitiativeError>> + Send + '_>> {
        Box::pin(async move {
            self.broker
                .send_event(&event)
                .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))?
                .await
                .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))?
                .map_err(|error| InitiativeError::Internal(rootcause::report!(error).into()))
        })
    }
}
