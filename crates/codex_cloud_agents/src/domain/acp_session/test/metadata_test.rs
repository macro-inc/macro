use super::*;
use crate::domain::cloud::ExternalPullRequest;
use crate::domain::runtime::{CloudRuntime, RuntimeIdentity};

struct Runtime {
    prs: Mutex<Vec<ExternalPullRequest>>,
    reports: Mutex<Vec<String>>,
    failed: AtomicBool,
    foreign: AtomicBool,
    reads: AtomicUsize,
    journal: Journal,
    hold: AtomicBool,
    entered: tokio::sync::Notify,
    release: tokio::sync::Notify,
}
impl CloudRuntime for Runtime {
    async fn identity(&self) -> Result<RuntimeIdentity, rootcause::Report> {
        let account = if self.foreign.load(Ordering::SeqCst) {
            "foreign"
        } else {
            "test-account"
        };
        Ok(RuntimeIdentity {
            account_id: account.into(),
            connection_id: account.into(),
        })
    }
    async fn resolve_target(
        &self,
        _: &str,
        _: Option<&CloudTarget>,
    ) -> Result<CloudTarget, rootcause::Report> {
        panic!("metadata never selects a new target")
    }
    async fn launch(&self, _: &Launch) -> Result<CreatedTask, rootcause::Report> {
        panic!("metadata never creates cloud work")
    }
    async fn follow_up(
        &self,
        _: &CloudId,
        _: &TurnId,
        _: &str,
    ) -> Result<CreatedTask, rootcause::Report> {
        panic!("metadata never continues cloud work")
    }
    async fn cancel(&self, _: &CloudId) -> Result<(), rootcause::Report> {
        panic!("metadata never cancels cloud work")
    }
    async fn turn(&self, _: &CloudId, _: &TurnId) -> Result<TaskSnapshot, rootcause::Report> {
        panic!("metadata uses task details")
    }
    async fn stream(&self, _: &CloudId, _: &TurnId) -> Result<CloudEventStream, rootcause::Report> {
        panic!("metadata never replays SSE")
    }
    async fn snapshot(&self, task: &CloudId) -> Result<TaskSnapshot, rootcause::Report> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        let prs = self.prs.lock().unwrap().clone();
        if self.hold.load(Ordering::SeqCst) {
            self.entered.notify_one();
            self.release.notified().await;
        }
        Ok(TaskSnapshot {
            task_id: task.clone(),
            native: None,
            title: None,
            assistant_status: Some("completed".into()),
            turns: vec![],
            pull_requests: prs,
        })
    }
    async fn report_pull_request(&self, url: &str) -> Result<(), rootcause::Report> {
        // A host must never receive PR metadata before its source evidence is durable.
        let found = self
            .journal
            .1
            .lock()
            .unwrap()
            .values()
            .flatten()
            .any(|entry| serde_json::to_string(&entry.input).unwrap().contains(url));
        assert!(found, "publication precedes native journal evidence");
        self.reports.lock().unwrap().push(url.into());
        if self.failed.load(Ordering::SeqCst) {
            return Err(rootcause::report!("injected PR persistence failure"));
        }
        Ok(())
    }
}
fn pr(turn: &str, repo: &str, number: u32) -> ExternalPullRequest {
    ExternalPullRequest {
        assistant_turn_id: TurnId::new(turn.into()).unwrap(),
        url: format!("https://github.com/{repo}/pull/{number}"),
    }
}
async fn fixture() -> (String, Journal, Arc<Runtime>) {
    let id = uuid::Uuid::now_v7().to_string();
    let journal = Journal::default();
    journal
        .save(
            &id,
            &StoredSession {
                account_id: "test-account".into(),
                connection_id: "test-account".into(),
                target: Some(CloudTarget {
                    environment: CloudId::new("env_test".into()).unwrap(),
                    branch: "main".into(),
                    repository_url: Some("https://github.com/org/repo".into()),
                }),
                task: Some("task_test".into()),
                turn: Some("turn_new".into()),
                uncertain_write: false,
            },
        )
        .await
        .unwrap();
    journal
        .append(&id, 0, None, &JournalInput::HistoryComplete)
        .await
        .unwrap();
    journal
        .append(&id, 1, None, &JournalInput::Prompt(text("original")))
        .await
        .unwrap();
    journal
        .append(
            &id,
            2,
            None,
            &JournalInput::PromptAccepted {
                task: "task_test".into(),
                turn: Some("turn_old".into()),
            },
        )
        .await
        .unwrap();
    journal
        .append(
            &id,
            3,
            None,
            &JournalInput::PromptAccepted {
                task: "task_test".into(),
                turn: Some("turn_new".into()),
            },
        )
        .await
        .unwrap();
    journal
        .append(&id, 4, None, &JournalInput::Terminal("completed".into()))
        .await
        .unwrap();
    let runtime = Arc::new(Runtime {
        prs: Mutex::new(vec![]),
        reports: Mutex::new(vec![]),
        failed: AtomicBool::new(false),
        foreign: AtomicBool::new(false),
        reads: AtomicUsize::new(0),
        journal: journal.clone(),
        hold: AtomicBool::new(false),
        entered: tokio::sync::Notify::new(),
        release: tokio::sync::Notify::new(),
    });
    (id, journal, runtime)
}
#[tokio::test]
async fn delayed_pr_is_published_once_and_replayed_as_an_observed_link() {
    let (id, journal, runtime) = fixture().await;
    let service = SessionService::new(runtime.clone(), journal.clone(), None);
    let before = Sink::default();
    service.replay(&id, &before).await.unwrap();
    service.refresh_metadata().await.unwrap();
    assert!(runtime.reports.lock().unwrap().is_empty());
    assert_eq!(journal.read(&id).await.unwrap().len(), 5);
    *runtime.prs.lock().unwrap() = vec![pr("turn_new", "org/repo", 42)];
    assert_eq!(service.refresh_metadata().await.unwrap(), vec![id.clone()]);
    assert!(service.refresh_metadata().await.unwrap().is_empty());
    runtime.prs.lock().unwrap().clear();
    service.refresh_metadata().await.unwrap();
    assert_eq!(
        *runtime.reports.lock().unwrap(),
        ["https://github.com/org/repo/pull/42"]
    );
    assert_eq!(journal.read(&id).await.unwrap().len(), 6);
    *runtime.prs.lock().unwrap() = vec![pr("turn_new", "org/repo", 43)];
    service.refresh_metadata().await.unwrap();
    assert_eq!(
        runtime.reports.lock().unwrap().last().unwrap(),
        "https://github.com/org/repo/pull/43"
    );
    assert_eq!(journal.read(&id).await.unwrap().len(), 7);
    let after = Sink::default();
    service.replay(&id, &after).await.unwrap();
    let after = after.0.lock().unwrap();
    let links: Vec<_> = after
        .iter()
        .filter(|event| event.method == "adapter/pull_request")
        .collect();
    assert_eq!(links.len(), 1);
    assert_eq!(
        links[0].params["url"],
        "https://github.com/org/repo/pull/43"
    );
    assert_eq!(links[0].params["source"], "codex_cloud_metadata");
    let original: Vec<_> = after
        .iter()
        .filter(|event| event.method != "adapter/pull_request")
        .collect();
    assert_eq!(
        serde_json::to_value(&*before.0.lock().unwrap()).unwrap(),
        serde_json::to_value(original).unwrap()
    );
}
#[tokio::test]
async fn failed_publication_retries_persisted_evidence_even_after_restart_and_empty_snapshot() {
    let (id, journal, runtime) = fixture().await;
    runtime.failed.store(true, Ordering::SeqCst);
    *runtime.prs.lock().unwrap() = vec![pr("turn_new", "org/repo", 42)];
    let service = SessionService::new(runtime.clone(), journal.clone(), None);
    service.session(&id).await.unwrap();
    assert!(service.refresh_metadata().await.is_err());
    assert_eq!(runtime.reports.lock().unwrap().len(), 1);
    assert_eq!(journal.read(&id).await.unwrap().len(), 6);
    drop(service);
    runtime.prs.lock().unwrap().clear();
    runtime.failed.store(false, Ordering::SeqCst);
    let restarted = SessionService::new(runtime.clone(), journal.clone(), None);
    restarted.session(&id).await.unwrap();
    restarted.refresh_metadata().await.unwrap();
    restarted.refresh_metadata().await.unwrap();
    assert_eq!(runtime.reports.lock().unwrap().len(), 2);
    assert_eq!(journal.read(&id).await.unwrap().len(), 6);
}
#[tokio::test]
async fn only_latest_locally_accepted_turn_with_matching_repo_can_update_the_pr() {
    let (id, journal, runtime) = fixture().await;
    *runtime.prs.lock().unwrap() = vec![
        pr("foreign_turn", "org/repo", 99),
        pr("turn_new", "other/repo", 98),
        pr("turn_old", "org/repo", 1),
    ];
    let service = SessionService::new(runtime.clone(), journal, None);
    service.session(&id).await.unwrap();
    service.refresh_metadata().await.unwrap();
    assert_eq!(
        runtime.reports.lock().unwrap().last().unwrap(),
        "https://github.com/org/repo/pull/1"
    );
    runtime
        .prs
        .lock()
        .unwrap()
        .push(pr("turn_new", "org/repo", 2));
    service.refresh_metadata().await.unwrap();
    assert_eq!(
        runtime.reports.lock().unwrap().last().unwrap(),
        "https://github.com/org/repo/pull/2"
    );
    *runtime.prs.lock().unwrap() = vec![pr("turn_old", "org/repo", 3)];
    service.refresh_metadata().await.unwrap();
    assert_eq!(runtime.reports.lock().unwrap().len(), 2);
}
#[tokio::test]
async fn stale_fence_or_switched_account_stops_refresh_before_provider_reads() {
    let (id, journal, runtime) = fixture().await;
    let fenced = Arc::new(AtomicBool::new(false));
    let service = SessionService::new(
        runtime.clone(),
        FencedJournal {
            inner: journal,
            fenced: fenced.clone(),
        },
        None,
    );
    service.replay(&id, &Sink::default()).await.unwrap();
    fenced.store(true, Ordering::SeqCst);
    assert!(service.refresh_metadata().await.is_err());
    assert_eq!(runtime.reads.load(Ordering::SeqCst), 0);
    fenced.store(false, Ordering::SeqCst);
    runtime.foreign.store(true, Ordering::SeqCst);
    assert!(service.refresh_metadata().await.is_err());
    assert_eq!(runtime.reads.load(Ordering::SeqCst), 0);
    assert!(runtime.reports.lock().unwrap().is_empty());
}

#[tokio::test]
async fn slow_metadata_read_cannot_overwrite_a_newer_foreground_observation() {
    let (id, journal, runtime) = fixture().await;
    runtime.hold.store(true, Ordering::SeqCst);
    *runtime.prs.lock().unwrap() = vec![pr("turn_new", "org/repo", 1)];
    let service = Arc::new(SessionService::new(runtime.clone(), journal.clone(), None));
    let session = service.session(&id).await.unwrap();
    let refresh = {
        let service = service.clone();
        tokio::spawn(async move { service.refresh_metadata().await })
    };
    runtime.entered.notified().await;
    let mut fresh = snapshot("turn_new", "completed");
    fresh.pull_requests = vec![pr("turn_new", "org/repo", 2)];
    service
        .record(
            &id,
            &session,
            JournalInput::Poll {
                snapshot: fresh,
                native: None,
            },
            &Discard,
        )
        .await
        .unwrap();
    *runtime.prs.lock().unwrap() = vec![pr("turn_new", "org/repo", 2)];
    runtime.hold.store(false, Ordering::SeqCst);
    runtime.release.notify_one();
    refresh.await.unwrap().unwrap();
    service.refresh_metadata().await.unwrap();
    assert_eq!(
        *runtime.reports.lock().unwrap(),
        ["https://github.com/org/repo/pull/2"]
    );
    assert_eq!(journal.read(&id).await.unwrap().len(), 6);
}

#[tokio::test]
async fn pr_reload_waits_for_active_load_and_replays_the_new_link() {
    let (id, journal, runtime) = fixture().await;
    let service = Arc::new(SessionService::new(runtime.clone(), journal, None));
    let initial = Sink::default();
    let recovery = service.prepare_recovery(&id, &initial).await.unwrap();
    assert!(
        initial
            .0
            .lock()
            .unwrap()
            .iter()
            .all(|event| event.method != "adapter/pull_request")
    );

    *runtime.prs.lock().unwrap() = vec![pr("turn_new", "org/repo", 42)];
    assert_eq!(service.refresh_metadata().await.unwrap(), vec![id.clone()]);
    let reload = tokio::spawn(async move {
        let output = Sink::default();
        let recovery = service.prepare_recovery(&id, &output).await.unwrap();
        drop(recovery);
        output
    });
    tokio::task::yield_now().await;
    assert!(
        !reload.is_finished(),
        "replacement must wait for the active load"
    );
    drop(recovery);
    let output = tokio::time::timeout(std::time::Duration::from_secs(2), reload)
        .await
        .unwrap()
        .unwrap();
    let events = output.0.lock().unwrap();
    let links: Vec<_> = events
        .iter()
        .filter(|event| event.method == "adapter/pull_request")
        .collect();
    assert_eq!(links.len(), 1);
    assert_eq!(
        links[0].params["url"],
        "https://github.com/org/repo/pull/42"
    );
}
