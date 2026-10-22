//! In-memory ports for the setup tests.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use import::domain::{
    models::{
        ImportEntity, ImportRun, ImportSource, ImportState, ImportStatus, Initiator,
        NotionDecision, NotionImportReport, NotionSharing, NotionWriteChoices, RunStatus,
    },
    service::RunImportOutcome,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use uuid::Uuid;

use crate::domain::{
    catalog::{App, MailProvider},
    ports::{
        AccountStatus, Inbox, Result, SetupAccounts, SetupConnections, SetupError, SetupImports,
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
        kind: source.default_kind(),
        foreign_id: format!("{}-{n}", source.as_ref()),
        parent_id: None,
        review_id: None,
        status,
        initiator: Initiator::Chat,
        metadata,
        entity_id: (status == ImportStatus::Imported).then(|| format!("entity-{n}")),
        entity_type: (status == ImportStatus::Imported).then(|| match source {
            ImportSource::Notion => "md".to_owned(),
            ImportSource::Linear => "task".to_owned(),
            ImportSource::Slack => "channel".to_owned(),
        }),
        last_error: None,
        waiting_on: None,
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
        json!({
            "title": title,
            "url": format!("https://notion.so/{n}"),
            "summary": "private summary",
            "plan": { "decision": "copy" },
        }),
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
pub fn run(source: ImportSource, status: RunStatus) -> ImportRun {
    ImportRun {
        source,
        status,
        error: None,
        updated_at: now(),
        scanned: None,
        review_id: None,
    }
}

/// An import service that finishes discovery at once, staging `discovered`.
pub struct FakeImports {
    /// Runs and rows.
    pub state: Mutex<ImportState>,
    /// Rows a discovery stages when it starts, per source.
    pub discovered: Mutex<Vec<ImportEntity>>,
    /// Every look-through started: (source, which call).
    pub starts: Mutex<Vec<(ImportSource, &'static str)>>,
    /// The ids every import started with, `run_import` or a Notion write.
    pub imports: Mutex<Vec<Vec<Uuid>>>,
    /// Every Notion plan started, with its sharing.
    pub notion_plans: Mutex<Vec<Option<NotionSharing>>>,
    /// Every Notion write: its review and choices.
    pub notion_writes: Mutex<Vec<(Uuid, NotionWriteChoices)>>,
    /// What the Notion report says beyond the run's status.
    pub notion_report: Mutex<NotionImportReport>,
    /// Plan rows that land just after a plan is tied to its review.
    pub planned_after_attach: Mutex<Vec<ImportEntity>>,
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
            notion_plans: Mutex::new(Vec::new()),
            notion_writes: Mutex::new(Vec::new()),
            notion_report: Mutex::new(NotionImportReport::default()),
            planned_after_attach: Mutex::new(Vec::new()),
            stay_running: false,
        }
    }

    fn launch(&self, source: ImportSource, call: &'static str) -> bool {
        self.starts.lock().unwrap().push((source, call));
        let mut state = self.state.lock().unwrap();
        state.runs.retain(|run| run.source != source);
        if self.stay_running {
            state.runs.push(run(source, RunStatus::Running));
            return true;
        }
        state.runs.push(run(source, RunStatus::Ready));
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

    async fn start_discovery(
        &self,
        _user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        Ok(self.launch(source, "discovery"))
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

    async fn plan_notion(
        &self,
        _user: &MacroUserIdStr<'static>,
        sharing: Option<NotionSharing>,
    ) -> Result<NotionImportReport> {
        self.notion_plans.lock().unwrap().push(sharing);
        self.launch(ImportSource::Notion, "plan");
        Ok(self.report())
    }

    async fn notion_report(&self, _user: &MacroUserIdStr<'static>) -> Result<NotionImportReport> {
        Ok(self.report())
    }

    async fn attach_notion_plan(
        &self,
        _user: &MacroUserIdStr<'static>,
        review_id: Uuid,
    ) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        for row in state.entities.iter_mut() {
            if row.source == ImportSource::Notion
                && row.status == ImportStatus::Staged
                && row.review_id.is_none()
            {
                row.review_id = Some(review_id);
            }
        }
        // A page planned right after the plan was tied: never part of it.
        let late = std::mem::take(&mut *self.planned_after_attach.lock().unwrap());
        state.entities.extend(late);
        Ok(())
    }

    async fn write_notion(
        &self,
        _user: &MacroUserIdStr<'static>,
        review_id: Uuid,
        choices: NotionWriteChoices,
    ) -> Result<NotionImportReport> {
        let mut written = Vec::new();
        {
            let mut state = self.state.lock().unwrap();
            for row in state.entities.iter_mut() {
                if row.source != ImportSource::Notion
                    || row.status != ImportStatus::Staged
                    || row.review_id != Some(review_id)
                {
                    continue;
                }
                // Like Notion's write: what was left out or stays in Notion is
                // set aside, what needs doing by hand stays staged.
                let decision = crate::domain::view::notion_plan(row).and_then(|plan| plan.decision);
                match decision {
                    _ if choices.excluded.contains(&row.id) => row.status = ImportStatus::Discarded,
                    Some(NotionDecision::Skip) => row.status = ImportStatus::Discarded,
                    Some(NotionDecision::Hand) | None => {}
                    Some(NotionDecision::Copy | NotionDecision::Tasks) => {
                        row.status = ImportStatus::Importing;
                        written.push(row.id);
                    }
                }
            }
        }
        self.imports.lock().unwrap().push(written);
        self.notion_writes
            .lock()
            .unwrap()
            .push((review_id, choices));
        Ok(self.report())
    }
}

impl FakeImports {
    fn report(&self) -> NotionImportReport {
        let status = self
            .state
            .lock()
            .unwrap()
            .runs
            .iter()
            .find(|run| run.source == ImportSource::Notion)
            .map(|run| run.status);
        NotionImportReport {
            status,
            ..self.notion_report.lock().unwrap().clone()
        }
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
    async fn inboxes(&self, _user: &MacroUserIdStr<'static>) -> Result<Vec<Inbox>> {
        Ok(self
            .0
            .iter()
            .map(|address| Inbox {
                address: address.clone(),
                provider: MailProvider::Gmail,
            })
            .collect())
    }
}

/// The account's onboarding, counting handovers.
#[derive(Default)]
pub struct FakeAccounts {
    /// Current status.
    pub status: Mutex<AccountStatus>,
    /// How many times setup was handed to the agent.
    pub handovers: Mutex<u32>,
    /// How many times setup was recorded as finished.
    pub finished: Mutex<u32>,
}

impl FakeAccounts {
    /// An account that finished web onboarding.
    pub fn onboarded_on_web() -> Self {
        Self {
            status: Mutex::new(AccountStatus {
                onboarded_on_web: true,
                has_team: true,
                ..AccountStatus::default()
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

    async fn hand_to_agent(&self, _user: &MacroUserIdStr<'static>) -> Result<()> {
        *self.handovers.lock().unwrap() += 1;
        let mut status = self.status.lock().unwrap();
        if !status.onboarded_on_web {
            status.agent_led = true;
        }
        Ok(())
    }

    async fn finish(&self, _user: &MacroUserIdStr<'static>) -> Result<()> {
        *self.finished.lock().unwrap() += 1;
        let mut status = self.status.lock().unwrap();
        if status.agent_led {
            status.setup_done = true;
        }
        Ok(())
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
