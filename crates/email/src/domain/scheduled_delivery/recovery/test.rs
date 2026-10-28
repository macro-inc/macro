use super::*;
use std::sync::{Arc, Mutex};

struct Repo {
    fail: bool,
    pending: Vec<PendingDelivery>,
}

impl ScheduledRecoveryRepo for Repo {
    fn pending_deliveries(&self) -> impl Stream<Item = anyhow::Result<PendingDelivery>> + Send {
        let results = if self.fail {
            vec![Err(anyhow::anyhow!("scan unavailable"))]
        } else {
            self.pending.iter().copied().map(Ok).collect()
        };
        futures::stream::iter(results)
    }
}

struct Queue(Arc<Mutex<Vec<PendingDelivery>>>);

impl ScheduledRecoveryQueue for Queue {
    async fn enqueue(&self, delivery: PendingDelivery) -> anyhow::Result<()> {
        let mut attempts = self.0.lock().unwrap();
        attempts.push(delivery);
        anyhow::ensure!(attempts.len() != 1, "first notification failed");
        Ok(())
    }
}

fn delivery(id: u128) -> PendingDelivery {
    PendingDelivery {
        link_id: Uuid::from_u128(1),
        message_id: Uuid::from_u128(id),
    }
}

#[tokio::test]
async fn failed_notification_does_not_starve_other_due_messages() {
    let attempts = Arc::new(Mutex::new(vec![]));
    let pending = vec![delivery(2), delivery(3)];
    let service = ScheduledRecovery::new(
        Repo {
            fail: false,
            pending: pending.clone(),
        },
        Queue(attempts.clone()),
    );
    service.scan().await.unwrap();
    assert_eq!(*attempts.lock().unwrap(), pending);
}

#[tokio::test]
async fn failed_scan_reports_failure_without_publishing() {
    let attempts = Arc::new(Mutex::new(vec![]));
    let service = ScheduledRecovery::new(
        Repo {
            fail: true,
            pending: vec![delivery(2)],
        },
        Queue(attempts.clone()),
    );
    assert!(service.scan().await.is_err());
    assert!(attempts.lock().unwrap().is_empty());
}
