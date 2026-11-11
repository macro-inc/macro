use super::*;
use agent_fold::domain::model::{ActivityRow, ActivityStatus, Segment};
use tokio::sync::mpsc;
use tokio::time::Instant;

fn digest(total_steps: usize) -> ActivityDigest {
    ActivityDigest {
        total_steps,
        steps: vec![ActivityStep {
            label: "Ran".into(),
            detail: Some(format!("step {total_steps}")),
        }],
    }
}

#[test]
fn digest_keeps_the_newest_activity_rows_across_segments() {
    let row = |id: usize| ActivityRow {
        id: format!("call_{id}"),
        label: "Read".into(),
        detail: Some(format!("src/file_{id}.rs")),
        status: ActivityStatus::Completed,
        card: None,
    };
    let segments = vec![
        ProjectedSegment {
            segment: Segment {
                index: 0,
                kind: SegmentKind::Activity,
                start: 0,
                end: 8,
                sealed: true,
                rows: (0..8).map(row).collect(),
            },
            text: None,
        },
        ProjectedSegment {
            segment: Segment {
                index: 1,
                kind: SegmentKind::Prose,
                start: 8,
                end: 9,
                sealed: true,
                rows: vec![],
            },
            text: Some("Looking at the rest.".into()),
        },
        ProjectedSegment {
            segment: Segment {
                index: 2,
                kind: SegmentKind::Activity,
                start: 9,
                end: 15,
                sealed: false,
                rows: (8..14).map(row).collect(),
            },
            text: None,
        },
    ];

    let digest = ActivityDigest::from_segments(&segments).unwrap();

    assert_eq!(digest.total_steps, 14);
    assert_eq!(digest.steps.len(), 10);
    assert_eq!(
        digest.steps.first(),
        Some(&ActivityStep {
            label: "Read".into(),
            detail: Some("src/file_4.rs".into()),
        })
    );
    assert_eq!(
        digest.steps.last(),
        Some(&ActivityStep {
            label: "Read".into(),
            detail: Some("src/file_13.rs".into()),
        })
    );
}

#[test]
fn digest_is_absent_before_the_first_step() {
    let segments = vec![ProjectedSegment {
        segment: Segment {
            index: 0,
            kind: SegmentKind::Prose,
            start: 0,
            end: 1,
            sealed: false,
            rows: vec![],
        },
        text: None,
    }];

    assert_eq!(ActivityDigest::from_segments(&segments), None);
}

#[tokio::test(start_paused = true)]
async fn a_burst_of_calls_coalesces_into_one_summary_after_the_rest() {
    let (digests, receiver) = watch::channel(Some(digest(1)));
    let ended = CancellationToken::new();
    let (calls, mut called) = mpsc::unbounded_channel();
    let start = Instant::now();
    let task = tokio::spawn(summarize_turn(
        receiver,
        ended.clone(),
        move |digest, previous| {
            calls
                .send((digest.total_steps, previous, start.elapsed()))
                .unwrap();
            async move { Some(format!("Ran {} steps…", digest.total_steps)) }
        },
    ));

    assert_eq!(called.recv().await, Some((1, None, Duration::ZERO)));

    for total in 2..=50 {
        digests.send_replace(Some(digest(total)));
    }
    assert_eq!(
        called.recv().await,
        Some((50, Some("Ran 1 steps…".into()), Duration::from_secs(4)))
    );

    ended.cancel();
    assert!(task.await.unwrap());
    assert_eq!(called.recv().await, None);
}

#[tokio::test(start_paused = true)]
async fn a_digest_with_no_new_steps_is_not_summarized() {
    let (digests, receiver) = watch::channel(Some(digest(3)));
    let ended = CancellationToken::new();
    let (calls, mut called) = mpsc::unbounded_channel();
    let task = tokio::spawn(summarize_turn(receiver, ended.clone(), move |digest, _| {
        calls.send(digest.total_steps).unwrap();
        async { Some("Reading files…".to_owned()) }
    }));
    assert_eq!(called.recv().await, Some(3));

    digests.send_replace(Some(digest(3)));
    tokio::time::advance(Duration::from_secs(60)).await;
    ended.cancel();
    task.await.unwrap();

    assert_eq!(called.recv().await, None);
}

#[tokio::test(start_paused = true)]
async fn summaries_slow_down_after_ten_and_stop_at_the_turn_cap() {
    let (digests, receiver) = watch::channel(Some(digest(1)));
    let (calls, mut called) = mpsc::unbounded_channel();
    let start = Instant::now();
    let task = tokio::spawn(summarize_turn(
        receiver,
        CancellationToken::new(),
        move |digest, _| {
            calls.send((digest.total_steps, start.elapsed())).unwrap();
            async { Some("Searching your workspace…".to_owned()) }
        },
    ));

    let mut times = Vec::new();
    while let Some((total, at)) = called.recv().await {
        times.push(at);
        digests.send_replace(Some(digest(total + 1)));
    }
    task.await.unwrap();

    assert_eq!(times.len(), 120);
    let rests: Vec<Duration> = times.windows(2).map(|pair| pair[1] - pair[0]).collect();
    assert_eq!(rests[..9], [Duration::from_secs(4); 9]);
    assert_eq!(rests[9..], [Duration::from_secs(15); 110]);
}

#[tokio::test(start_paused = true)]
async fn a_turn_that_ends_mid_summary_stops_waiting_for_the_model() {
    let (_digests, receiver) = watch::channel(Some(digest(1)));
    let ended = CancellationToken::new();
    let (started, mut summarizing) = mpsc::unbounded_channel();
    let task = tokio::spawn(summarize_turn(receiver, ended.clone(), move |_, _| {
        started.send(()).unwrap();
        std::future::pending::<Option<String>>()
    }));
    assert_eq!(summarizing.recv().await, Some(()));

    ended.cancel();

    assert!(!task.await.unwrap());
}
