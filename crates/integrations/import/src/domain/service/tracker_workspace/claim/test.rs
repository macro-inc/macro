use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
async fn completion_during_wait_registration_rechecks_the_claim() {
    let calls = AtomicUsize::new(0);
    let holder = Uuid::now_v7();
    let result = resolve(
        || {
            let call = calls.fetch_add(1, Ordering::SeqCst);
            async move {
                Ok(if call == 0 {
                    TeamClaim::Waiting { holder }
                } else {
                    TeamClaim::Linked {
                        entity_id: "existing".into(),
                        entity_type: "task".into(),
                    }
                })
            }
        },
        |_| async { Ok(false) },
    )
    .await
    .unwrap();
    assert_eq!(
        result,
        TeamClaim::Linked {
            entity_id: "existing".into(),
            entity_type: "task".into()
        }
    );
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_registered_waiter_is_preserved_and_churn_is_bounded() {
    let holder = Uuid::now_v7();
    assert_eq!(
        resolve(
            || async { Ok(TeamClaim::Waiting { holder }) },
            |_| async { Ok(true) }
        )
        .await
        .unwrap(),
        TeamClaim::Waiting { holder }
    );
    assert!(matches!(
        resolve(
            || async { Ok(TeamClaim::Waiting { holder }) },
            |_| async { Ok(false) }
        )
        .await,
        Err(ImportError::NotReady(_))
    ));
}
