use std::sync::{Arc, Mutex};

use super::*;

#[derive(Clone, Default)]
struct FakeSource {
    calls: Arc<Mutex<Vec<Duration>>>,
}

impl ActivitySource for FakeSource {
    async fn long_transactions(&mut self, older_than: Duration) -> Result<Sample, SampleError> {
        let mut calls = self.calls.lock().unwrap();
        calls.push(older_than);
        match calls.len() {
            1 => Ok(Sample::NotLeader),
            2 => Err(SampleError("connection refused".into())),
            _ => Ok(Sample::Sessions(vec![])),
        }
    }
}

#[tokio::test(start_paused = true)]
async fn samples_every_interval_through_failures_until_stopped() {
    let source = FakeSource::default();
    let calls = Arc::clone(&source.calls);
    let stop = CancellationToken::new();
    let config = SamplerConfig {
        interval: Duration::from_secs(60),
        older_than: Duration::from_secs(300),
    };
    let sampler = tokio::spawn(run(source, config, stop.clone()));

    // The first tick fires immediately, then one per interval.
    tokio::time::sleep(Duration::from_secs(150)).await;
    assert_eq!(*calls.lock().unwrap(), vec![Duration::from_secs(300); 3]);

    stop.cancel();
    sampler.await.unwrap();
    tokio::time::sleep(Duration::from_secs(600)).await;
    assert_eq!(calls.lock().unwrap().len(), 3);
}
