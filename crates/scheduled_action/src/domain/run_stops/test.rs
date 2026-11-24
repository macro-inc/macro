use std::sync::{Arc, Mutex};

use macro_uuid::generate_uuid_v7;

use super::*;

#[tokio::test]
async fn a_watch_ends_on_its_own_runs_stop_and_not_on_another() {
    let stops = RunStops::default();
    let (run, other) = (generate_uuid_v7(), generate_uuid_v7());
    let watch = stops.watch();
    stops.request(other).await.unwrap();
    stops.request(run).await.unwrap();
    // Both stops are buffered; the watch skips the other run's and ends on its own.
    watch.stopped(run).await;

    let watch = stops.watch();
    stops.request(other).await.unwrap();
    let ended = tokio::time::timeout(std::time::Duration::ZERO, watch.stopped(run)).await;
    assert!(ended.is_err(), "another run's stop must not end this watch");
}

struct Recorded(Mutex<Vec<Uuid>>);

#[async_trait::async_trait]
impl StopRelay for Recorded {
    async fn send(&self, run: Uuid) -> Result<()> {
        self.0.lock().unwrap().push(run);
        Ok(())
    }
}

#[tokio::test]
async fn a_relayed_stop_is_heard_only_when_the_relay_delivers_it() {
    let relay = Arc::new(Recorded(Mutex::new(Vec::new())));
    let stops = RunStops::new(Some(relay.clone()));
    let run = generate_uuid_v7();
    let watch = stops.watch();
    stops.request(run).await.unwrap();
    assert_eq!(*relay.0.lock().unwrap(), vec![run]);

    // Delivery comes back through `heard`, as the listener calls it.
    stops.heard(run);
    watch.stopped(run).await;
}
