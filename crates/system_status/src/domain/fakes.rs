//! In-memory port implementations for tests.

use std::sync::Mutex;

use crate::domain::{
    models::{CurrentSystemStatus, StatusUpdate},
    ports::{StatusBroadcaster, SystemStatusRepo},
};

#[derive(Debug, thiserror::Error)]
#[error("fake failure")]
pub(crate) struct FakeError;

#[derive(Default)]
pub(crate) struct FakeRepo {
    pub(crate) updates: Mutex<Vec<StatusUpdate>>,
}

impl SystemStatusRepo for FakeRepo {
    type Err = FakeError;

    async fn insert_update(&self, update: &StatusUpdate) -> Result<(), FakeError> {
        self.updates.lock().unwrap().push(update.clone());
        Ok(())
    }

    async fn latest_update(&self) -> Result<Option<StatusUpdate>, FakeError> {
        Ok(self.updates.lock().unwrap().last().cloned())
    }

    async fn list_updates(&self, limit: u16) -> Result<Vec<StatusUpdate>, FakeError> {
        Ok(self
            .updates
            .lock()
            .unwrap()
            .iter()
            .rev()
            .take(usize::from(limit))
            .cloned()
            .collect())
    }
}

#[derive(Default)]
pub(crate) struct FakeBroadcaster {
    pub(crate) fail: bool,
    pub(crate) sent: Mutex<Vec<CurrentSystemStatus>>,
}

impl StatusBroadcaster for FakeBroadcaster {
    type Err = FakeError;

    async fn broadcast(&self, status: &CurrentSystemStatus) -> Result<(), FakeError> {
        if self.fail {
            return Err(FakeError);
        }
        self.sent.lock().unwrap().push(status.clone());
        Ok(())
    }
}
