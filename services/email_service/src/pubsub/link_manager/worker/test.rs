use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

#[tokio::test(start_paused = true)]
async fn renews_visibility_while_work_outlasts_the_timeout() {
    let renewals = AtomicU32::new(0);

    let output = while_renewing_visibility(
        || async {
            renewals.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
        async {
            tokio::time::sleep(Duration::from_secs(150)).await;
            "purged"
        },
    )
    .await;

    assert_eq!(output, "purged");
    assert_eq!(renewals.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn failed_renewals_do_not_stop_the_work_or_later_renewals() {
    let renewals = AtomicU32::new(0);

    let output = while_renewing_visibility(
        || async {
            if renewals.fetch_add(1, Ordering::SeqCst) == 0 {
                anyhow::bail!("throttled");
            }
            Ok(())
        },
        async {
            tokio::time::sleep(Duration::from_secs(150)).await;
            "purged"
        },
    )
    .await;

    assert_eq!(output, "purged");
    assert_eq!(renewals.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn quick_work_does_not_renew() {
    let renewals = AtomicU32::new(0);

    while_renewing_visibility(
        || async {
            renewals.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
        async {},
    )
    .await;

    assert_eq!(renewals.load(Ordering::SeqCst), 0);
}

#[tokio::test(start_paused = true)]
async fn failed_work_stops_renewing_so_the_message_is_redelivered() {
    let renewals = AtomicU32::new(0);

    let output = while_renewing_visibility(
        || async {
            renewals.fetch_add(1, Ordering::SeqCst);
            Ok(())
        },
        async {
            tokio::time::sleep(Duration::from_secs(90)).await;
            Err::<(), _>(anyhow::anyhow!("purge batch failed"))
        },
    )
    .await;
    tokio::time::advance(Duration::from_secs(600)).await;

    assert!(output.is_err());
    assert_eq!(renewals.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn a_crashed_worker_stops_renewing() {
    let renewals = Arc::new(AtomicU32::new(0));

    let worker = tokio::spawn({
        let renewals = renewals.clone();
        async move {
            while_renewing_visibility(
                move || {
                    let renewals = renewals.clone();
                    async move {
                        renewals.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    }
                },
                async {
                    tokio::time::sleep(Duration::from_secs(150)).await;
                    panic!("worker crashed mid-purge");
                },
            )
            .await
        }
    });

    assert!(worker.await.expect_err("the worker panicked").is_panic());
    tokio::time::advance(Duration::from_secs(600)).await;

    assert_eq!(renewals.load(Ordering::SeqCst), 2);
}
