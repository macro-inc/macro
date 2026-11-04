use super::*;
use rdkafka::statistics::{Broker, Partition, Topic};

#[tokio::test]
async fn dropping_consumer_cancels_and_drains_its_tracked_reporter() {
    let (observer, health) = ConsumerHealth::start();
    let cancellation = health.cancellation.clone();
    let tasks = health.tasks.clone();
    drop(health);
    assert!(cancellation.is_cancelled());
    tasks.wait().await;
    assert!(tasks.is_empty());
    // A native callback racing with shutdown is harmless after the receiver closes.
    observer(&Statistics::default());
}

#[test]
fn measures_application_backlog_not_commit_or_fetch_position() {
    let stats = Statistics {
        topics: [(
            TOPIC.to_owned(),
            Topic {
                partitions: [(
                    0,
                    Partition {
                        partition: 0,
                        desired: true,
                        app_offset: 10,
                        next_offset: 100,
                        hi_offset: 100,
                        committed_offset: -1001,
                        stored_offset: -1001,
                        fetchq_cnt: 90,
                        ..Default::default()
                    },
                )]
                .into(),
                ..Default::default()
            },
        )]
        .into(),
        ..Default::default()
    };
    let result = backlog(&stats).expect("topic present");
    assert_eq!(result.known_partitions, 1);
    assert_eq!(result.max_offset_backlog, 90);
    assert_eq!(result.total_offset_backlog, 90);
    assert_eq!(result.prefetched_messages, 90);
}

#[test]
fn initial_latest_position_includes_prefetched_records_and_idle_partitions() {
    let stats = Statistics {
        topics: [(
            TOPIC.to_owned(),
            Topic {
                partitions: [
                    (
                        0,
                        Partition {
                            partition: 0,
                            desired: true,
                            app_offset: -1001,
                            next_offset: 100,
                            hi_offset: 100,
                            fetchq_cnt: 0,
                            ..Default::default()
                        },
                    ),
                    (
                        1,
                        Partition {
                            partition: 1,
                            desired: true,
                            app_offset: -1001,
                            next_offset: 100,
                            hi_offset: 110,
                            fetchq_cnt: 20,
                            ..Default::default()
                        },
                    ),
                ]
                .into(),
                ..Default::default()
            },
        )]
        .into(),
        ..Default::default()
    };
    let result = backlog(&stats).expect("topic present");
    assert_eq!(result.known_partitions, 2);
    assert_eq!(result.unknown_partitions, 0);
    assert_eq!(result.max_offset_backlog, 30);
    assert_eq!(result.total_offset_backlog, 30);
}

#[test]
fn excludes_unassigned_partitions_and_does_not_turn_unknown_offsets_into_zero() {
    let stats = Statistics {
        topics: [(
            TOPIC.to_owned(),
            Topic {
                partitions: [
                    (
                        -1,
                        Partition {
                            partition: -1,
                            desired: true,
                            ..Default::default()
                        },
                    ),
                    (
                        0,
                        Partition {
                            partition: 0,
                            desired: false,
                            ..Default::default()
                        },
                    ),
                    (
                        1,
                        Partition {
                            partition: 1,
                            desired: true,
                            app_offset: -1001,
                            next_offset: -1001,
                            hi_offset: -1001,
                            ..Default::default()
                        },
                    ),
                    (
                        2,
                        Partition {
                            partition: 2,
                            desired: true,
                            app_offset: 100,
                            hi_offset: 50,
                            ..Default::default()
                        },
                    ),
                ]
                .into(),
                ..Default::default()
            },
        )]
        .into(),
        ..Default::default()
    };
    let result = backlog(&stats).expect("topic present");
    assert_eq!(result.known_partitions, 0);
    assert_eq!(result.unknown_partitions, 2);
    assert!(backlog(&Statistics::default()).is_none());
}

#[test]
fn broker_connectivity_is_reported_without_bootstrap_or_disconnected_brokers() {
    let stats = Statistics {
        topics: [(TOPIC.to_owned(), Topic::default())].into(),
        brokers: [
            (
                "leader".to_owned(),
                Broker {
                    nodeid: 1,
                    state: "UP".into(),
                    ..Default::default()
                },
            ),
            (
                "down".to_owned(),
                Broker {
                    nodeid: 2,
                    state: "DOWN".into(),
                    ..Default::default()
                },
            ),
            (
                "bootstrap".to_owned(),
                Broker {
                    nodeid: -1,
                    state: "UP".into(),
                    ..Default::default()
                },
            ),
        ]
        .into(),
        ..Default::default()
    };
    assert_eq!(backlog(&stats).expect("topic present").connected_brokers, 1);
}

#[tokio::test(start_paused = true)]
async fn a_connected_broker_does_not_mask_another_partitions_stale_watermark() {
    let stats = Statistics {
        topics: [(
            TOPIC.to_owned(),
            Topic {
                partitions: [
                    (
                        0,
                        Partition {
                            partition: 0,
                            desired: true,
                            broker: 1,
                            app_offset: 10,
                            hi_offset: 10,
                            ..Default::default()
                        },
                    ),
                    (
                        1,
                        Partition {
                            partition: 1,
                            desired: true,
                            broker: 2,
                            app_offset: 10,
                            hi_offset: 10,
                            ..Default::default()
                        },
                    ),
                ]
                .into(),
                ..Default::default()
            },
        )]
        .into(),
        brokers: [
            (
                "up".to_owned(),
                Broker {
                    nodeid: 1,
                    state: "UP".into(),
                    ..Default::default()
                },
            ),
            (
                "down".to_owned(),
                Broker {
                    nodeid: 2,
                    state: "DOWN".into(),
                    ..Default::default()
                },
            ),
        ]
        .into(),
        ..Default::default()
    };
    let snapshot = backlog(&stats).expect("topic present");
    assert_eq!(snapshot.max_offset_backlog, 0);
    assert_eq!(snapshot.disconnected_partitions, 1);
    let started_at = Instant::now();
    tokio::time::advance(STALE_AFTER).await;
    let now = Instant::now();
    let observation = Observation {
        received_at: now,
        sampled_at: 130,
        backlog: Some(snapshot),
    };
    assert_eq!(
        health(Some(observation), started_at, now, 130),
        Health::Disconnected
    );
}

#[tokio::test(start_paused = true)]
async fn reports_stalls_and_old_queued_callbacks_instead_of_stale_zero_lag() {
    let start = Instant::now();
    assert_eq!(health(None, start, start, 100), Health::Starting);
    let observation = Observation {
        received_at: start,
        sampled_at: 100,
        backlog: Some(Backlog {
            connected_brokers: 1,
            known_partitions: 1,
            ..Default::default()
        }),
    };
    assert_eq!(
        health(Some(observation), start, start, 100),
        Health::Healthy
    );
    tokio::time::advance(STALE_AFTER).await;
    let now = Instant::now();
    assert_eq!(health(None, start, now, 130), Health::Unavailable);
    assert_eq!(health(Some(observation), start, now, 130), Health::Stale);
    assert_eq!(
        health(
            Some(Observation {
                received_at: now,
                ..observation
            }),
            start,
            now,
            130
        ),
        Health::Stale
    );
    assert_eq!(
        health(
            Some(Observation {
                received_at: now,
                sampled_at: 130,
                ..observation
            }),
            start,
            now,
            130
        ),
        Health::Healthy
    );
}

#[tokio::test(start_paused = true)]
async fn fresh_callbacks_with_missing_offsets_or_brokers_are_not_healthy() {
    let start = Instant::now();
    tokio::time::advance(STALE_AFTER).await;
    let now = Instant::now();
    let observation = Observation {
        received_at: now,
        sampled_at: 130,
        backlog: None,
    };
    assert_eq!(
        health(Some(observation), start, now, 130),
        Health::Unavailable
    );
    let disconnected = Observation {
        backlog: Some(Backlog::default()),
        ..observation
    };
    assert_eq!(
        health(Some(disconnected), start, now, 130),
        Health::Disconnected
    );
    let unknown = Observation {
        backlog: Some(Backlog {
            connected_brokers: 1,
            unknown_partitions: 1,
            ..Default::default()
        }),
        ..observation
    };
    assert_eq!(health(Some(unknown), start, now, 130), Health::Unavailable);
}
