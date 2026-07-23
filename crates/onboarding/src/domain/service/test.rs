use super::*;
use import::domain::models::ImportState;
use import::domain::ports::Result as ImportResult;
use import::domain::service::RunImportOutcome;
use mcp_client::domain::models::{McpServerRecord, StoredCredentials};
use std::sync::Mutex;
use uuid::Uuid;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|tester@macro.com".to_string()).expect("valid test user id")
}

fn active_row() -> OnboardingRow {
    OnboardingRow {
        status: OnboardingStatus::Active,
        skipped: false,
        started_at: chrono::Utc::now(),
        completed_at: None,
    }
}

struct MockRepo {
    status: OnboardingStatus,
    /// Whether a row exists at all (get_row returns None when false).
    exists: bool,
    completions: Mutex<Vec<bool>>,
}

impl MockRepo {
    fn new(status: OnboardingStatus) -> Self {
        Self {
            status,
            exists: true,
            completions: Mutex::new(Vec::new()),
        }
    }

    fn missing() -> Self {
        Self {
            exists: false,
            ..Self::new(OnboardingStatus::Active)
        }
    }
}

impl OnboardingRepo for MockRepo {
    async fn ensure_row(&self, _user: &MacroUserIdStr<'static>) -> Result<OnboardingRow> {
        Ok(OnboardingRow {
            status: self.status,
            ..active_row()
        })
    }

    async fn get_row(&self, _user: &MacroUserIdStr<'static>) -> Result<Option<OnboardingRow>> {
        Ok(self.exists.then(|| OnboardingRow {
            status: self.status,
            ..active_row()
        }))
    }

    async fn complete(
        &self,
        _user: &MacroUserIdStr<'static>,
        skipped: bool,
    ) -> Result<OnboardingRow> {
        self.completions.lock().unwrap().push(skipped);
        Ok(OnboardingRow {
            status: OnboardingStatus::Completed,
            skipped,
            completed_at: Some(chrono::Utc::now()),
            ..active_row()
        })
    }
}

struct MockStore {
    records: Vec<McpServerRecord>,
}

impl McpServerStore for MockStore {
    type Err = ();

    async fn save(&self, _record: &McpServerRecord) -> std::result::Result<(), ()> {
        Ok(())
    }

    async fn load(
        &self,
        _user: &MacroUserIdStr<'static>,
        _url: &str,
    ) -> std::result::Result<Option<McpServerRecord>, ()> {
        Ok(None)
    }

    async fn delete(
        &self,
        _user: &MacroUserIdStr<'static>,
        _url: &str,
    ) -> std::result::Result<(), ()> {
        Ok(())
    }

    async fn list(
        &self,
        _user: &MacroUserIdStr<'static>,
    ) -> std::result::Result<Vec<McpServerRecord>, ()> {
        Ok(self.records.clone())
    }
}

#[derive(Default)]
struct MockImport {
    gathers: Mutex<Vec<(ImportSource, bool)>>,
    discards: Mutex<Vec<Initiator>>,
    deletions: Mutex<Vec<Initiator>>,
}

impl ImportService for MockImport {
    async fn state(&self, _user: MacroUserIdStr<'static>) -> ImportResult<ImportState> {
        Ok(ImportState {
            runs: Vec::new(),
            entities: Vec::new(),
        })
    }

    async fn start_gather(
        &self,
        _user: MacroUserIdStr<'static>,
        source: ImportSource,
        auto_import: bool,
    ) -> ImportResult<bool> {
        self.gathers.lock().unwrap().push((source, auto_import));
        Ok(true)
    }

    async fn retry_gather(
        &self,
        _user: MacroUserIdStr<'static>,
        _source: ImportSource,
    ) -> ImportResult<bool> {
        Ok(false)
    }

    async fn dismiss_run(
        &self,
        _user: MacroUserIdStr<'static>,
        _source: ImportSource,
    ) -> ImportResult<()> {
        Ok(())
    }

    async fn run_import(
        &self,
        _user: MacroUserIdStr<'static>,
        _import_ids: Vec<Uuid>,
        _discard_ids: Vec<Uuid>,
    ) -> ImportResult<RunImportOutcome> {
        Ok(RunImportOutcome {
            discarded: 0,
            importing: 0,
        })
    }

    async fn discard_staged_by_initiator(
        &self,
        _user: MacroUserIdStr<'static>,
        initiator: Initiator,
    ) -> ImportResult<u64> {
        self.discards.lock().unwrap().push(initiator);
        Ok(1)
    }

    async fn delete_staged_by_initiator(
        &self,
        _user: MacroUserIdStr<'static>,
        initiator: Initiator,
    ) -> ImportResult<u64> {
        self.deletions.lock().unwrap().push(initiator);
        Ok(1)
    }
}

fn record(url: &str, authenticated: bool) -> McpServerRecord {
    McpServerRecord {
        user_id: user(),
        url: url.to_string(),
        server_name: url.to_string(),
        credentials: authenticated
            .then(|| StoredCredentials::new("client".into(), None, Vec::new(), None)),
        enabled: true,
    }
}

fn service(
    status: OnboardingStatus,
    records: Vec<McpServerRecord>,
) -> (
    OnboardingServiceImpl<MockRepo, MockStore, MockImport>,
    Arc<MockImport>,
) {
    let import = Arc::new(MockImport::default());
    (
        OnboardingServiceImpl::new(
            MockRepo::new(status),
            Arc::new(MockStore { records }),
            import.clone(),
        ),
        import,
    )
}

#[tokio::test]
async fn active_flow_starts_gathers_for_authenticated_connectors_only() {
    let (service, import) = service(
        OnboardingStatus::Active,
        vec![
            record("https://mcp.linear.app/mcp", true),
            record("https://mcp.notion.com/mcp", false), // not authed yet
            record("https://unrelated.example/mcp", true), // not an import source
        ],
    );

    let state = service.get_state(user()).await.expect("state");
    assert_eq!(state.connected_servers.len(), 3);
    assert_eq!(
        import.gathers.lock().unwrap().as_slice(),
        &[(ImportSource::Linear, true)]
    );
}

#[tokio::test]
async fn completed_flow_never_starts_gathers() {
    let (service, import) = service(
        OnboardingStatus::Completed,
        vec![record("https://mcp.linear.app/mcp", true)],
    );

    service.get_state(user()).await.expect("state");
    service.reconcile(user()).await.expect("reconcile");
    assert!(import.gathers.lock().unwrap().is_empty());
}

#[tokio::test]
async fn completing_deletes_leftover_onboarding_staged_rows() {
    let (service, import) = service(OnboardingStatus::Active, Vec::new());

    let row = service.complete(user(), true).await.expect("complete");
    assert_eq!(row.status, OnboardingStatus::Completed);
    assert!(row.skipped);
    // Deleted, not discarded — never-reviewed candidates must stay
    // re-stageable by later gathers or chat.
    assert_eq!(
        import.deletions.lock().unwrap().as_slice(),
        &[Initiator::Onboarding]
    );
    assert!(import.discards.lock().unwrap().is_empty());
}

#[tokio::test]
async fn reconcile_ignores_users_who_never_entered_the_flow() {
    // The MCP post-auth hook reconciles every OAuth completion; a user
    // connecting a server outside onboarding must not get gathers (or an
    // onboarding row) out of it.
    let import = Arc::new(MockImport::default());
    let service = OnboardingServiceImpl::new(
        MockRepo::missing(),
        Arc::new(MockStore {
            records: vec![record("https://mcp.linear.app/mcp", true)],
        }),
        import.clone(),
    );

    service.reconcile(user()).await.expect("reconcile");
    assert!(import.gathers.lock().unwrap().is_empty());
}
