//! Agent-led setup: the six steps an agent walks through to set up a person's
//! Macro workspace, each a thin layer over services Macro already has.
//!
//! The service decides nothing on the import service's behalf — what a gather
//! finds and how an item is copied stay theirs. It sequences the steps, keeps
//! every one idempotent, and turns the state into one `next_step` an agent can
//! follow without reading anything else.

#[cfg(test)]
mod test;

use std::{sync::Arc, time::Duration};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use import::domain::models::{ImportSource, ImportState, ImportStatus, RunStatus};
use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest, Sha256};

use super::{
    catalog::{self, App, Kind, Support},
    models::{
        AccountSummary, AppDiscovery, AppNote, AppProgress, AppStage, AppSummary, ConnectResult,
        DiscoverResult, DiscoveryStatus, Handoff, HandoffKind, ImportStarted, InboxSummary,
        NotCovered, PlanRequest, ProposedPlan, ReportItem, ReportStatus, SetupId, SetupReport,
        SetupState, SupportKind,
    },
    plan::{self, Group, NotCoveredLine, PlanText, ResolvedApp},
    ports::{
        AccountStatus, Result, SetupAccounts, SetupConnections, SetupError, SetupImports,
        SetupInbox,
    },
    view::{self, Counts, SourceView},
};

/// How long a connect link stays valid. The Macro page mints a fresh
/// connector session when it is opened, so this only bounds stale links.
pub const HANDOFF_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How long `SetupDiscover` waits for a running discovery before answering.
pub const DISCOVERY_WAIT: Duration = Duration::from_secs(25);
/// How long `SetupGetStatus` waits for running imports before answering.
pub const IMPORT_WAIT: Duration = Duration::from_secs(20);
/// The longest wait an agent may ask for.
pub const MAX_WAIT: Duration = Duration::from_secs(45);
const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Settings for the setup service.
#[derive(Debug, Clone)]
pub struct SetupConfig {
    /// The web app origin links are built from, e.g. `https://macro.com`.
    pub app_base_url: String,
    /// How long connect links stay valid.
    pub handoff_ttl: Duration,
    /// How often waits re-check progress.
    pub poll_interval: Duration,
}

impl SetupConfig {
    /// Defaults for an app origin.
    pub fn new(app_base_url: impl Into<String>) -> Self {
        Self {
            app_base_url: app_base_url.into().trim_end_matches('/').to_owned(),
            handoff_ttl: HANDOFF_TTL,
            poll_interval: POLL_INTERVAL,
        }
    }
}

/// The setup service.
pub struct AgentSetupService {
    imports: Arc<dyn SetupImports>,
    connections: Arc<dyn SetupConnections>,
    inbox: Arc<dyn SetupInbox>,
    accounts: Arc<dyn SetupAccounts>,
    config: SetupConfig,
    clock: fn() -> DateTime<Utc>,
}

/// The ports the service runs on.
pub struct SetupPorts {
    /// The import service.
    pub imports: Arc<dyn SetupImports>,
    /// App connections.
    pub connections: Arc<dyn SetupConnections>,
    /// Email inboxes.
    pub inbox: Arc<dyn SetupInbox>,
    /// The account's onboarding.
    pub accounts: Arc<dyn SetupAccounts>,
}

/// One app in setup, with what Macro knows about it.
struct AppFacts<'a> {
    app: App,
    connected: bool,
    view: Option<SourceView<'a>>,
}

fn quoted_list(apps: &[String]) -> String {
    apps.iter()
        .map(|app| format!("\"{app}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

fn support_kind(app: &App, connectable: bool) -> SupportKind {
    match app.support() {
        Some(Support::Inbox) => SupportKind::Inbox,
        Some(Support::Import(_)) => SupportKind::Import,
        Some(Support::ImportLater(_)) => SupportKind::ImportLater,
        Some(Support::Keep | Support::KeepWithGoogle) => SupportKind::Keep,
        None if connectable => SupportKind::ConnectOnly,
        None => SupportKind::Unsupported,
    }
}

/// Names joined for a sentence: "A", "A and B", "A, B and C".
fn joined(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

fn stage(connected: bool, view: Option<&SourceView<'_>>) -> AppStage {
    let Some(view) = view else {
        return AppStage::NotApplicable;
    };
    let counts = view.counts();
    if !connected && view.run.is_none() && counts == Counts::default() {
        return AppStage::NotConnected;
    }
    match view.run.map(|run| run.status) {
        None if counts == Counts::default() => {
            if connected {
                AppStage::Connected
            } else {
                AppStage::NotConnected
            }
        }
        Some(RunStatus::Running) => AppStage::Discovering,
        Some(RunStatus::Failed) if counts == Counts::default() => AppStage::DiscoveryFailed,
        _ if counts.importing > 0 => AppStage::Importing,
        _ if counts.imported > 0 || counts.failed > 0 => AppStage::Imported,
        _ if counts.candidates > 0 => AppStage::ReadyForPlan,
        _ => AppStage::NothingFound,
    }
}

impl AgentSetupService {
    /// A service over its ports.
    pub fn new(ports: SetupPorts, config: SetupConfig) -> Self {
        Self {
            imports: ports.imports,
            connections: ports.connections,
            inbox: ports.inbox,
            accounts: ports.accounts,
            config,
            clock: Utc::now,
        }
    }

    #[cfg(test)]
    pub(crate) fn with_test_clock(mut self, clock: fn() -> DateTime<Utc>) -> Self {
        self.clock = clock;
        self
    }

    /// The person's setup handle: stable for the account and opaque.
    pub fn setup_id(user: &MacroUserIdStr<'static>) -> SetupId {
        let digest = Sha256::digest(format!("macro-agent-setup:{}", user.as_ref()).as_bytes());
        SetupId(format!("setup_{}", &URL_SAFE_NO_PAD.encode(digest)[..12]))
    }

    /// Refuses a handle that belongs to another account: the agent is signed
    /// in as someone other than the person it started setting up.
    pub fn check_setup_id(user: &MacroUserIdStr<'static>, setup_id: Option<&str>) -> Result<()> {
        match setup_id.map(str::trim).filter(|id| !id.is_empty()) {
            Some(id) if id != Self::setup_id(user).0 => Err(SetupError::Actionable(
                "That setup_id belongs to a different Macro account than the one this agent is \
                 signed in to. Call SetupGetState to get this account's setup_id, and check with \
                 the person that they signed in with the right account."
                    .to_owned(),
            )),
            _ => Ok(()),
        }
    }

    fn email(user: &MacroUserIdStr<'static>) -> String {
        user.email_part().as_ref().to_owned()
    }

    fn link(&self, path: &str) -> String {
        format!("{}{path}", self.config.app_base_url)
    }

    fn connect_handoff(&self, user: &MacroUserIdStr<'static>, app: &App) -> Handoff {
        let expires_at = (self.clock)()
            + chrono::Duration::from_std(self.config.handoff_ttl).unwrap_or_default();
        let is_inbox = app.support() == Some(Support::Inbox);
        let name = app.name();
        // The connect page connects the slug in its path.
        let url = format!(
            "{}/app/connect/{}?account={}&expires={}",
            self.config.app_base_url,
            app.connect_slug().unwrap_or(app.id()),
            urlencoding::encode(&Self::email(user)),
            expires_at.timestamp()
        );
        let user_will_see = if is_inbox {
            "A Macro page, then Google asking to let Macro read and send their Gmail. They may \
             be asked to sign in to Macro first, with the same Google account."
                .to_owned()
        } else {
            format!(
                "A Macro page with a Connect {name} button, then {name}'s own screen to choose \
                 what Macro can read. They may be asked to sign in to Macro first, with the same \
                 Google account."
            )
        };
        Handoff {
            app: app.id().to_owned(),
            kind: if is_inbox {
                HandoffKind::ConnectInbox
            } else {
                HandoffKind::Connect
            },
            url,
            expires_at: Some(expires_at),
            user_will_see,
            resume: format!(
                "When the person says they are done, call SetupGetState. If the link expired or \
                 failed, call SetupConnect(apps: [\"{}\"]) for a fresh one.",
                app.id()
            ),
        }
    }

    async fn facts<'a>(
        &self,
        user: &MacroUserIdStr<'static>,
        apps: Vec<App>,
        import_state: &'a ImportState,
        inbox: &[String],
    ) -> Result<Vec<AppFacts<'a>>> {
        let mut facts = Vec::with_capacity(apps.len());
        for app in apps {
            let connected = match app.support() {
                Some(Support::Inbox) => !inbox.is_empty(),
                // Calendar access is granted inside Macro, which setup can't
                // see, so it never reports Calendar as connected.
                Some(Support::KeepWithGoogle) => false,
                _ => self.connections.is_connected(user, &app).await?,
            };
            let view = app
                .import_source()
                .map(|source| SourceView::of(import_state, user, source));
            facts.push(AppFacts {
                app,
                connected,
                view,
            });
        }
        Ok(facts)
    }

    /// The apps setup is about: the ones the agent named, plus any import
    /// app the person already connected or imported from.
    fn apps_in_scope(
        &self,
        named: &[String],
        import_state: &ImportState,
        user: &MacroUserIdStr<'static>,
    ) -> Vec<App> {
        let mut apps = catalog::resolve_all(named);
        for source in ImportSource::all() {
            let app = App::Known(catalog::for_source(source));
            let touched = SourceView::of(import_state, user, source).run.is_some()
                || import_state
                    .entities
                    .iter()
                    .any(|row| row.source == source && row.user_id.as_str() == user.as_ref());
            if touched && !apps.iter().any(|seen| seen.id() == app.id()) {
                apps.push(app);
            }
        }
        apps
    }

    /// Whether the workspace counts as set up: onboarded on the web, or work
    /// already brought in.
    #[tracing::instrument(skip(self, user), err)]
    pub async fn is_set_up(&self, user: &MacroUserIdStr<'static>) -> Result<bool> {
        let account = self.accounts.status(user).await?;
        self.set_up_given(user, account).await
    }

    /// Whether an agent's instructions should lead with setup: the person
    /// signed up through their agent and the workspace isn't set up yet.
    /// Everyone else, including people who had Macro before, sets up only when
    /// they ask.
    #[tracing::instrument(skip(self, user), err)]
    pub async fn leads_with_setup(&self, user: &MacroUserIdStr<'static>) -> Result<bool> {
        let account = self.accounts.status(user).await?;
        if !(account.agent_led || account.new_account) {
            return Ok(false);
        }
        Ok(!self.set_up_given(user, account).await?)
    }

    async fn set_up_given(
        &self,
        user: &MacroUserIdStr<'static>,
        account: AccountStatus,
    ) -> Result<bool> {
        if account.onboarded_on_web {
            return Ok(true);
        }
        let state = self.imports.state(user).await?;
        Ok(state.entities.iter().any(|row| {
            row.user_id.as_str() == user.as_ref()
                && matches!(row.status, ImportStatus::Imported | ImportStatus::Importing)
        }))
    }

    /// Everything about the setup, and the one thing to do next. Read-only.
    #[tracing::instrument(skip(self, user), err)]
    pub async fn state(
        &self,
        user: &MacroUserIdStr<'static>,
        named_apps: &[String],
    ) -> Result<SetupState> {
        let account = self.accounts.status(user).await?;
        let inbox = self.inbox.addresses(user).await?;
        let import_state = self.imports.state(user).await?;
        let apps = self.apps_in_scope(named_apps, &import_state, user);
        let facts = self.facts(user, apps, &import_state, &inbox).await?;

        let mut summaries = Vec::with_capacity(facts.len());
        for fact in &facts {
            let connectable = self.connectable(&fact.app, fact.connected).await?;
            let counts = fact
                .view
                .as_ref()
                .map(SourceView::counts)
                .unwrap_or_default();
            let stage = match &fact.view {
                Some(view) => stage(fact.connected, Some(view)),
                None if fact.connected => AppStage::NotApplicable,
                None => match fact.app.support() {
                    Some(Support::Inbox) => AppStage::NotConnected,
                    Some(Support::ImportLater(_) | Support::Keep) | None if connectable => {
                        AppStage::NotConnected
                    }
                    _ => AppStage::NotApplicable,
                },
            };
            let note = match (&fact.view, stage) {
                (Some(view), AppStage::DiscoveryFailed) => {
                    view::run_error(view.run).map(|error| format!("Discovery failed: {error}"))
                }
                _ => plan::not_covered(&fact.app, &self.config.app_base_url).map(|line| line.text),
            };
            summaries.push(AppSummary {
                app: fact.app.id().to_owned(),
                name: fact.app.name(),
                support: support_kind(&fact.app, connectable),
                connected: fact.connected,
                stage,
                candidates: counts.candidates,
                importing: counts.importing,
                imported: counts.imported,
                failed: counts.failed,
                note,
            });
        }

        let (missing, next_step) = next_step(named_apps.is_empty(), &inbox, &summaries);
        Ok(SetupState {
            setup_id: Self::setup_id(user),
            account: AccountSummary {
                email: Self::email(user),
                agent_led: account.agent_led,
                onboarded_on_web: account.onboarded_on_web,
            },
            inbox: InboxSummary {
                connected: !inbox.is_empty(),
                addresses: inbox,
            },
            apps: summaries,
            missing,
            next_step,
        })
    }

    /// Whether the person can connect the app to Macro: import apps and the
    /// Google account always; anything else when the connector directory
    /// offers it.
    async fn connectable(&self, app: &App, connected: bool) -> Result<bool> {
        Ok(match app.support() {
            Some(Support::Import(_) | Support::Inbox | Support::KeepWithGoogle) => true,
            _ if connected => true,
            _ => match app.connect_slug() {
                Some(slug) => self.connections.directory_name(slug).await?.is_some(),
                None => false,
            },
        })
    }

    async fn hand_to_agent(&self, user: &MacroUserIdStr<'static>) -> Result<AccountStatus> {
        self.accounts.hand_to_agent(user).await
    }

    /// One link per app still to connect, and Macro starts looking through
    /// apps that are already connected. Hands setup to the agent first, so
    /// opening a Macro page never drops the person into the web onboarding.
    /// (For agent-led accounts, an app connected through a link starts being
    /// looked through as soon as the connection lands.)
    #[tracing::instrument(skip(self, user), err)]
    pub async fn connect(
        &self,
        user: &MacroUserIdStr<'static>,
        named_apps: &[String],
    ) -> Result<ConnectResult> {
        let apps = catalog::resolve_all(named_apps);
        if apps.is_empty() {
            return Err(SetupError::Actionable(
                "Name the apps to connect, e.g. SetupConnect(apps: [\"notion\", \"linear\"]). \
                 SetupGetState lists what is missing."
                    .to_owned(),
            ));
        }
        self.hand_to_agent(user).await?;
        let inbox = self.inbox.addresses(user).await?;

        let mut handoffs = Vec::new();
        let mut already_connected = Vec::new();
        let mut not_connectable = Vec::new();
        let mut looking = Vec::new();
        for app in apps {
            match app.support() {
                Some(Support::Inbox) => {
                    if inbox.is_empty() {
                        handoffs.push(self.connect_handoff(user, &app));
                    } else {
                        already_connected.push(app.id().to_owned());
                    }
                }
                Some(Support::KeepWithGoogle) => not_connectable.push(AppNote {
                    app: app.id().to_owned(),
                    note: plan::not_covered(&app, &self.config.app_base_url)
                        .map(|line| format!("{}. There is no link for it in setup.", line.text))
                        .unwrap_or_default(),
                }),
                Some(Support::Import(source)) => {
                    if self.connections.is_connected(user, &app).await? {
                        already_connected.push(app.id().to_owned());
                        if self.start_looking(user, source).await? {
                            looking.push(app.id().to_owned());
                        }
                    } else {
                        handoffs.push(self.connect_handoff(user, &app));
                    }
                }
                Some(Support::ImportLater(_) | Support::Keep) | None => {
                    if self.connections.is_connected(user, &app).await? {
                        already_connected.push(app.id().to_owned());
                    } else if self.connectable(&app, false).await? {
                        handoffs.push(self.connect_handoff(user, &app));
                    } else {
                        not_connectable.push(AppNote {
                            app: app.id().to_owned(),
                            note: plan::not_covered(&app, &self.config.app_base_url)
                                .map(|line| {
                                    format!(
                                        "{}. It can't be connected to Macro right now.",
                                        line.text
                                    )
                                })
                                .unwrap_or_default(),
                        });
                    }
                }
            }
        }

        let next_step = if handoffs.is_empty() && !looking.is_empty() {
            format!(
                "Macro is looking through {}. Call SetupDiscover(apps: [{}]) to see what it finds.",
                looking.join(" and "),
                quoted_list(&looking)
            )
        } else if handoffs.is_empty() {
            "Nothing left to connect. Call SetupGetState for the next step.".to_owned()
        } else {
            format!(
                "Show the person {} in one message: the link, the app, and what they'll see. Then \
                 wait until they say they're done and call SetupGetState. Don't open the links \
                 yourself.",
                if handoffs.len() == 1 {
                    "this link".to_owned()
                } else {
                    format!("these {} links", handoffs.len())
                }
            )
        };
        Ok(ConnectResult {
            setup_id: Self::setup_id(user),
            handoffs,
            already_connected,
            looking_through: looking,
            not_connectable,
            next_step,
        })
    }

    async fn wait_while<F>(
        &self,
        user: &MacroUserIdStr<'static>,
        wait: Duration,
        busy: F,
    ) -> Result<ImportState>
    where
        F: Fn(&ImportState) -> bool,
    {
        let deadline = tokio::time::Instant::now() + wait.min(MAX_WAIT);
        loop {
            let state = self.imports.state(user).await?;
            if !busy(&state) || tokio::time::Instant::now() >= deadline {
                return Ok(state);
            }
            tokio::time::sleep(self.config.poll_interval).await;
        }
    }

    /// Starts Macro looking through a connected import app, unless it already
    /// is or already did. `true` when a look-through is running now.
    async fn start_looking(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<bool> {
        let state = self.imports.state(user).await?;
        let view = SourceView::of(&state, user, source);
        let counts = view.counts();
        let run = view.run;
        let launched = match run.map(|run| (run.status, run.auto_import)) {
            None if source == ImportSource::Slack => {
                self.imports.start_discovery(user, source).await?
            }
            None => self.imports.start_gather(user, source).await?,
            // A failed or dismissed agent-led run can be retried; one that was
            // set to import automatically (web onboarding) cannot, because a
            // retry would import without a plan.
            Some((RunStatus::Failed | RunStatus::Dismissed, false)) => {
                self.imports.retry_gather(user, source).await?
            }
            // Slack discovery repeats, and re-lists every channel; only when
            // nothing is waiting for the plan.
            Some((RunStatus::Ready | RunStatus::Completed, _))
                if source == ImportSource::Slack
                    && counts.candidates == 0
                    && counts.importing == 0 =>
            {
                self.imports.start_discovery(user, source).await?
            }
            _ => false,
        };
        Ok(launched || run.is_some_and(|run| run.status == RunStatus::Running))
    }

    /// What Macro found in each connected import app, waiting up to `wait`
    /// while it is still looking. Read-only: looking starts when an app is
    /// connected (or with `SetupConnect` for apps connected earlier).
    #[tracing::instrument(skip(self, user), err)]
    pub async fn discover(
        &self,
        user: &MacroUserIdStr<'static>,
        named_apps: &[String],
        wait: Duration,
    ) -> Result<DiscoverResult> {
        let apps = catalog::resolve_all(named_apps);
        if apps.is_empty() {
            return Err(SetupError::Actionable(
                "Name the apps to look at, e.g. SetupDiscover(apps: [\"notion\", \"linear\"])."
                    .to_owned(),
            ));
        }
        let mut watched: Vec<ImportSource> = Vec::new();
        for app in &apps {
            if let Some(source) = app.import_source()
                && self.connections.is_connected(user, app).await?
            {
                watched.push(source);
            }
        }
        // A look-through that hasn't shown up yet may still be starting (the
        // connection just landed), so wait for it too.
        let state = self
            .wait_while(user, wait, |state| {
                watched.iter().any(|source| {
                    SourceView::of(state, user, *source)
                        .run
                        .is_none_or(|run| run.status == RunStatus::Running)
                })
            })
            .await?;

        let mut results = Vec::with_capacity(apps.len());
        for app in &apps {
            results.push(self.discovery_for(user, app, &state).await?);
        }
        let next_step = discovery_next_step(&results);
        Ok(DiscoverResult {
            setup_id: Self::setup_id(user),
            apps: results,
            next_step,
        })
    }

    async fn discovery_for(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &App,
        state: &ImportState,
    ) -> Result<AppDiscovery> {
        let base = AppDiscovery {
            app: app.id().to_owned(),
            name: app.name(),
            status: DiscoveryStatus::NotImportable,
            candidates: Vec::new(),
            groups: Vec::new(),
            note: None,
        };
        let Some(source) = app.import_source() else {
            let note = match app.support() {
                Some(Support::Inbox) => {
                    "Gmail is the inbox itself; there is nothing to discover.".to_owned()
                }
                _ => plan::not_covered(app, &self.config.app_base_url)
                    .map(|line| line.text)
                    .unwrap_or_default(),
            };
            return Ok(AppDiscovery {
                note: Some(note),
                ..base
            });
        };
        if !self.connections.is_connected(user, app).await? {
            return Ok(AppDiscovery {
                status: DiscoveryStatus::NotConnected,
                note: Some(format!(
                    "Connect it first: call SetupConnect(apps: [\"{}\"]) and show the person the link.",
                    app.id()
                )),
                ..base
            });
        }
        let view = SourceView::of(state, user, source);
        let counts = view.counts();
        let status = match view.run.map(|run| run.status) {
            None if counts == Counts::default() => DiscoveryStatus::NotStarted,
            Some(RunStatus::Running) | None => DiscoveryStatus::Discovering,
            _ if counts.candidates + counts.failed > 0 => DiscoveryStatus::Ready,
            Some(RunStatus::Failed) if counts == Counts::default() => DiscoveryStatus::Failed,
            _ if counts.imported + counts.importing > 0 => DiscoveryStatus::AlreadyImported,
            _ => DiscoveryStatus::NothingFound,
        };
        let note = match status {
            DiscoveryStatus::NotStarted => Some(format!(
                "Macro hasn't started looking through it. Call SetupConnect(apps: [\"{}\"]); for \
                 a connected app that starts the look-through.",
                app.id()
            )),
            DiscoveryStatus::Failed => Some(format!(
                "Discovery failed: {}",
                view::run_error(view.run).unwrap_or_else(|| "no reason given".to_owned())
            )),
            DiscoveryStatus::AlreadyImported if source != ImportSource::Slack => Some(format!(
                "{} items came in earlier. Looking again for more in {} isn't available yet.",
                counts.imported + counts.importing,
                app.name()
            )),
            DiscoveryStatus::AlreadyImported => Some(format!(
                "{} channels came in earlier.",
                counts.imported + counts.importing
            )),
            DiscoveryStatus::Ready if source != ImportSource::Slack => Some(
                "Macro's importer picks a starter set of the most relevant items; it doesn't list \
                 everything in the workspace, and looking again for more isn't available yet. \
                 Say so in the plan rather than promising more later."
                    .to_owned(),
            ),
            _ => None,
        };
        Ok(AppDiscovery {
            status,
            candidates: view.candidates(),
            groups: view.groups(),
            note,
            ..base
        })
    }

    fn resolve_plan<'a>(
        &self,
        user: &MacroUserIdStr<'static>,
        request: &PlanRequest,
        state: &'a ImportState,
    ) -> Result<Vec<ResolvedApp<'a>>> {
        let mut resolved: Vec<ResolvedApp<'a>> = Vec::new();
        for selection in &request.selections {
            let source = plan::selection_source(selection)?;
            if resolved.iter().any(|app| app.source == source) {
                return Err(SetupError::Actionable(format!(
                    "{} appears twice in the selections. Give one selection per app.",
                    catalog::source_name(source)
                )));
            }
            let view = SourceView::of(state, user, source);
            resolved.push(plan::resolve_selection(
                &view,
                selection,
                &request.declined,
            )?);
        }
        Ok(resolved)
    }

    fn not_covered_lines(
        &self,
        request: &PlanRequest,
        resolved: &[ResolvedApp<'_>],
    ) -> Vec<NotCoveredLine> {
        let mut apps = catalog::resolve_all(&request.other_apps);
        for app in resolved {
            let app = App::Known(catalog::for_source(app.source));
            if !apps.iter().any(|seen| seen.id() == app.id()) {
                apps.push(app);
            }
        }
        apps.iter()
            .filter_map(|app| plan::not_covered(app, &self.config.app_base_url))
            .collect()
    }

    /// Turns the person's choices into one plan to approve. No side effects.
    #[tracing::instrument(skip(self, user, request), err)]
    pub async fn propose_plan(
        &self,
        user: &MacroUserIdStr<'static>,
        request: &PlanRequest,
    ) -> Result<ProposedPlan> {
        if request.selections.is_empty() && request.other_apps.is_empty() {
            return Err(SetupError::Actionable(
                "The plan is empty. Add a selection per app from SetupDiscover (all: true, or the \
                 refs the person chose)."
                    .to_owned(),
            ));
        }
        let state = self.imports.state(user).await?;
        let resolved = self.resolve_plan(user, request, &state)?;
        let inbox = self.inbox.addresses(user).await?;
        let not_covered = self.not_covered_lines(request, &resolved);
        let plan_text = plan::render(&PlanText {
            apps: &resolved,
            scope_notes: request.scope_notes.as_deref(),
            not_covered: &not_covered,
            inbox: &inbox,
        });
        let will_import = resolved
            .iter()
            .map(|app| app.to_import.len())
            .sum::<usize>();
        let plan_id = plan::plan_id(user, request, &resolved);
        Ok(ProposedPlan {
            setup_id: Self::setup_id(user),
            next_step: format!(
                "Show plan_text to the person as written and ask for one approval. When they \
                 approve, call SetupImport(plan_id: \"{plan_id}\", approved: true) with the same \
                 selections and declined refs. If they change anything, call SetupProposePlan \
                 again and show the new plan."
            ),
            plan_id,
            plan_text,
            will_import: u32::try_from(will_import).unwrap_or(u32::MAX),
        })
    }

    /// Runs an approved plan. Idempotent: items already underway are skipped.
    #[tracing::instrument(skip(self, user, request), err)]
    pub async fn import(
        &self,
        user: &MacroUserIdStr<'static>,
        request: &PlanRequest,
        plan_id: &str,
        approved: bool,
    ) -> Result<ImportStarted> {
        if !approved {
            return Err(SetupError::Actionable(
                "Import only after the person approves the plan. Show plan_text from \
                 SetupProposePlan, wait for their yes, then call SetupImport with approved: true."
                    .to_owned(),
            ));
        }
        let state = self.imports.state(user).await?;
        let resolved = self.resolve_plan(user, request, &state)?;
        let expected = plan::plan_id(user, request, &resolved);
        if plan_id.trim() != expected {
            return Err(SetupError::Actionable(format!(
                "These selections don't match plan \"{}\", or Macro found more since the person \
                 approved it. Call SetupProposePlan with the person's choices, show them that plan, \
                 and pass its plan_id with exactly the same selections.",
                plan_id.trim()
            )));
        }
        self.hand_to_agent(user).await?;
        let ids: Vec<_> = resolved.iter().flat_map(ResolvedApp::import_ids).collect();
        let underway = resolved.iter().map(|app| app.underway.len()).sum::<usize>();

        let started = if ids.is_empty() {
            0
        } else {
            self.imports.run_import(user, ids).await?.importing
        };
        Ok(ImportStarted {
            setup_id: Self::setup_id(user),
            plan_id: expected,
            started: u32::try_from(started).unwrap_or(u32::MAX),
            already_underway: u32::try_from(underway).unwrap_or(u32::MAX),
            next_step:
                "Tell the person the import has started. Then call SetupGetStatus; it waits \
                        for progress and returns the final report with links."
                    .to_owned(),
        })
    }

    /// Import progress, then the final report. Read-only.
    #[tracing::instrument(skip(self, user), err)]
    pub async fn status(
        &self,
        user: &MacroUserIdStr<'static>,
        named_apps: &[String],
        wait: Duration,
    ) -> Result<SetupReport> {
        let state = self
            .wait_while(user, wait, |state| {
                state.entities.iter().any(|row| {
                    row.status == ImportStatus::Importing && row.user_id.as_str() == user.as_ref()
                })
            })
            .await?;

        let mut progress = Vec::new();
        let mut imported = Vec::new();
        let mut not_imported = Vec::new();
        for source in ImportSource::all() {
            let view = SourceView::of(&state, user, source);
            let counts = view.counts();
            let app = catalog::for_source(source).id.to_owned();
            if counts.imported + counts.importing + counts.failed > 0 {
                progress.push(AppProgress {
                    app: app.clone(),
                    imported: counts.imported,
                    importing: counts.importing,
                    failed: counts.failed,
                });
            }
            for row in &view.rows {
                match row.status {
                    ImportStatus::Imported => imported.push(ReportItem {
                        app: app.clone(),
                        title: view::title(row),
                        link: match (row.entity_type.as_deref(), row.entity_id.as_deref()) {
                            (Some(kind), Some(id)) => Some(self.link(&format!("/app/{kind}/{id}"))),
                            _ => None,
                        },
                        reason: None,
                    }),
                    ImportStatus::Staged if row.last_error.is_some() => {
                        not_imported.push(ReportItem {
                            app: app.clone(),
                            title: view::title(row),
                            link: None,
                            reason: row.last_error.as_deref().map(view::reason),
                        })
                    }
                    _ => {}
                }
            }
        }
        imported.sort_by(|a, b| a.app.cmp(&b.app).then(a.title.cmp(&b.title)));

        let mut not_covered = Vec::new();
        let mut stays_connected = Vec::new();
        for app in catalog::resolve_all(named_apps) {
            let Some(line) = plan::not_covered(&app, &self.config.app_base_url) else {
                continue;
            };
            if line.group == Group::Keep {
                stays_connected.push(AppNote {
                    app: app.id().to_owned(),
                    note: format!("{}: {}", line.name, line.text),
                });
            } else {
                not_covered.push(NotCovered {
                    app: app.id().to_owned(),
                    name: line.name,
                    reason: line.text,
                    alternative: self.alternative_handoff(&app),
                });
            }
        }

        let importing: u32 = progress.iter().map(|app| app.importing).sum();
        let status = if importing > 0 {
            ReportStatus::InProgress
        } else if progress.is_empty() {
            ReportStatus::NotStarted
        } else {
            ReportStatus::Done
        };
        let next_step = match status {
            ReportStatus::InProgress => format!(
                "{importing} items are still copying in. Tell the person what has come in so far, \
                 then call SetupGetStatus again."
            ),
            ReportStatus::NotStarted => {
                "Nothing has been imported yet. Call SetupGetState for the next step.".to_owned()
            }
            ReportStatus::Done => format!(
                "Report to the person: what came in (a table with links), what didn't and why, \
                 what stays connected (stays_connected), and what isn't imported yet with the \
                 alternatives under not_covered. Don't offer to copy anything in yourself; \
                 Macro's import does the copying. Looking through Notion or Linear again for more \
                 isn't available yet, so don't promise it; a specific Notion page can still come in \
                 by URL with ImportNotionPage. Then tell them their workspace is ready at {}.",
                self.link("/app")
            ),
        };
        Ok(SetupReport {
            setup_id: Self::setup_id(user),
            status,
            progress,
            imported,
            not_imported,
            not_covered,
            stays_connected,
            next_step,
        })
    }

    /// The Macro page for what setup does not cover, when there is one.
    fn alternative_handoff(&self, app: &App) -> Option<Handoff> {
        let (kind, path, user_will_see) = match app.support() {
            Some(Support::Import(ImportSource::Slack)) => (
                HandoffKind::UploadArchive,
                "/app/settings/team",
                "Macro's team settings, where a workspace admin uploads the ZIP from Slack's \
                 export page.",
            ),
            Some(Support::ImportLater(Kind::Crm)) => (
                HandoffKind::CsvImport,
                "/app/companies",
                "Macro's CRM companies view, with an Import button that takes a CSV with name \
                 and domain columns. CRM may need turning on in Settings first.",
            ),
            _ => return None,
        };
        Some(Handoff {
            app: app.id().to_owned(),
            kind,
            url: self.link(path),
            expires_at: None,
            user_will_see: user_will_see.to_owned(),
            resume: "This is optional and happens outside setup; the person can do it any time."
                .to_owned(),
        })
    }
}

/// What is missing and the one step to take next, given the setup's apps.
fn next_step(no_apps_named: bool, inbox: &[String], apps: &[AppSummary]) -> (Vec<String>, String) {
    let mut missing = Vec::new();
    if inbox.is_empty() {
        missing.push("Gmail inbox is not connected".to_owned());
    }
    for app in apps {
        if app.stage == AppStage::NotConnected && app.support != SupportKind::Inbox {
            missing.push(format!("{} is not connected", app.name));
        }
    }

    let ids = |stage: AppStage| -> Vec<String> {
        apps.iter()
            .filter(|app| app.stage == stage)
            .map(|app| app.app.clone())
            .collect()
    };
    let to_connect: Vec<String> = apps
        .iter()
        .filter(|app| {
            app.stage == AppStage::NotConnected
                && matches!(
                    app.support,
                    SupportKind::Import
                        | SupportKind::Inbox
                        | SupportKind::ImportLater
                        | SupportKind::Keep
                )
        })
        .map(|app| app.app.clone())
        .collect();
    let names = |kinds: &[SupportKind]| -> Vec<String> {
        apps.iter()
            .filter(|app| kinds.contains(&app.support))
            .map(|app| app.name.clone())
            .collect()
    };
    let kept = names(&[SupportKind::Keep]);
    let later = names(&[SupportKind::ImportLater]);
    let not_importable = names(&[SupportKind::ConnectOnly, SupportKind::Unsupported]);
    let to_discover = ids(AppStage::Connected);
    let discovering = ids(AppStage::Discovering);
    let ready = ids(AppStage::ReadyForPlan);
    let importing = ids(AppStage::Importing);

    let step = if no_apps_named && apps.is_empty() {
        "Find out which tools the person uses: check your other connected tools (docs, task \
         trackers, chat, CRM, email, calendar, file storage) and ask only if you can't tell. Then \
         call SetupGetState(apps: [...]) with them."
            .to_owned()
    } else if !to_connect.is_empty() {
        format!(
            "Call SetupConnect(apps: [{}]) and show the person every link in one message.",
            quoted_list(&to_connect)
        )
    } else if !to_discover.is_empty() {
        format!(
            "Call SetupConnect(apps: [{}]): they're connected, and that starts Macro looking \
             through them.",
            quoted_list(&to_discover)
        )
    } else if !discovering.is_empty() {
        format!(
            "Call SetupDiscover(apps: [{}]). It waits for Macro to finish looking and returns \
             what it found.",
            quoted_list(&discovering)
        )
    } else if !ready.is_empty() {
        missing.push("The plan is not approved yet".to_owned());
        format!(
            "Call SetupDiscover(apps: [{}]) to see the candidates, then turn the person's \
             preferences into one plan with SetupProposePlan and ask for one approval.",
            quoted_list(&ready)
        )
    } else if !importing.is_empty() {
        "Items are copying in. Call SetupGetStatus; it waits for progress and returns the report."
            .to_owned()
    } else if apps.iter().any(|app| app.imported > 0 || app.failed > 0) {
        "Setup is done. Call SetupGetStatus for the final report and share it with the person."
            .to_owned()
    } else if !kept.is_empty() || !later.is_empty() || !not_importable.is_empty() {
        let mut told = Vec::new();
        if !kept.is_empty() {
            told.push(format!(
                "{} {} where {} {}: Macro works with {} live and copies nothing in.",
                joined(&kept),
                if kept.len() == 1 { "stays" } else { "stay" },
                if kept.len() == 1 { "it" } else { "they" },
                if kept.len() == 1 { "is" } else { "are" },
                if kept.len() == 1 { "it" } else { "them" },
            ));
        }
        if !later.is_empty() {
            told.push(format!(
                "Macro can't import {} yet; once connected, running setup again brings {} in as \
                 soon as it can.",
                joined(&later),
                if later.len() == 1 { "it" } else { "them" },
            ));
        }
        if !not_importable.is_empty() {
            told.push(format!(
                "Macro can't import {}; give the alternative in each app's note.",
                joined(&not_importable)
            ));
        }
        let importable: Vec<String> = catalog::importable()
            .into_iter()
            .map(|app| App::Known(app).name())
            .collect();
        format!(
            "Tell the person plainly: {} Macro imports {} today; ask whether they use any of \
             those. Don't copy their files or records in yourself.",
            told.join(" "),
            joined(&importable)
        )
    } else {
        "Nothing is left to set up for these apps. Tell the person what's ready, and call \
         SetupGetStatus for the report."
            .to_owned()
    };
    (missing, step)
}

/// The next step after discovery.
fn discovery_next_step(results: &[AppDiscovery]) -> String {
    let discovering: Vec<String> = results
        .iter()
        .filter(|app| app.status == DiscoveryStatus::Discovering)
        .map(|app| app.app.clone())
        .collect();
    let not_connected: Vec<String> = results
        .iter()
        .filter(|app| {
            matches!(
                app.status,
                DiscoveryStatus::NotConnected | DiscoveryStatus::NotStarted
            )
        })
        .map(|app| app.app.clone())
        .collect();
    if !discovering.is_empty() {
        return format!(
            "Macro is still looking through {}. Call SetupDiscover(apps: [{}]) again; it waits \
             for results.",
            discovering.join(" and "),
            quoted_list(&discovering)
        );
    }
    if !not_connected.is_empty() {
        return format!(
            "Connect these first: call SetupConnect(apps: [{}]) and show the person the links.",
            quoted_list(&not_connected)
        );
    }
    if results
        .iter()
        .any(|app| app.status == DiscoveryStatus::Ready)
    {
        return "Collect the person's choices into one plan: call SetupProposePlan with a \
                selection per app (all: true, or the refs they want), declined refs for anything \
                they said no to, and other_apps for tools setup doesn't import. Ask about \
                anything truly ambiguous in the same message as the plan, not before."
            .to_owned();
    }
    "There is nothing new to import. Call SetupGetStatus and report to the person.".to_owned()
}
