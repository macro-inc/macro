//! Time entry events on Macro's shared event broker.

#[cfg(test)]
mod test;

use macro_event_broker::{MacroEvent, MacroEventBroker};

use crate::domain::events::{TimeEntryEventPublisher, TimeEntryMacroEvent};

/// Publishes time entry events through the host's broker.
pub struct BrokerTimeEntryEventPublisher<B> {
    broker: B,
}

impl<B> BrokerTimeEntryEventPublisher<B> {
    /// Compose from the host's shared broker.
    pub fn new(broker: B) -> Self {
        Self { broker }
    }
}

impl<B: MacroEventBroker + Send + Sync + 'static> TimeEntryEventPublisher
    for BrokerTimeEntryEventPublisher<B>
{
    /// Delivery continues in the broker's own task, which logs failures, so a
    /// slow broker never delays the write that already committed.
    fn publish(&self, event: TimeEntryMacroEvent) {
        drop(self.broker.send_event(&event).inspect_err(|error| {
            tracing::error!(error = ?error, task_id = %event.key(), "failed to schedule a time entry event");
        }));
    }
}
