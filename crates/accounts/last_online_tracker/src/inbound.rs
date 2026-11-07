use macro_user_id::user_id::MacroUserIdStr;
use tokio::task::JoinHandle;

use crate::domain::{
    ports::{LastOnlineRepo, SystemTime},
    services::LastOnlineService,
};

pub struct LastOnlineWorker {
    tx: tokio::sync::mpsc::Sender<MacroUserIdStr<'static>>,
    #[expect(dead_code)]
    handle: JoinHandle<()>,
}

pub struct RecordOnDrop {
    val: MacroUserIdStr<'static>,
    tx: tokio::sync::mpsc::Sender<MacroUserIdStr<'static>>,
}

impl Drop for RecordOnDrop {
    fn drop(&mut self) {
        if let Err(e) = self.tx.try_send(self.val.clone()) {
            tracing::error!("{e:?}");
        }
    }
}

impl LastOnlineWorker {
    /// Create a new [LastOnlineWorker] that processes last-online updates in the background.
    pub fn new<T: SystemTime, R: LastOnlineRepo>(service: LastOnlineService<T, R>) -> Self {
        let (tx, mut rx) = tokio::sync::mpsc::channel(100);

        let handle = tokio::task::spawn(async move {
            while let Some(user) = rx.recv().await {
                let _ = service.record_last_online(user).await;
            }
        });

        LastOnlineWorker { tx, handle }
    }

    /// Returns a guard which records the users online time during creation and also during drop.
    pub fn new_guard(&self, user: MacroUserIdStr<'static>) -> RecordOnDrop {
        let tx = self.tx.clone();
        if let Err(e) = tx.try_send(user.clone()) {
            tracing::error!("{e:?}");
        }

        RecordOnDrop { val: user, tx }
    }

    /// Record that a user is currently online without creating a guard.
    ///
    /// Use this to refresh the last-online timestamp during long-lived connections
    /// (e.g. on each WebSocket ping/pong) so the user is not falsely reported as offline.
    pub fn record_online(&self, user: MacroUserIdStr<'static>) {
        if let Err(e) = self.tx.try_send(user) {
            tracing::error!("{e:?}");
        }
    }
}
