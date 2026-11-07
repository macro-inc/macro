use super::*;
use std::{collections::VecDeque, sync::Mutex};

#[derive(Default)]
struct FakeRepository {
    responses: Mutex<VecDeque<RetentionBatch>>,
    calls: Mutex<Vec<(NaiveDateTime, u16)>>,
    delay: Duration,
}

fn now() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-10-15T12:00:00Z")
        .unwrap()
        .with_timezone(&Utc)
}

impl NotificationRetentionRepository for &FakeRepository {
    async fn current_time(&self) -> Result<DateTime<Utc>, Report> {
        Ok(now())
    }

    async fn preview(
        &self,
        cutoff: NaiveDateTime,
        limit: NonZeroU16,
    ) -> Result<RetentionPreview, Report> {
        assert_eq!(cutoff, (now() - RETENTION).naive_utc());
        assert_eq!(limit, BATCH_SIZE);
        Ok(RetentionPreview {
            sampled_expired: 100,
            oldest_expired_at: Some(cutoff - TimeDelta::days(1)),
        })
    }

    async fn delete_batch(
        &self,
        cutoff: NaiveDateTime,
        limit: NonZeroU16,
    ) -> Result<RetentionBatch, Report> {
        self.calls.lock().unwrap().push((cutoff, limit.get()));
        tokio::time::sleep(self.delay).await;
        Ok(self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(RetentionBatch::Deleted(u64::from(limit.get()))))
    }
}

#[tokio::test(start_paused = true)]
async fn dry_run_never_deletes() {
    let repo = FakeRepository::default();
    let report = NotificationRetentionService::new(&repo)
        .run(RetentionMode::DryRun, MAX_RUN_TIME)
        .await
        .unwrap();
    assert_eq!(report.stopped, RetentionStop::DryRun);
    assert_eq!(report.deleted, 0);
    assert_eq!(report.preview.sampled_expired, 100);
    assert!(repo.calls.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn batches_share_cutoff_and_pause_between_commits() {
    let repo = FakeRepository {
        responses: Mutex::new(VecDeque::from([
            RetentionBatch::Deleted(100),
            RetentionBatch::Deleted(3),
            RetentionBatch::Deleted(0),
        ])),
        ..Default::default()
    };
    let start = Instant::now();
    let report = NotificationRetentionService::new(&repo)
        .run(RetentionMode::Delete, MAX_RUN_TIME)
        .await
        .unwrap();
    assert_eq!(report.deleted, 103);
    assert_eq!(report.batches, 3);
    assert_eq!(report.stopped, RetentionStop::NoCandidates);
    assert!(start.elapsed() >= BATCH_PAUSE * 2);
    assert!(repo.calls.lock().unwrap().iter().all(|(cutoff, limit)| {
        *cutoff == (now() - RETENTION).naive_utc() && *limit == BATCH_SIZE.get()
    }));
}

#[tokio::test(start_paused = true)]
async fn busy_worker_stops_without_retrying() {
    let repo = FakeRepository {
        responses: Mutex::new(VecDeque::from([RetentionBatch::Busy])),
        ..Default::default()
    };
    let report = NotificationRetentionService::new(&repo)
        .run(RetentionMode::Delete, MAX_RUN_TIME)
        .await
        .unwrap();
    assert_eq!(report.stopped, RetentionStop::Busy);
    assert_eq!(report.batches, 1);
    assert_eq!(report.deleted, 0);
}

#[tokio::test(start_paused = true)]
async fn invocation_has_a_hard_batch_cap() {
    let repo = FakeRepository::default();
    let report = NotificationRetentionService::new(&repo)
        .run(RetentionMode::Delete, MAX_RUN_TIME)
        .await
        .unwrap();
    assert_eq!(report.stopped, RetentionStop::BatchLimit);
    assert_eq!(report.batches, MAX_BATCHES);
    assert_eq!(report.deleted, u64::from(MAX_BATCHES) * 100);
}

#[tokio::test(start_paused = true)]
async fn respects_caller_deadline_and_leaves_batch_headroom() {
    let repo = FakeRepository::default();
    let service = NotificationRetentionService::new(&repo);
    let report = service
        .run(RetentionMode::Delete, BATCH_HEADROOM)
        .await
        .unwrap();
    assert_eq!(report.stopped, RetentionStop::TimeBudget);
    assert!(repo.calls.lock().unwrap().is_empty());

    let report = service
        .run(RetentionMode::Delete, BATCH_HEADROOM + BATCH_PAUSE)
        .await
        .unwrap();
    assert_eq!(report.stopped, RetentionStop::TimeBudget);
    assert_eq!(report.batches, 1);
}

#[tokio::test(start_paused = true)]
async fn oversized_time_budget_is_capped() {
    let repo = FakeRepository {
        delay: Duration::from_secs(10),
        ..Default::default()
    };
    let report = NotificationRetentionService::new(&repo)
        .run(RetentionMode::Delete, Duration::from_secs(3600))
        .await
        .unwrap();
    assert_eq!(report.stopped, RetentionStop::TimeBudget);
    assert!(report.batches < 10);
}

#[tokio::test(start_paused = true)]
async fn timeouts_reduce_batch_size_without_counting_rolled_back_deletes() {
    let repo = FakeRepository {
        responses: Mutex::new(VecDeque::from([
            RetentionBatch::TimedOut,
            RetentionBatch::Deleted(50),
            RetentionBatch::Deleted(0),
        ])),
        ..Default::default()
    };
    let report = NotificationRetentionService::new(&repo)
        .run(RetentionMode::Delete, MAX_RUN_TIME)
        .await
        .unwrap();
    assert_eq!(report.deleted, 50);
    assert_eq!(report.batches, 3);
    let sizes: Vec<_> = repo.calls.lock().unwrap().iter().map(|x| x.1).collect();
    assert_eq!(sizes, [100, 50, 50]);
}

#[tokio::test(start_paused = true)]
async fn single_parent_timeout_fails_instead_of_looping_forever() {
    let repo = FakeRepository {
        responses: Mutex::new(VecDeque::from(vec![RetentionBatch::TimedOut; 7])),
        ..Default::default()
    };
    assert!(
        NotificationRetentionService::new(&repo)
            .run(RetentionMode::Delete, MAX_RUN_TIME)
            .await
            .is_err()
    );
    let sizes: Vec<_> = repo.calls.lock().unwrap().iter().map(|x| x.1).collect();
    assert_eq!(sizes, [100, 50, 25, 12, 6, 3, 1]);
}
