use super::*;

mod connection;
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_email::service::link::UserProvider;
use std::sync::{Arc, Mutex};

const INBOX: Uuid = Uuid::from_u128(1);
const OTHER: Uuid = Uuid::from_u128(2);
const THIRD: Uuid = Uuid::from_u128(3);
const JOB: Uuid = Uuid::from_u128(10);
const NEXT_JOB: Uuid = Uuid::from_u128(1000);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Step {
    Job,
    Scoped,
    List,
    Active,
    Inbox,
    Insert,
    Status,
    Fail,
    Queue,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Call {
    History(Uuid),
    Connected(Uuid),
    Job(Uuid),
    Scoped(Uuid, Uuid),
    List(String),
    Active(Uuid),
    Inbox(Uuid),
    Insert(Uuid, String, Option<i32>, bool),
    Status(Uuid, BackfillJobStatus),
    Fail(Uuid),
    Queue(Uuid, Uuid),
}

#[derive(Debug, thiserror::Error)]
#[error("fake operation failure")]
struct FakeError;

#[derive(Default)]
struct Data {
    inboxes: Vec<Link>,
    jobs: Vec<BackfillJob>,
    calls: Vec<Call>,
    failures: Vec<(Step, Option<Uuid>)>,
    force_conflict: bool,
    fail_active_on_call: Option<usize>,
    complete_before_queue_failure: bool,
}

impl Data {
    fn record(&mut self, step: Step, target: Uuid, call: Call) -> Result<(), FakeError> {
        self.calls.push(call);
        if self
            .failures
            .iter()
            .any(|(failure, id)| *failure == step && id.is_none_or(|id| id == target))
        {
            return Err(FakeError);
        }
        Ok(())
    }
}

#[derive(Clone)]
struct Fake(Arc<Mutex<Data>>);

impl BackfillJobRepository for Fake {
    type Err = FakeError;

    async fn job(&self, id: Uuid) -> Result<Option<BackfillJob>, FakeError> {
        let mut data = self.0.lock().unwrap();
        data.record(Step::Job, id, Call::Job(id))?;
        Ok(data.jobs.iter().find(|job| job.id == id).cloned())
    }

    async fn job_in_inbox(&self, id: Uuid, link: Uuid) -> Result<Option<BackfillJob>, FakeError> {
        let mut data = self.0.lock().unwrap();
        data.record(Step::Scoped, id, Call::Scoped(id, link))?;
        Ok(data
            .jobs
            .iter()
            .find(|job| job.id == id && job.link_id == Some(link))
            .cloned())
    }

    async fn jobs_for_user(&self, fusion_id: &str) -> Result<Vec<BackfillJob>, FakeError> {
        let mut data = self.0.lock().unwrap();
        data.record(Step::List, Uuid::nil(), Call::List(fusion_id.into()))?;
        Ok(data
            .jobs
            .iter()
            .filter(|job| job.fusionauth_user_id == fusion_id)
            .cloned()
            .collect())
    }

    async fn active_job(&self, link: Uuid) -> Result<Option<BackfillJob>, FakeError> {
        let mut data = self.0.lock().unwrap();
        data.record(Step::Active, link, Call::Active(link))?;
        let active_calls = data
            .calls
            .iter()
            .filter(|call| matches!(call, Call::Active(_)))
            .count();
        if data.fail_active_on_call == Some(active_calls) {
            return Err(FakeError);
        }
        Ok(data
            .jobs
            .iter()
            .find(|job| job.link_id == Some(link))
            .cloned())
    }

    async fn inbox(&self, link: Uuid) -> Result<Option<Link>, FakeError> {
        let mut data = self.0.lock().unwrap();
        data.record(Step::Inbox, link, Call::Inbox(link))?;
        Ok(data.inboxes.iter().find(|inbox| inbox.id == link).cloned())
    }

    async fn insert(
        &self,
        link: Uuid,
        fusion_id: &str,
        thread_limit: Option<i32>,
        recovery: bool,
    ) -> Result<Option<BackfillJob>, FakeError> {
        let mut data = self.0.lock().unwrap();
        data.record(
            Step::Insert,
            link,
            Call::Insert(link, fusion_id.into(), thread_limit, recovery),
        )?;
        if data.force_conflict
            || data.jobs.iter().any(|job| {
                job.link_id == Some(link)
                    && matches!(
                        job.status,
                        BackfillJobStatus::Init | BackfillJobStatus::InProgress
                    )
            })
        {
            return Ok(None);
        }
        let mut created = job(
            Uuid::from_u128(1000 + data.jobs.len() as u128),
            Some(link),
            BackfillJobStatus::Init,
            fusion_id,
        );
        created.threads_requested_limit = thread_limit;
        data.jobs.push(created.clone());
        Ok(Some(created))
    }

    async fn set_status(&self, id: Uuid, status: BackfillJobStatus) -> Result<(), FakeError> {
        let mut data = self.0.lock().unwrap();
        data.record(Step::Status, id, Call::Status(id, status))?;
        let job = data
            .jobs
            .iter_mut()
            .find(|job| job.id == id)
            .ok_or(FakeError)?;
        job.status = status;
        Ok(())
    }

    async fn fail_active(&self, id: Uuid) -> Result<bool, FakeError> {
        let mut data = self.0.lock().unwrap();
        data.record(Step::Fail, id, Call::Fail(id))?;
        let Some(job) = data.jobs.iter_mut().find(|job| {
            job.id == id
                && matches!(
                    job.status,
                    BackfillJobStatus::Init | BackfillJobStatus::InProgress
                )
        }) else {
            return Ok(false);
        };
        job.status = BackfillJobStatus::Failed;
        Ok(true)
    }
}

impl BackfillJobQueue for Fake {
    type Err = FakeError;

    async fn enqueue_initialization(&self, link: Uuid, id: Uuid) -> Result<(), FakeError> {
        let mut data = self.0.lock().unwrap();
        if data.complete_before_queue_failure {
            data.jobs
                .iter_mut()
                .find(|job| job.id == id)
                .unwrap()
                .status = BackfillJobStatus::Complete;
        }
        data.record(Step::Queue, link, Call::Queue(link, id))
    }
}

fn service(data: Data) -> (BackfillJobService<Fake, Fake>, Arc<Mutex<Data>>) {
    let data = Arc::new(Mutex::new(data));
    (
        BackfillJobService {
            repository: Fake(data.clone()),
            queue: Fake(data.clone()),
        },
        data,
    )
}

fn job(id: Uuid, link_id: Option<Uuid>, status: BackfillJobStatus, fusion_id: &str) -> BackfillJob {
    BackfillJob {
        id,
        link_id,
        fusionauth_user_id: fusion_id.into(),
        threads_requested_limit: None,
        total_threads: 0,
        status,
        threads_retrieved_count: 0,
        created_at: chrono::DateTime::UNIX_EPOCH,
        updated_at: chrono::DateTime::UNIX_EPOCH,
    }
}

fn inbox(id: Uuid, active: bool, provider: UserProvider) -> Link {
    Link {
        id,
        macro_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
        fusionauth_user_id: "fusion-owner".into(),
        email_address: EmailStr::try_from("inbox@example.com".to_string()).unwrap(),
        provider,
        is_sync_active: active,
        is_primary: false,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: chrono::DateTime::UNIX_EPOCH,
        updated_at: chrono::DateTime::UNIX_EPOCH,
    }
}

#[tokio::test]
async fn listing_uses_fusion_identity_and_includes_deleted_inboxes_without_a_link_lookup() {
    let (svc, data) = service(Data {
        jobs: vec![
            job(JOB, None, BackfillJobStatus::Complete, "caller"),
            job(NEXT_JOB, Some(INBOX), BackfillJobStatus::Init, "caller"),
            job(
                Uuid::from_u128(11),
                Some(OTHER),
                BackfillJobStatus::Init,
                "someone-else",
            ),
        ],
        ..Default::default()
    });
    let jobs = svc.list("caller").await.unwrap();
    assert_eq!(
        jobs.iter().map(|job| job.id).collect::<Vec<_>>(),
        vec![JOB, NEXT_JOB]
    );
    assert_eq!(
        data.lock().unwrap().calls,
        vec![Call::List("caller".into())]
    );
}

#[tokio::test]
async fn listing_an_unknown_identity_is_empty_and_query_failures_are_retained() {
    let (svc, _) = service(Data::default());
    assert!(svc.list("unknown").await.unwrap().is_empty());
    let (svc, _) = service(Data {
        failures: vec![(Step::List, None)],
        ..Default::default()
    });
    assert!(matches!(svc.list("caller").await, Err(FakeError)));
}

#[tokio::test]
async fn public_reads_are_scoped_to_the_selected_inbox_and_internal_reads_are_unscoped() {
    for (access, allowed, call) in [
        (
            BackfillJobAccess::Inbox(INBOX),
            true,
            Call::Scoped(JOB, INBOX),
        ),
        (
            BackfillJobAccess::Inbox(OTHER),
            false,
            Call::Scoped(JOB, OTHER),
        ),
        (BackfillJobAccess::Internal, true, Call::Job(JOB)),
    ] {
        let (svc, data) = service(Data {
            jobs: vec![job(JOB, Some(INBOX), BackfillJobStatus::Init, "owner")],
            ..Default::default()
        });
        let result = svc.get(JOB, access).await;
        if allowed {
            assert_eq!(result.unwrap().id, JOB);
        } else {
            assert!(matches!(result, Err(BackfillLookupError::NotFound)));
        }
        assert_eq!(data.lock().unwrap().calls, vec![call]);
    }
}

#[tokio::test]
async fn deleted_inbox_jobs_are_available_only_to_internal_reads() {
    let (svc, _) = service(Data {
        jobs: vec![job(JOB, None, BackfillJobStatus::Complete, "owner")],
        ..Default::default()
    });
    assert!(matches!(
        svc.get(JOB, BackfillJobAccess::Inbox(INBOX)).await,
        Err(BackfillLookupError::NotFound)
    ));
    assert_eq!(
        svc.get(JOB, BackfillJobAccess::Internal).await.unwrap().id,
        JOB
    );
}

#[tokio::test]
async fn missing_jobs_and_lookup_failures_stay_distinct_in_both_scopes() {
    for (access, step) in [
        (BackfillJobAccess::Inbox(INBOX), Step::Scoped),
        (BackfillJobAccess::Internal, Step::Job),
    ] {
        let (svc, _) = service(Data::default());
        assert!(matches!(
            svc.get(JOB, access).await,
            Err(BackfillLookupError::NotFound)
        ));
        let (svc, _) = service(Data {
            failures: vec![(step, None)],
            ..Default::default()
        });
        assert!(matches!(
            svc.get(JOB, access).await,
            Err(BackfillLookupError::Query(FakeError))
        ));
    }
}

#[tokio::test]
async fn active_reads_use_the_selected_inbox_and_report_absence_for_terminal_jobs() {
    for status in [
        BackfillJobStatus::Init,
        BackfillJobStatus::InProgress,
        BackfillJobStatus::Complete,
        BackfillJobStatus::Cancelled,
        BackfillJobStatus::Failed,
    ] {
        let (svc, data) = service(Data {
            jobs: vec![job(JOB, Some(INBOX), status, "owner")],
            ..Default::default()
        });
        assert_eq!(
            svc.active(INBOX).await.unwrap().is_some(),
            matches!(
                status,
                BackfillJobStatus::Init | BackfillJobStatus::InProgress
            )
        );
        assert!(svc.active(OTHER).await.unwrap().is_none());
        assert_eq!(
            data.lock().unwrap().calls,
            vec![Call::Active(INBOX), Call::Active(OTHER)]
        );
    }
    let (svc, _) = service(Data {
        failures: vec![(Step::Active, None)],
        ..Default::default()
    });
    assert!(matches!(svc.active(INBOX).await, Err(FakeError)));
}

#[tokio::test]
async fn cancellation_accepts_only_init_and_in_progress_in_both_access_scopes() {
    for access in [BackfillJobAccess::Inbox(INBOX), BackfillJobAccess::Internal] {
        for status in [
            BackfillJobStatus::Init,
            BackfillJobStatus::InProgress,
            BackfillJobStatus::Cancelled,
            BackfillJobStatus::Complete,
            BackfillJobStatus::Failed,
        ] {
            let (svc, data) = service(Data {
                jobs: vec![job(JOB, Some(INBOX), status, "owner")],
                ..Default::default()
            });
            let result = svc.cancel(JOB, access).await;
            match status {
                BackfillJobStatus::Init | BackfillJobStatus::InProgress => assert!(result.is_ok()),
                BackfillJobStatus::Cancelled => {
                    assert!(matches!(result, Err(BackfillCancelError::AlreadyCancelled)))
                }
                BackfillJobStatus::Complete => {
                    assert!(matches!(result, Err(BackfillCancelError::AlreadyComplete)))
                }
                BackfillJobStatus::Failed => {
                    assert!(matches!(result, Err(BackfillCancelError::AlreadyFailed)))
                }
            }
            let data = data.lock().unwrap();
            if matches!(
                status,
                BackfillJobStatus::Init | BackfillJobStatus::InProgress
            ) {
                assert_eq!(data.jobs[0].status, BackfillJobStatus::Cancelled);
                assert_eq!(
                    data.calls.last(),
                    Some(&Call::Status(JOB, BackfillJobStatus::Cancelled))
                );
            } else {
                assert_eq!(data.jobs[0].status, status);
                assert_eq!(data.calls.len(), 1);
            }
        }
    }
}

#[tokio::test]
async fn cancellation_rejects_jobs_from_another_inbox_and_retains_update_failures() {
    let (svc, data) = service(Data {
        jobs: vec![job(JOB, Some(OTHER), BackfillJobStatus::Init, "owner")],
        ..Default::default()
    });
    assert!(matches!(
        svc.cancel(JOB, BackfillJobAccess::Inbox(INBOX)).await,
        Err(BackfillCancelError::Lookup(BackfillLookupError::NotFound))
    ));
    assert_eq!(data.lock().unwrap().calls, vec![Call::Scoped(JOB, INBOX)]);
    for access in [BackfillJobAccess::Inbox(OTHER), BackfillJobAccess::Internal] {
        data.lock().unwrap().failures = vec![(Step::Status, None)];
        assert!(matches!(
            svc.cancel(JOB, access).await,
            Err(BackfillCancelError::Update(FakeError))
        ));
        assert_eq!(data.lock().unwrap().jobs[0].status, BackfillJobStatus::Init);
    }
}

#[tokio::test]
async fn cancellation_stops_after_missing_or_failed_lookup() {
    for (access, step) in [
        (BackfillJobAccess::Inbox(INBOX), Step::Scoped),
        (BackfillJobAccess::Internal, Step::Job),
    ] {
        let (svc, data) = service(Data::default());
        assert!(matches!(
            svc.cancel(JOB, access).await,
            Err(BackfillCancelError::Lookup(BackfillLookupError::NotFound))
        ));
        assert_eq!(data.lock().unwrap().calls.len(), 1);
        data.lock().unwrap().failures = vec![(step, None)];
        assert!(matches!(
            svc.cancel(JOB, access).await,
            Err(BackfillCancelError::Lookup(BackfillLookupError::Query(
                FakeError
            )))
        ));
        assert_eq!(data.lock().unwrap().calls.len(), 2);
    }
}

#[tokio::test]
async fn creating_no_jobs_has_no_effects() {
    let (svc, data) = service(Data::default());
    assert!(svc.create(Vec::new(), None).await.unwrap().is_empty());
    assert!(data.lock().unwrap().calls.is_empty());
}

#[tokio::test]
async fn creation_preserves_every_thread_limit_and_accepts_both_providers() {
    for provider in [UserProvider::Gmail, UserProvider::Outlook] {
        for limit in [None, Some(-5), Some(0), Some(10)] {
            let (svc, data) = service(Data {
                inboxes: vec![inbox(INBOX, true, provider)],
                ..Default::default()
            });
            assert_eq!(
                svc.create(vec![INBOX], limit).await.unwrap(),
                vec![(INBOX, NEXT_JOB)]
            );
            let data = data.lock().unwrap();
            assert_eq!(data.jobs[0].threads_requested_limit, limit);
            assert_eq!(
                data.calls,
                vec![
                    Call::Inbox(INBOX),
                    Call::Insert(INBOX, "fusion-owner".into(), limit, false),
                    Call::Queue(INBOX, NEXT_JOB)
                ]
            );
        }
    }
}

#[tokio::test]
async fn active_conflicts_reuse_jobs_without_republishing_or_changing_their_limit() {
    for status in [BackfillJobStatus::Init, BackfillJobStatus::InProgress] {
        let (svc, data) = service(Data {
            inboxes: vec![inbox(INBOX, true, UserProvider::Gmail)],
            jobs: vec![job(JOB, Some(INBOX), status, "owner")],
            ..Default::default()
        });
        assert_eq!(
            svc.create(vec![INBOX], Some(-3)).await.unwrap(),
            vec![(INBOX, JOB)]
        );
        let data = data.lock().unwrap();
        assert_eq!(data.jobs[0].threads_requested_limit, None);
        assert_eq!(
            data.calls,
            vec![
                Call::Inbox(INBOX),
                Call::Insert(INBOX, "fusion-owner".into(), Some(-3), false),
                Call::Active(INBOX)
            ]
        );
    }
}

#[tokio::test]
async fn terminal_jobs_do_not_prevent_a_new_initialization() {
    for status in [
        BackfillJobStatus::Complete,
        BackfillJobStatus::Cancelled,
        BackfillJobStatus::Failed,
    ] {
        let (svc, data) = service(Data {
            inboxes: vec![inbox(INBOX, true, UserProvider::Gmail)],
            jobs: vec![job(JOB, Some(INBOX), status, "owner")],
            ..Default::default()
        });
        assert_eq!(
            svc.create(vec![INBOX], None).await.unwrap(),
            vec![(INBOX, Uuid::from_u128(1001))]
        );
        assert_eq!(data.lock().unwrap().jobs.len(), 2);
    }
}

#[tokio::test]
async fn duplicate_links_preserve_response_order_and_publish_only_once() {
    let (svc, data) = service(Data {
        inboxes: vec![inbox(INBOX, true, UserProvider::Gmail)],
        ..Default::default()
    });
    assert_eq!(
        svc.create(vec![INBOX, INBOX], None).await.unwrap(),
        vec![(INBOX, NEXT_JOB), (INBOX, NEXT_JOB)]
    );
    assert_eq!(
        data.lock().unwrap().calls,
        vec![
            Call::Inbox(INBOX),
            Call::Insert(INBOX, "fusion-owner".into(), None, false),
            Call::Queue(INBOX, NEXT_JOB),
            Call::Inbox(INBOX),
            Call::Insert(INBOX, "fusion-owner".into(), None, false),
            Call::Active(INBOX),
        ]
    );
}

#[tokio::test]
async fn missing_and_disabled_inboxes_stop_before_insertion() {
    let (svc, data) = service(Data::default());
    assert!(matches!(
        svc.create(vec![INBOX], None).await,
        Err(BackfillCreateError::InboxNotFound(INBOX))
    ));
    assert_eq!(data.lock().unwrap().calls, vec![Call::Inbox(INBOX)]);
    let (svc, data) = service(Data {
        inboxes: vec![inbox(INBOX, false, UserProvider::Gmail)],
        ..Default::default()
    });
    assert!(matches!(
        svc.create(vec![INBOX], None).await,
        Err(BackfillCreateError::SyncDisabled(INBOX))
    ));
    assert_eq!(data.lock().unwrap().calls, vec![Call::Inbox(INBOX)]);
}

#[tokio::test]
async fn creation_lookup_and_insert_failures_are_typed_and_stop_publication() {
    for step in [Step::Inbox, Step::Insert] {
        let (svc, data) = service(Data {
            inboxes: vec![inbox(INBOX, true, UserProvider::Gmail)],
            failures: vec![(step, None)],
            ..Default::default()
        });
        let result = svc.create(vec![INBOX], None).await;
        if step == Step::Inbox {
            assert!(matches!(
                result,
                Err(BackfillCreateError::InboxLookup {
                    link_id: INBOX,
                    source: FakeError
                })
            ));
        } else {
            assert!(matches!(
                result,
                Err(BackfillCreateError::Insert {
                    link_id: INBOX,
                    source: FakeError
                })
            ));
        }
        assert!(
            !data
                .lock()
                .unwrap()
                .calls
                .iter()
                .any(|call| matches!(call, Call::Queue(..)))
        );
    }
}

#[tokio::test]
async fn a_conflict_can_fail_to_resolve_or_lose_its_active_job() {
    for fail_lookup in [false, true] {
        let (svc, data) = service(Data {
            inboxes: vec![inbox(INBOX, true, UserProvider::Gmail)],
            force_conflict: true,
            failures: if fail_lookup {
                vec![(Step::Active, None)]
            } else {
                Vec::new()
            },
            ..Default::default()
        });
        let result = svc.create(vec![INBOX], None).await;
        if fail_lookup {
            assert!(matches!(
                result,
                Err(BackfillCreateError::ActiveLookup {
                    link_id: INBOX,
                    source: FakeError
                })
            ));
        } else {
            assert!(matches!(
                result,
                Err(BackfillCreateError::MissingActive(INBOX))
            ));
        }
        assert_eq!(
            data.lock().unwrap().calls.last(),
            Some(&Call::Active(INBOX))
        );
    }
}

#[tokio::test]
async fn queue_failure_marks_only_an_active_job_failed_before_returning() {
    for complete in [false, true] {
        let (svc, data) = service(Data {
            inboxes: vec![inbox(INBOX, true, UserProvider::Gmail)],
            failures: vec![(Step::Queue, None)],
            complete_before_queue_failure: complete,
            ..Default::default()
        });
        assert!(matches!(
            svc.create(vec![INBOX], None).await,
            Err(BackfillCreateError::Queue {
                link_id: INBOX,
                source: FakeError
            })
        ));
        let data = data.lock().unwrap();
        assert_eq!(
            data.jobs[0].status,
            if complete {
                BackfillJobStatus::Complete
            } else {
                BackfillJobStatus::Failed
            }
        );
        assert_eq!(data.calls.last(), Some(&Call::Fail(NEXT_JOB)));
    }
}

#[tokio::test]
async fn cleanup_failure_takes_precedence_over_queue_failure() {
    let (svc, data) = service(Data {
        inboxes: vec![inbox(INBOX, true, UserProvider::Gmail)],
        failures: vec![(Step::Queue, None), (Step::Fail, None)],
        ..Default::default()
    });
    assert!(matches!(
        svc.create(vec![INBOX], None).await,
        Err(BackfillCreateError::Cleanup {
            link_id: INBOX,
            source: FakeError
        })
    ));
    assert_eq!(data.lock().unwrap().jobs[0].status, BackfillJobStatus::Init);
    assert_eq!(
        data.lock().unwrap().calls.last(),
        Some(&Call::Fail(NEXT_JOB))
    );
}

#[tokio::test]
async fn a_later_missing_link_preserves_the_earlier_job_and_queue_send() {
    let (svc, data) = service(Data {
        inboxes: vec![inbox(INBOX, true, UserProvider::Gmail)],
        ..Default::default()
    });
    assert!(matches!(
        svc.create(vec![INBOX, OTHER, THIRD], None).await,
        Err(BackfillCreateError::InboxNotFound(OTHER))
    ));
    let data = data.lock().unwrap();
    assert_eq!(data.jobs.len(), 1);
    assert_eq!(data.jobs[0].status, BackfillJobStatus::Init);
    assert_eq!(
        data.calls,
        vec![
            Call::Inbox(INBOX),
            Call::Insert(INBOX, "fusion-owner".into(), None, false),
            Call::Queue(INBOX, NEXT_JOB),
            Call::Inbox(OTHER)
        ]
    );
}

#[tokio::test]
async fn a_later_queue_failure_keeps_earlier_work_and_stops_subsequent_links() {
    let (svc, data) = service(Data {
        inboxes: vec![
            inbox(INBOX, true, UserProvider::Gmail),
            inbox(OTHER, true, UserProvider::Outlook),
            inbox(THIRD, true, UserProvider::Gmail),
        ],
        failures: vec![(Step::Queue, Some(OTHER))],
        ..Default::default()
    });
    assert!(matches!(
        svc.create(vec![INBOX, OTHER, THIRD], Some(2)).await,
        Err(BackfillCreateError::Queue {
            link_id: OTHER,
            source: FakeError
        })
    ));
    let data = data.lock().unwrap();
    assert_eq!(data.jobs.len(), 2);
    assert_eq!(data.jobs[0].status, BackfillJobStatus::Init);
    assert_eq!(data.jobs[1].status, BackfillJobStatus::Failed);
    assert!(!data.calls.contains(&Call::Inbox(THIRD)));
    assert_eq!(data.calls.last(), Some(&Call::Fail(Uuid::from_u128(1001))));
}
