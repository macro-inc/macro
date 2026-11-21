use super::*;
use crate::domain::stream::FeedItem;
use kafka_util::progress::{PartitionProgress, STALE_AFTER};
use tokio::sync::broadcast::error::TryRecvError;

fn sample(received_at: Instant, pending: u64) -> Option<Arc<ProgressSample>> {
    Some(Arc::new(ProgressSample {
        received_at,
        sampled_at: chrono::Utc::now().timestamp(),
        partitions: vec![PartitionProgress {
            topic: "macro.agent_sessions".to_owned(),
            partition: 0,
            broker_up: true,
            position: Some(7),
            pending: Some(pending),
            prefetched: Some(0),
        }],
    }))
}

fn heartbeats_sent(receiver: &mut tokio::sync::broadcast::Receiver<FeedItem>) -> usize {
    let mut sent = 0;
    loop {
        match receiver.try_recv() {
            Ok(FeedItem::Heartbeat) => sent += 1,
            Ok(FeedItem::Event(_)) => panic!("only heartbeats were sent"),
            Err(TryRecvError::Empty) => return sent,
            Err(error) => panic!("{error:?}"),
        }
    }
}

#[test]
fn heartbeats_flow_only_while_the_consumer_is_progressing() {
    let feed = StreamFeed::new(16, 0);
    let (_, mut receiver) = feed.subscribe_after(None);
    let (samples, observed) = watch::channel(None);
    let mut heartbeat = Heartbeat::new(ProgressCheck::new(observed));

    assert_eq!(heartbeat.beat(&feed), Progress::NoSample);
    assert_eq!(heartbeats_sent(&mut receiver), 0);

    samples.send_replace(sample(Instant::now(), 0));
    assert_eq!(heartbeat.beat(&feed), Progress::Progressing);
    assert_eq!(heartbeats_sent(&mut receiver), 1);

    let long_ago = Instant::now().checked_sub(STALE_AFTER).expect("uptime");
    samples.send_replace(sample(long_ago, 0));
    assert_eq!(heartbeat.beat(&feed), Progress::Stale);
    assert_eq!(heartbeats_sent(&mut receiver), 0);

    // The same backlog position in two samples, the check between them.
    samples.send_replace(sample(Instant::now(), 3));
    heartbeat.beat(&feed);
    samples.send_replace(sample(Instant::now(), 5));
    assert_eq!(heartbeat.beat(&feed), Progress::Stuck);
    assert_eq!(heartbeats_sent(&mut receiver), 0);
}
