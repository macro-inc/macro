use std::{sync::mpsc, time::Duration};

use super::*;

#[test]
fn spawns_without_an_entered_tokio_runtime() {
    assert!(tokio::runtime::Handle::try_current().is_err());
    let (sender, receiver) = mpsc::channel();

    TauriTaskSpawner::spawn(async move {
        sender.send(()).unwrap();
    });

    receiver
        .recv_timeout(Duration::from_secs(1))
        .expect("task should run on Tauri's global runtime");
}
