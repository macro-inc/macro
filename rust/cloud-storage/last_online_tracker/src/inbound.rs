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
    val: Option<MacroUserIdStr<'static>>,
    tx: tokio::sync::mpsc::Sender<MacroUserIdStr<'static>>,
}

impl Drop for RecordOnDrop {
    fn drop(&mut self) {
        let Some(val) = self.val.take() else {
            return;
        };
        if let Err(e) = self.tx.try_send(val) {
            tracing::error!("{e:?}");
        }
    }
}

impl LastOnlineWorker {
    pub fn new<T: SystemTime, R: LastOnlineRepo>(service: LastOnlineService<T, R>) -> Self {
        let (tx, mut rx) = tokio::sync::mpsc::channel(25);

        let handle = tokio::task::spawn(async move {
            while let Some(user) = rx.recv().await {
                let _ = service.record_last_online(user).await;
            }
        });

        LastOnlineWorker { tx, handle }
    }

    /// returns a guard which records the users online time when going out of scope
    pub fn new_guard(&self, user: MacroUserIdStr<'static>) -> RecordOnDrop {
        let tx = self.tx.clone();
        RecordOnDrop {
            val: Some(user),
            tx,
        }
    }
}
