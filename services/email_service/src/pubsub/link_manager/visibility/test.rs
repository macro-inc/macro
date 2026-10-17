use super::*;

const INTERVAL: Duration = Duration::from_secs(300);

fn message(receipt_handle: &str) -> aws_sdk_sqs::types::Message {
    aws_sdk_sqs::types::Message::builder()
        .receipt_handle(receipt_handle)
        .build()
}

fn recording_visibility(handles: &[&str]) -> (BatchVisibility, Arc<Mutex<Vec<String>>>) {
    let extended = Arc::new(Mutex::new(Vec::new()));
    let visibility =
        BatchVisibility::start_with(handles.iter().map(|h| h.to_string()), INTERVAL, {
            let extended = extended.clone();
            move |receipt_handle| {
                extended.lock().unwrap().push(receipt_handle);
                async { Ok(()) }
            }
        });
    (visibility, extended)
}

fn take_sorted(extended: &Mutex<Vec<String>>) -> Vec<String> {
    let mut calls = std::mem::take(&mut *extended.lock().unwrap());
    calls.sort();
    calls
}

async fn advance(duration: Duration) {
    tokio::time::advance(duration).await;
    tokio::task::yield_now().await;
}

#[tokio::test(start_paused = true)]
async fn extends_every_pending_message_each_interval() {
    let (_visibility, extended) = recording_visibility(&["a", "b"]);

    advance(INTERVAL - Duration::from_secs(1)).await;
    assert!(
        take_sorted(&extended).is_empty(),
        "no heartbeat before the first interval"
    );

    advance(Duration::from_secs(1)).await;
    assert_eq!(take_sorted(&extended), ["a", "b"]);

    advance(INTERVAL).await;
    assert_eq!(take_sorted(&extended), ["a", "b"]);
}

#[tokio::test(start_paused = true)]
async fn stops_extending_finished_messages() {
    let (visibility, extended) = recording_visibility(&["a", "b"]);

    visibility.finish(&message("a"));
    advance(INTERVAL).await;

    assert_eq!(take_sorted(&extended), ["b"]);
}

#[tokio::test(start_paused = true)]
async fn stops_heartbeat_when_dropped() {
    let (visibility, extended) = recording_visibility(&["a"]);

    drop(visibility);
    advance(INTERVAL * 3).await;

    assert!(take_sorted(&extended).is_empty());
}

#[tokio::test(start_paused = true)]
async fn keeps_extending_after_a_failed_heartbeat() {
    let attempts = Arc::new(Mutex::new(0_u32));
    let _visibility = BatchVisibility::start_with(["a".to_string()], INTERVAL, {
        let attempts = attempts.clone();
        move |_| {
            let attempt = {
                let mut attempts = attempts.lock().unwrap();
                *attempts += 1;
                *attempts
            };
            async move {
                if attempt == 1 {
                    anyhow::bail!("throttled");
                }
                Ok(())
            }
        }
    });

    advance(INTERVAL).await;
    advance(INTERVAL).await;

    assert_eq!(*attempts.lock().unwrap(), 2);
}
