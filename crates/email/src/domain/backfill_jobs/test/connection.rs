use super::*;
use crate::domain::backfill_jobs::{
    ConnectedInboxEvents, ConnectedInboxHistory, InitialBackfillError,
};

impl ConnectedInboxHistory for Fake {
    async fn record(&self, link: &Link) {
        self.0.lock().unwrap().calls.push(Call::History(link.id));
    }
}
impl ConnectedInboxEvents for Fake {
    fn connected(&self, link: &Link) {
        self.0.lock().unwrap().calls.push(Call::Connected(link.id));
    }
}

#[tokio::test]
async fn initial_connection_reuses_existing_work_without_history_or_publication() {
    let (svc, data) = service(Data {
        jobs: vec![job(
            JOB,
            Some(INBOX),
            BackfillJobStatus::InProgress,
            "fusion-owner",
        )],
        ..Data::default()
    });
    let effects = Fake(data.clone());
    assert_eq!(
        svc.start_connected(&inbox(INBOX, true, UserProvider::Gmail), &effects, &effects)
            .await
            .unwrap(),
        JOB
    );
    assert_eq!(data.lock().unwrap().calls, [Call::Active(INBOX)]);
}

#[tokio::test]
async fn initial_connection_orders_insert_history_event_and_queue_without_an_extra_inbox_read() {
    let (svc, data) = service(Data::default());
    let effects = Fake(data.clone());
    assert_eq!(
        svc.start_connected(&inbox(INBOX, true, UserProvider::Gmail), &effects, &effects)
            .await
            .unwrap(),
        NEXT_JOB
    );
    assert_eq!(
        data.lock().unwrap().calls,
        [
            Call::Active(INBOX),
            Call::Insert(INBOX, "fusion-owner".into(), None, false),
            Call::History(INBOX),
            Call::Connected(INBOX),
            Call::Queue(INBOX, NEXT_JOB),
        ]
    );
}

#[tokio::test]
async fn initial_connection_publication_failure_keeps_history_and_event_but_fails_the_job() {
    let (svc, data) = service(Data {
        failures: vec![(Step::Queue, None)],
        ..Data::default()
    });
    let effects = Fake(data.clone());
    assert!(matches!(
        svc.start_connected(&inbox(INBOX, true, UserProvider::Gmail), &effects, &effects)
            .await,
        Err(InitialBackfillError::Enqueue)
    ));
    let data = data.lock().unwrap();
    assert_eq!(
        data.calls,
        [
            Call::Active(INBOX),
            Call::Insert(INBOX, "fusion-owner".into(), None, false),
            Call::History(INBOX),
            Call::Connected(INBOX),
            Call::Queue(INBOX, NEXT_JOB),
            Call::Fail(NEXT_JOB),
        ]
    );
    assert_eq!(data.jobs[0].status, BackfillJobStatus::Failed);
}

#[tokio::test]
async fn initial_connection_failure_state_write_is_reported_separately() {
    let (svc, data) = service(Data {
        failures: vec![(Step::Queue, None), (Step::Fail, None)],
        ..Data::default()
    });
    let effects = Fake(data.clone());
    assert!(matches!(
        svc.start_connected(&inbox(INBOX, true, UserProvider::Gmail), &effects, &effects)
            .await,
        Err(InitialBackfillError::FailureState(FakeError))
    ));
    assert_eq!(data.lock().unwrap().jobs[0].status, BackfillJobStatus::Init);
}

#[tokio::test]
async fn initial_connection_stops_before_publication_on_lookup_insert_or_conflict_failure() {
    for failure in [Some(Step::Active), Some(Step::Insert), None] {
        let (svc, data) = service(Data {
            failures: failure.into_iter().map(|step| (step, None)).collect(),
            force_conflict: true,
            ..Data::default()
        });
        let effects = Fake(data.clone());
        let result = svc
            .start_connected(&inbox(INBOX, true, UserProvider::Gmail), &effects, &effects)
            .await;
        match failure {
            Some(Step::Active) => assert!(matches!(
                result,
                Err(InitialBackfillError::Active(FakeError))
            )),
            Some(Step::Insert) => assert!(matches!(
                result,
                Err(InitialBackfillError::Insert(FakeError))
            )),
            _ => assert!(matches!(result, Err(InitialBackfillError::MissingActive))),
        }
        assert!(!data.lock().unwrap().calls.contains(&Call::History(INBOX)));
        assert!(!data.lock().unwrap().calls.contains(&Call::Connected(INBOX)));
    }
}
