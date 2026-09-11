//! Recording [`AgentSessionNotifier`] test double.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use crate::domain::notifications::PlannedNotification;
use crate::domain::ports::AgentSessionNotifier;

/// An [`AgentSessionNotifier`] that records instead of sending. Cloning
/// shares one record.
#[derive(Clone, Default)]
pub struct NotifierMock {
    notified: Arc<Mutex<Vec<PlannedNotification>>>,
}

impl NotifierMock {
    /// A notifier that has notified nobody.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Every notification sent so far, in order.
    #[must_use]
    pub fn notified(&self) -> Vec<PlannedNotification> {
        self.notified
            .lock()
            .expect("notifier mock lock should not be poisoned")
            .clone()
    }
}

impl AgentSessionNotifier for NotifierMock {
    fn notify(
        &self,
        notification: PlannedNotification,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        self.notified
            .lock()
            .expect("notifier mock lock should not be poisoned")
            .push(notification);
        Box::pin(async {})
    }
}
