use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use channels::domain::{
    models::{MutatedMessage, Sender},
    side_effects::ChannelBotTrigger,
};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::Notify;
use uuid::Uuid;

use super::*;

#[derive(Default)]
struct ChildState {
    running: AtomicBool,
    started: Notify,
}

struct RunningChildGuard(Arc<ChildState>);

impl Drop for RunningChildGuard {
    fn drop(&mut self) {
        self.0.running.store(false, Ordering::SeqCst);
    }
}

fn trigger() -> ChannelBotTrigger {
    let now = Utc::now();
    let channel_id = Uuid::new_v4();
    ChannelBotTrigger {
        channel_id,
        message: MutatedMessage {
            id: Uuid::new_v4(),
            channel_id,
            thread_id: None,
            sender_id: Sender::new_from_user(
                MacroUserIdStr::try_from("macro|alice@example.com".to_string()).unwrap(),
            ),
            triggered_by: None,
            content: "@macro help".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
        },
        bot_ids: vec![bot_id::MACRO_AI_BOT_ID],
    }
}

#[tokio::test]
async fn aborting_router_aborts_running_child_executions() {
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    let child = Arc::new(ChildState::default());
    let router = spawn_router_task(receiver, {
        let child = child.clone();
        move |_trigger| {
            let child = child.clone();
            async move {
                child.running.store(true, Ordering::SeqCst);
                let _running_guard = RunningChildGuard(child.clone());
                child.started.notify_one();
                std::future::pending::<()>().await;
            }
        }
    });
    let started = child.started.notified();

    sender.send(trigger()).unwrap();
    started.await;
    assert!(child.running.load(Ordering::SeqCst));

    router.abort();
    assert!(router.await.unwrap_err().is_cancelled());
    for _ in 0..10 {
        if !child.running.load(Ordering::SeqCst) {
            break;
        }
        tokio::task::yield_now().await;
    }

    assert!(!child.running.load(Ordering::SeqCst));
}
