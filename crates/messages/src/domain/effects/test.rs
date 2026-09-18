use super::*;
use crate::domain::models::MessageParent;
use std::sync::{Arc, Mutex};

struct Target {
    id: usize,
    fail: bool,
    log: Arc<Mutex<Vec<usize>>>,
}
impl MessageEventPublisher for Target {
    async fn publish(&self, _: MessageEvent) -> Result<(), rootcause::Report> {
        self.log.lock().unwrap().push(self.id);
        if self.fail {
            Err(rootcause::report!("target unavailable"))
        } else {
            Ok(())
        }
    }
}
fn event(change: MessageChange) -> MessageEvent {
    MessageEvent {
        parent: MessageParent::parse("document", "doc").unwrap(),
        actor: "macro|author@example.com".into(),
        nonce: None,
        change,
    }
}
#[tokio::test]
async fn every_committed_target_is_attempted_even_if_any_or_all_fail() {
    for failed in [vec![], vec![0], vec![1], vec![2], vec![0, 1, 2]] {
        let log = Arc::new(Mutex::new(Vec::new()));
        let target = |id| Target {
            id,
            fail: failed.contains(&id),
            log: log.clone(),
        };
        let effects = MessageEffects::new(target(0), target(1), target(2));
        let result = effects
            .publish(event(MessageChange::ThreadUpdated {
                state: crate::domain::models::ThreadState {
                    root_id: uuid::Uuid::from_u128(1),
                    user_id: "macro|author@example.com".into(),
                    resolved: true,
                    anchor: None,
                    created_at: chrono::Utc::now(),
                    updated_at: chrono::Utc::now(),
                    deleted_at: None,
                },
            }))
            .await;
        assert_eq!(result.is_err(), !failed.is_empty());
        assert_eq!(*log.lock().unwrap(), vec![0, 1, 2]);
    }
}
#[tokio::test]
async fn typing_only_reaches_the_parent_transport() {
    let log = Arc::new(Mutex::new(Vec::new()));
    let target = |id| Target {
        id,
        fail: id != 2,
        log: log.clone(),
    };
    MessageEffects::new(target(0), target(1), target(2))
        .publish(event(MessageChange::Typing {
            thread_id: None,
            active: true,
        }))
        .await
        .unwrap();
    assert_eq!(*log.lock().unwrap(), vec![2]);
}
