//! In-memory ports for the setup tests.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use import::domain::{
    models::{
        ImportEntity, ImportRun, ImportSource, ImportState, ImportStatus, Initiator, RunStatus,
    },
    service::RunImportOutcome,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use uuid::Uuid;

use crate::domain::{
    catalog::App,
    ports::{
        AccountStatus, Result, SetupAccounts, SetupConnections, SetupError, SetupImports,
        SetupInbox,
    },
    service::{AgentSetupService, SetupConfig, SetupPorts},
};

/// The person setting up.
pub fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|founder@startup.example".to_string()).expect("valid user id")
}

/// A fixed clock.
pub fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 14, 12, 0, 0).unwrap()
}

/// A ledger row for the person.
pub fn row(
    source: ImportSource,
    n: u128,
    status: ImportStatus,
    metadata: serde_json::Value,
) -> ImportEntity {
    ImportEntity {
        id: Uuid::from_u128(((0x1000_0000 + n) << 96) | n),
        user_id: user().as_ref().to_owned(),
        team_id: None,
        source,
        foreign_id: format!("{}-{n}", source.as_ref()),
        status,
        initiator: Initiator::Onboarding,
        metadata,
        entity_id: (status == ImportStatus::Imported).then(|| format!("entity-{n}")),
        entity_type: (status == ImportStatus::Imported).then(|| match source {
            ImportSource::Notion => "md".to_owned(),
            ImportSource::Linear => "task".to_owned(),
            ImportSource::Slack => "channel".to_owned(),
        }),
        last_error: None,
        created_at: now(),
        updated_at: now(),
    }
}

/// A Notion page row.
pub fn notion_page(n: u128, title: &str, status: ImportStatus) -> ImportEntity {
    row(
        ImportSource::Notion,
        n,
        status,
        json!({ "title": title, "url": format!("https://notion.so/{n}"), "summary": "private summary" }),
    )
}

/// A Linear issue row.
pub fn linear_issue(n: u128, identifier: &str, title: &str, status: ImportStatus) -> ImportEntity {
    row(
        ImportSource::Linear,
        n,
        status,
        json!({ "identifier": identifier, "title": title, "status": "In Progress", "assignee": "Ada" }),
    )
}

/// A run in `status`.
pub fn run(source: ImportSource, status: RunStatus, auto_import: bool) -> ImportRun {
    ImportRun {
        source,
        status,
        auto_import,
        error: None,
        updated_at: now(),
    }
}

/// An import service that finishes discovery at once, staging `discovered`.
pub struct FakeImports {
    /// Runs and rows.
    pub state: Mutex<ImportState>,
    /// Rows a discovery stages when it starts, per source.
    pub discovered: Mutex<Vec<ImportEntity>>,
    /// Every gather start: (source, which call).
    pub starts: Mutex<Vec<(ImportSource, &'static str)>>,
    /// Every run_import call's ids.
    pub imports: Mutex<Vec<Vec<Uuid>>>,
    /// Leave started runs `running` instead of finishing them.
    pub stay_running: bool,
}

impl FakeImports {
    /// A fake holding `runs` and `rows`, staging `discovered` on discovery.
    pub fn new(
        runs: Vec<ImportRun>,
        rows: Vec<ImportEntity>,
        discovered: Vec<ImportEntity>,
    ) -> Self {
        Self {
            state: Mutex::new(ImportState {
                runs,
                entities: rows,
            }),
            discovered: Mutex::new(discovered),
            starts: Mutex::new(Vec::new()),
            imports: Mutex::new(Vec::new()),
            stay_running: false,
        }
    }

    /// What the connection hook does for an agent-led account: start looking
    /// through `source` with automatic import off.
    pub fn connected_hook(&self, source: ImportSource) {
        self.launch(source, "hook");
    }

    fn launch(&self, source: ImportSource, call: &'static str) -> bool {
        self.starts.lock().unwrap().push((source, call));
        let mut state = self.state.lock().unwrap();
        state.runs.retain(|run| run.source != source);
        if self.stay_running {
            state.runs.push(run(source, RunStatus::Running, false));
            return true;
        }
        state.runs.push(run(source, RunStatus::Ready, false));
        let discovered: Vec<ImportEntity> = self
            .discovered
            .lock()
            .unwrap()
            .iter()
            .filter(|row| row.source == source)
            .cloned()
            .collect();
        state.entities.extend(discovered);
        true
    }
}

#[async_trait]
impl SetupImports for FakeImports {
    async fn state(&self, _user: &MacroUserIdStr<'static>) -> Result<ImportState> {
        Ok(self.state.lock().unwrap().clone())
    }

    async fn start_gather(
        &self,
        _user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        Ok(self.launch(source, "gather"))
    }

    async fn start_discovery(
        &self,
        _user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        Ok(self.launch(source, "discovery"))
    }

    async fn retry_gather(
        &self,
        _user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        Ok(self.launch(source, "retry"))
    }

    async fn run_import(
        &self,
        _user: &MacroUserIdStr<'static>,
        import_ids: Vec<Uuid>,
    ) -> Result<RunImportOutcome> {
        self.imports.lock().unwrap().push(import_ids.clone());
        let mut state = self.state.lock().unwrap();
        let mut importing = 0;
        for row in state.entities.iter_mut() {
            if import_ids.contains(&row.id) && row.status == ImportStatus::Staged {
                row.status = ImportStatus::Importing;
                importing += 1;
            }
        }
        Ok(RunImportOutcome {
            discarded: 0,
            importing,
        })
    }
}

/// Connections the person has made, by app id.
#[derive(Default)]
pub struct FakeConnections {
    /// Connected app ids.
    pub connected: Mutex<Vec<String>>,
    /// Slugs the connector directory offers.
    pub directory: Vec<&'static str>,
}

impl FakeConnections {
    /// The person connected `apps`.
    pub fn with(apps: &[&str]) -> Self {
        Self {
            connected: Mutex::new(apps.iter().map(|app| (*app).to_owned()).collect()),
            directory: vec![
                "asana",
                "github",
                "google_drive",
                "hubspot",
                "salesforce_rest_api",
            ],
        }
    }
}

#[async_trait]
impl SetupConnections for FakeConnections {
    async fn is_connected(&self, _user: &MacroUserIdStr<'static>, app: &App) -> Result<bool> {
        Ok(self
            .connected
            .lock()
            .unwrap()
            .iter()
            .any(|id| id == app.id()))
    }

    async fn directory_name(&self, slug: &str) -> Result<Option<String>> {
        Ok(self
            .directory
            .contains(&slug)
            .then(|| slug.to_ascii_uppercase()))
    }
}

/// The person's inboxes.
#[derive(Default)]
pub struct FakeInbox(pub Vec<String>);

#[async_trait]
impl SetupInbox for FakeInbox {
    async fn addresses(&self, _user: &MacroUserIdStr<'static>) -> Result<Vec<String>> {
        Ok(self.0.clone())
    }
}

/// The account's onboarding, counting handovers.
#[derive(Default)]
pub struct FakeAccounts {
    /// Current status.
    pub status: Mutex<AccountStatus>,
    /// How many times setup was handed to the agent.
    pub handovers: Mutex<u32>,
}

impl FakeAccounts {
    /// An account that finished web onboarding.
    pub fn onboarded_on_web() -> Self {
        Self {
            status: Mutex::new(AccountStatus {
                agent_led: false,
                onboarded_on_web: true,
                new_account: false,
            }),
            ..Self::default()
        }
    }
}

#[async_trait]
impl SetupAccounts for FakeAccounts {
    async fn status(&self, _user: &MacroUserIdStr<'static>) -> Result<AccountStatus> {
        Ok(*self.status.lock().unwrap())
    }

    async fn hand_to_agent(&self, _user: &MacroUserIdStr<'static>) -> Result<AccountStatus> {
        *self.handovers.lock().unwrap() += 1;
        let mut status = self.status.lock().unwrap();
        if !status.onboarded_on_web {
            status.agent_led = true;
        }
        Ok(*status)
    }
}

/// Connections that always fail, for error paths.
pub struct BrokenConnections;

#[async_trait]
impl SetupConnections for BrokenConnections {
    async fn is_connected(&self, _user: &MacroUserIdStr<'static>, _app: &App) -> Result<bool> {
        Err(SetupError::Internal(rootcause::report!(
            "database unavailable"
        )))
    }

    async fn directory_name(&self, _slug: &str) -> Result<Option<String>> {
        Ok(None)
    }
}

/// A service over the fakes, with handles to inspect them.
pub struct Fixture {
    /// The service.
    pub service: AgentSetupService,
    /// The import fake.
    pub imports: Arc<FakeImports>,
    /// The connections fake.
    pub connections: Arc<FakeConnections>,
    /// The accounts fake.
    pub accounts: Arc<FakeAccounts>,
}

/// Builds a service over the fakes.
pub fn fixture(
    imports: FakeImports,
    connections: FakeConnections,
    inbox: FakeInbox,
    accounts: FakeAccounts,
) -> Fixture {
    let imports = Arc::new(imports);
    let connections = Arc::new(connections);
    let accounts = Arc::new(accounts);
    let mut config = SetupConfig::new("https://macro.com/");
    config.poll_interval = std::time::Duration::from_millis(5);
    let service = AgentSetupService::new(
        SetupPorts {
            imports: imports.clone(),
            connections: connections.clone(),
            inbox: Arc::new(inbox),
            accounts: accounts.clone(),
        },
        config,
    )
    .with_test_clock(now);
    Fixture {
        service,
        imports,
        connections,
        accounts,
    }
}
