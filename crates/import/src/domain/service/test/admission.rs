use super::*;
use ai_billing::{AiAdmissionError, AiAdmissionService, DenyReason};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|import@example.com").unwrap()
}

fn denied() -> AiAdmissionError {
    AiAdmissionError::Denied(DenyReason::AllowanceExhausted)
}

struct Admission {
    error: Mutex<Option<AiAdmissionError>>,
    calls: AtomicUsize,
    allow_first: bool,
}

impl Admission {
    fn refusing(error: AiAdmissionError) -> Arc<Self> {
        Arc::new(Self {
            error: Mutex::new(Some(error)),
            calls: AtomicUsize::new(0),
            allow_first: false,
        })
    }
}

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        caller: &'a MacroUserIdStr<'_>,
        feature: ai_usage::AiFeature,
    ) -> ai_billing::domain::admission::AdmissionFuture<'a> {
        assert_eq!(caller, &user());
        assert_eq!(feature, ai_usage::AiFeature::Import);
        let call = self.calls.fetch_add(1, Ordering::SeqCst);
        let error = *self.error.lock().unwrap();
        Box::pin(async move {
            if self.allow_first && call == 0 {
                return Ok(());
            }
            error.map_or(Ok(()), Err)
        })
    }
}

#[derive(Default, Clone)]
struct Repo(Arc<Mutex<Ledger>>);

#[derive(Default)]
struct Ledger {
    rows: Vec<ImportEntity>,
    runs: Vec<ImportRun>,
    team_id: Option<Uuid>,
    target: Option<ImportTargetReservation>,
}

impl Repo {
    fn seed(&self, source: ImportSource) -> ImportEntity {
        let row = ImportEntity {
            id: Uuid::now_v7(),
            user_id: user().to_string(),
            team_id: None,
            source,
            foreign_id: if source == ImportSource::Slack {
                "C0123456789".into()
            } else {
                Uuid::now_v7().to_string()
            },
            status: ImportStatus::Staged,
            initiator: Initiator::Onboarding,
            metadata: serde_json::json!({"title": "A page", "name": "general"}),
            entity_id: None,
            entity_type: None,
            last_error: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        self.0.lock().unwrap().rows.push(row.clone());
        row
    }
}

// Mixed imports still reserve and complete Slack targets when AI admission is
// denied. Binding an archive source is outside these billing-policy tests.
impl CanonicalImportRepo for Repo {
    async fn source_binding(&self, _: Uuid) -> Result<Option<ImportSourceBinding>> {
        panic!("admission fixtures must not read canonical bindings")
    }

    async fn bind_source(
        &self,
        _: Uuid,
        _: Option<&SlackWorkspaceId>,
        _: bool,
    ) -> Result<ImportSourceBinding> {
        panic!("admission fixtures must not bind canonical sources")
    }

    async fn reserve_target(
        &self,
        caller: &MacroUserIdStr<'static>,
        key: &ImportTargetKey,
        kind: ImportTargetKind,
        existing: Option<Uuid>,
    ) -> Result<ImportTargetReservation> {
        assert_eq!(caller, &user());
        assert_eq!(kind, ImportTargetKind::Team);
        assert_eq!(existing, None);
        let mut ledger = self.0.lock().unwrap();
        assert_eq!(Some(key.team_id), ledger.team_id);
        let target = ledger
            .target
            .get_or_insert_with(|| ImportTargetReservation {
                key: key.clone(),
                channel_id: Uuid::now_v7(),
                ready: false,
            });
        assert_eq!(&target.key, key);
        Ok(target.clone())
    }

    async fn complete_target(
        &self,
        key: &ImportTargetKey,
        channel_id: Uuid,
        kind: ImportTargetKind,
    ) -> Result<ImportTargetReservation> {
        assert_eq!(kind, ImportTargetKind::Team);
        let mut ledger = self.0.lock().unwrap();
        let target = ledger.target.as_mut().unwrap();
        assert_eq!(&target.key, key);
        assert_eq!(target.channel_id, channel_id);
        target.ready = true;
        Ok(target.clone())
    }
}

impl ImportRepo for Repo {
    async fn list_runs(&self, caller: &MacroUserIdStr<'static>) -> Result<Vec<ImportRun>> {
        assert_eq!(caller, &user());
        Ok(self.0.lock().unwrap().runs.clone())
    }
    async fn start_run(
        &self,
        _: &MacroUserIdStr<'static>,
        source: ImportSource,
        from: &[RunStatus],
        auto_import: bool,
    ) -> Result<bool> {
        let mut ledger = self.0.lock().unwrap();
        if let Some(run) = ledger.runs.iter_mut().find(|run| run.source == source) {
            if !from.contains(&run.status) {
                return Ok(false);
            }
            run.status = RunStatus::Running;
            run.error = None;
        } else {
            ledger.runs.push(ImportRun {
                source,
                status: RunStatus::Running,
                auto_import,
                error: None,
                updated_at: chrono::Utc::now(),
            });
        }
        Ok(true)
    }
    async fn finish_run(
        &self,
        _: &MacroUserIdStr<'static>,
        source: ImportSource,
        to: RunStatus,
        error: Option<&str>,
    ) -> Result<bool> {
        let mut ledger = self.0.lock().unwrap();
        let run = ledger
            .runs
            .iter_mut()
            .find(|run| run.source == source)
            .unwrap();
        if run.status != RunStatus::Running {
            return Ok(false);
        }
        run.status = to;
        run.error = error.map(str::to_string);
        Ok(true)
    }
    async fn transition_run(
        &self,
        _: &MacroUserIdStr<'static>,
        source: ImportSource,
        from: &[RunStatus],
        to: RunStatus,
    ) -> Result<bool> {
        let mut ledger = self.0.lock().unwrap();
        let run = ledger
            .runs
            .iter_mut()
            .find(|run| run.source == source)
            .unwrap();
        if !from.contains(&run.status) {
            return Ok(false);
        }
        run.status = to;
        Ok(true)
    }
    async fn get(
        &self,
        caller: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<ImportEntity>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .rows
            .iter()
            .find(|row| row.id == id && row.user_id == caller.as_ref())
            .cloned())
    }
    async fn list(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Option<ImportSource>,
        _: Option<ImportStatus>,
    ) -> Result<Vec<ImportEntity>> {
        Ok(self.0.lock().unwrap().rows.clone())
    }
    async fn mark_importing(
        &self,
        _: &MacroUserIdStr<'static>,
        ids: &[Uuid],
    ) -> Result<Vec<ImportEntity>> {
        let mut ledger = self.0.lock().unwrap();
        Ok(ledger
            .rows
            .iter_mut()
            .filter(|row| ids.contains(&row.id) && row.status == ImportStatus::Staged)
            .map(|row| {
                row.status = ImportStatus::Importing;
                row.clone()
            })
            .collect())
    }
    async fn mark_imported(
        &self,
        _: &MacroUserIdStr<'static>,
        id: Uuid,
        entity_id: &str,
        entity_type: &str,
        _: Option<Uuid>,
    ) -> Result<Option<ImportEntity>> {
        let mut ledger = self.0.lock().unwrap();
        let row = ledger.rows.iter_mut().find(|row| row.id == id).unwrap();
        if row.status != ImportStatus::Importing {
            return Ok(None);
        }
        row.status = ImportStatus::Imported;
        row.entity_id = Some(entity_id.into());
        row.entity_type = Some(entity_type.into());
        Ok(Some(row.clone()))
    }
    async fn mark_import_failed(
        &self,
        _: &MacroUserIdStr<'static>,
        id: Uuid,
        error: &str,
    ) -> Result<bool> {
        let mut ledger = self.0.lock().unwrap();
        let row = ledger.rows.iter_mut().find(|row| row.id == id).unwrap();
        if row.status != ImportStatus::Importing {
            return Ok(false);
        }
        row.status = ImportStatus::Staged;
        row.last_error = Some(error.into());
        Ok(true)
    }
    async fn discard(&self, _: &MacroUserIdStr<'static>, id: Uuid) -> Result<bool> {
        let mut ledger = self.0.lock().unwrap();
        let row = ledger.rows.iter_mut().find(|row| row.id == id).unwrap();
        if row.status != ImportStatus::Staged {
            return Ok(false);
        }
        row.status = ImportStatus::Discarded;
        Ok(true)
    }
    async fn user_team_id(&self, _: &MacroUserIdStr<'static>) -> Result<Option<Uuid>> {
        Ok(self.0.lock().unwrap().team_id)
    }
    async fn fail_stale_importing(&self, _: &MacroUserIdStr<'static>, _: i64) -> Result<u64> {
        Ok(0)
    }
    async fn reconcile_auto_import_runs(&self, _: &MacroUserIdStr<'static>) -> Result<u64> {
        Ok(0)
    }
    async fn touch_importing(&self, _: &MacroUserIdStr<'static>, _: &[Uuid]) -> Result<u64> {
        Ok(0)
    }
    async fn get_own_by_foreign_id(
        &self,
        _: &MacroUserIdStr<'static>,
        source: ImportSource,
        foreign_id: &str,
    ) -> Result<Option<ImportEntity>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .rows
            .iter()
            .find(|row| row.source == source && row.foreign_id == foreign_id)
            .cloned())
    }
    async fn find_team_imported(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ImportSource,
        _: &str,
    ) -> Result<Option<ImportEntity>> {
        Ok(None)
    }
    async fn upsert_staged(
        &self,
        _: &MacroUserIdStr<'static>,
        source: ImportSource,
        initiator: Initiator,
        foreign_id: &str,
        metadata: &serde_json::Value,
    ) -> Result<Option<ImportEntity>> {
        let mut row = self.seed(source);
        row.foreign_id = foreign_id.into();
        row.initiator = initiator;
        row.metadata = metadata.clone();
        *self.0.lock().unwrap().rows.last_mut().unwrap() = row.clone();
        Ok(Some(row))
    }
    async fn upsert_imported(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ImportSource,
        _: Initiator,
        _: &str,
        _: &serde_json::Value,
        _: &str,
        _: &str,
        _: Option<Uuid>,
    ) -> Result<ImportEntity> {
        unreachable!()
    }
    async fn discard_staged_by_initiator(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Initiator,
    ) -> Result<u64> {
        unreachable!()
    }
    async fn delete_staged_by_initiator(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Initiator,
    ) -> Result<u64> {
        unreachable!()
    }
    async fn begin_auto_import(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ImportSource,
    ) -> Result<Option<Vec<ImportEntity>>> {
        unreachable!()
    }
    async fn finish_auto_import(
        &self,
        _: &MacroUserIdStr<'static>,
        _: ImportSource,
        _: &[Uuid],
    ) -> Result<Option<RunStatus>> {
        unreachable!()
    }
}

struct NoConnector;
impl ConnectorSelect for NoConnector {
    async fn user_toolset(&self, _: &MacroUserIdStr<'static>) -> UserMcpTools {
        panic!("unexpected connector call")
    }
    async fn connector_toolset(
        &self,
        _: &MacroUserIdStr<'static>,
        _: mcp_select::ConnectorRef<'_>,
    ) -> anyhow::Result<Option<UserMcpTools>> {
        panic!("unexpected connector call")
    }
    async fn connector_connected(
        &self,
        _: &MacroUserIdStr<'static>,
        _: mcp_select::ConnectorRef<'_>,
    ) -> anyhow::Result<bool> {
        panic!("unexpected connector call")
    }
}

#[derive(Default)]
struct Creator(AtomicUsize);
impl EntityCreator for Creator {
    async fn create_task(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &str,
        _: &ImportedTaskProperties,
    ) -> anyhow::Result<String> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(Uuid::now_v7().to_string())
    }
    async fn create_markdown_doc(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &str,
        _: &ImportedDocumentProperties,
    ) -> anyhow::Result<String> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(Uuid::now_v7().to_string())
    }
    async fn create_channel(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        target: &ImportTargetReservation,
        _: &[String],
    ) -> anyhow::Result<Uuid> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(target.channel_id)
    }
}

type Service = ImportServiceImpl<Repo, NoConnector, Creator>;
fn service(admission: Arc<Admission>) -> Service {
    ImportServiceImpl::new(
        Repo::default(),
        Arc::new(NoConnector),
        Arc::new(Creator::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    )
    .with_admission(admission)
}

struct Tools {
    name: &'static str,
    result: serde_json::Value,
    calls: AtomicUsize,
}
impl<Context: Send> ToolSet<Context> for Tools {
    fn dispatch_tool_call<'a>(
        &'a self,
        _: Context,
        caller: RequestContext,
        _: &'a str,
        _: &'a serde_json::Value,
    ) -> Pin<
        Box<
            dyn Future<Output = std::result::Result<ToolResult<serde_json::Value>, ToolSetError>>
                + Send
                + 'a,
        >,
    > {
        assert_eq!(caller.user_id, user());
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(Ok(self.result.clone())) })
    }
    fn request_schemas(&self) -> Option<Vec<ai_toolset::RequestSchema>> {
        Some(vec![ai_toolset::RequestSchema {
            name: self.name.into(),
            schema: schemars::schema_for!(serde_json::Value),
        }])
    }
}
fn notion_tools(truncated: bool) -> Arc<Tools> {
    Arc::new(Tools {
        name: "mcp__Notion__notion-fetch",
        result: serde_json::json!({"title": "A page", "text": "A complete page", "truncated": truncated}),
        calls: AtomicUsize::new(0),
    })
}

#[tokio::test]
async fn initial_gather_and_retry_refuse_before_running_or_connector_calls() {
    for error in [denied(), AiAdmissionError::Unavailable] {
        let admission = Admission::refusing(error);
        let service = service(admission.clone());
        for source in [ImportSource::Linear, ImportSource::Notion] {
            assert!(
                matches!(service.start_gather(user(), source, true).await, Err(ImportError::Admission(e)) if e == error)
            );
            assert!(service.repo.list_runs(&user()).await.unwrap().is_empty());
            assert!(
                matches!(service.retry_gather(user(), source).await, Err(ImportError::Admission(e)) if e == error)
            );
        }
        service
            .repo
            .start_run(&user(), ImportSource::Linear, &[], true)
            .await
            .unwrap();
        service
            .repo
            .finish_run(
                &user(),
                ImportSource::Linear,
                RunStatus::Failed,
                Some("old failure"),
            )
            .await
            .unwrap();
        assert!(
            matches!(service.retry_gather(user(), ImportSource::Linear).await, Err(ImportError::Admission(e)) if e == error)
        );
        let run = service
            .repo
            .list_runs(&user())
            .await
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(run.status, RunStatus::Failed);
        assert!(run.auto_import);
        assert_eq!(run.error.as_deref(), Some("old failure"));
        service
            .dismiss_run(user(), ImportSource::Linear)
            .await
            .unwrap();
        let calls = admission.calls.load(Ordering::SeqCst);
        assert!(
            !service
                .start_gather(user(), ImportSource::Linear, false)
                .await
                .unwrap()
        );
        assert_eq!(admission.calls.load(Ordering::SeqCst), calls);
        assert_eq!(
            service.state(user()).await.unwrap().runs[0].status,
            RunStatus::Dismissed
        );
    }
}

#[tokio::test]
async fn queued_gather_rechecks_and_finishes_failed_without_loading_tools() {
    for error in [denied(), AiAdmissionError::Unavailable] {
        let admission = Arc::new(Admission {
            error: Mutex::new(Some(error)),
            calls: AtomicUsize::new(0),
            allow_first: true,
        });
        let service = service(admission.clone());
        assert!(
            service
                .start_gather(user(), ImportSource::Notion, true)
                .await
                .unwrap()
        );
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let run = service
                    .repo
                    .list_runs(&user())
                    .await
                    .unwrap()
                    .pop()
                    .unwrap();
                if run.status == RunStatus::Failed {
                    assert!(run.error.unwrap().starts_with(error.code()));
                    assert!(run.auto_import);
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(admission.calls.load(Ordering::SeqCst), 2);
    }
}

#[tokio::test]
async fn active_gather_retries_are_noops_and_failed_retries_preserve_configuration() {
    let admission = Admission::refusing(AiAdmissionError::Unavailable);
    let service = service(admission.clone());
    service
        .repo
        .start_run(&user(), ImportSource::Linear, &[], true)
        .await
        .unwrap();
    assert!(
        !service
            .retry_gather(user(), ImportSource::Linear)
            .await
            .unwrap()
    );
    assert_eq!(admission.calls.load(Ordering::SeqCst), 0);
    service
        .repo
        .finish_run(
            &user(),
            ImportSource::Linear,
            RunStatus::Failed,
            Some("interrupted"),
        )
        .await
        .unwrap();

    // Admission recovers for the retry, then fails again when the task starts.
    let admission = Arc::new(Admission {
        error: Mutex::new(Some(AiAdmissionError::Unavailable)),
        calls: AtomicUsize::new(0),
        allow_first: true,
    });
    let service = service.with_admission(admission);
    assert!(
        service
            .retry_gather(user(), ImportSource::Linear)
            .await
            .unwrap()
    );
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let run = service
                .repo
                .list_runs(&user())
                .await
                .unwrap()
                .pop()
                .unwrap();
            if run.status == RunStatus::Failed {
                assert!(run.auto_import);
                assert!(run.error.unwrap().starts_with("ai_billing_unavailable"));
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn default_constructor_keeps_admission_disabled() {
    let service = ImportServiceImpl::new(
        Repo::default(),
        Arc::new(NoConnector),
        Arc::new(Creator::default()),
        Arc::new(ai_usage::NoOpUsageRecorder),
    );
    service.admit_ai(&user()).await.unwrap();
    assert!(
        service
            .prepare_gather(&user(), ImportSource::Notion, &[])
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn slack_direct_gather_bypasses_admission_but_fallback_does_not() {
    let admission = Admission::refusing(denied());
    let service = service(admission.clone());
    assert!(
        service
            .prepare_gather(&user(), ImportSource::Slack, &[])
            .await
            .unwrap()
    );
    let tools = Arc::new(Tools {
        name: "mcp__Slack__search_channels",
        result: serde_json::json!({"channels": [{"id": "C0123456789", "name": "general"}]}),
        calls: AtomicUsize::new(0),
    });
    service
        .gather_with_tools(&user(), ImportSource::Slack, tools.clone())
        .await
        .unwrap();
    assert_eq!(tools.calls.load(Ordering::SeqCst), 1);
    assert_eq!(service.repo.0.lock().unwrap().rows.len(), 1);
    assert_eq!(admission.calls.load(Ordering::SeqCst), 0);
    let empty = Arc::new(Tools {
        name: "mcp__Slack__search_channels",
        result: serde_json::json!({"channels": []}),
        calls: AtomicUsize::new(0),
    });
    let error = service
        .gather_with_tools(&user(), ImportSource::Slack, empty)
        .await
        .unwrap_err();
    assert_eq!(error.downcast_ref::<AiAdmissionError>(), Some(&denied()));
    assert_eq!(
        admission.calls.load(Ordering::SeqCst),
        1,
        "no alternate model after refusal"
    );
}

#[tokio::test]
async fn notion_direct_import_succeeds_and_denied_fallback_releases_claim() {
    for error in [denied(), AiAdmissionError::Unavailable] {
        let admission = Admission::refusing(error);
        let service = service(admission.clone());
        let direct = service.repo.seed(ImportSource::Notion);
        let fallback = service.repo.seed(ImportSource::Notion);
        let rows = service
            .repo
            .mark_importing(&user(), &[direct.id, fallback.id])
            .await
            .unwrap();
        service
            .process_notion_page(&user(), notion_tools(false), &rows[0])
            .await
            .unwrap();
        assert_eq!(admission.calls.load(Ordering::SeqCst), 0);
        let result = service
            .process_notion_page(&user(), notion_tools(true), &rows[1])
            .await
            .unwrap_err();
        assert_eq!(result.downcast_ref::<AiAdmissionError>(), Some(&error));
        let failed = service
            .repo
            .get(&user(), fallback.id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(failed.status, ImportStatus::Staged);
        assert!(failed.last_error.unwrap().starts_with(error.code()));
        assert_eq!(
            service
                .repo
                .get(&user(), direct.id)
                .await
                .unwrap()
                .unwrap()
                .status,
            ImportStatus::Imported
        );
        assert_eq!(service.creator.0.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn delayed_notion_work_rechecks_current_allowance_and_mixed_work_survives() {
    let admission = Admission::refusing(denied());
    *admission.error.lock().unwrap() = None;
    let service = service(admission.clone());
    service.admit_ai(&user()).await.unwrap();
    service.repo.0.lock().unwrap().team_id = Some(Uuid::now_v7());
    let notion = service.repo.seed(ImportSource::Notion);
    let linear = service.repo.seed(ImportSource::Linear);
    let slack = service.repo.seed(ImportSource::Slack);
    let discard = service.repo.seed(ImportSource::Notion);
    // Claim before the quota changes, as when waiting behind a concurrency cap.
    let rows = service
        .repo
        .mark_importing(&user(), &[notion.id])
        .await
        .unwrap();
    *admission.error.lock().unwrap() = Some(denied());
    let outcome = service
        .run_import(user(), vec![linear.id, slack.id], vec![discard.id])
        .await
        .unwrap();
    assert_eq!(outcome.importing, 2);
    assert_eq!(outcome.discarded, 1);
    let error = service
        .process_notion_page(&user(), notion_tools(true), &rows[0])
        .await
        .unwrap_err();
    assert_eq!(error.downcast_ref::<AiAdmissionError>(), Some(&denied()));
    tokio::time::timeout(Duration::from_secs(2), async {
        while service.creator.0.load(Ordering::SeqCst) < 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        service
            .repo
            .get(&user(), notion.id)
            .await
            .unwrap()
            .unwrap()
            .status,
        ImportStatus::Staged
    );
    assert_eq!(admission.calls.load(Ordering::SeqCst), 2);
}
