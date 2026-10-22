//! Agent-led setup: the six steps an agent walks through to set up a person's
//! Macro workspace, each a thin layer over services Macro already has.
//!
//! The service decides nothing on the import service's behalf — what a
//! listing or Notion's planner finds and how an item is copied stay theirs. It
//! sequences the steps, keeps every one idempotent, and turns the state into
//! one `next_step` an agent can follow without reading anything else.

mod discover;
mod next_step;
mod report;
#[cfg(test)]
mod test;

use std::{collections::HashSet, sync::Arc, time::Duration};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use import::domain::models::{ImportSource, ImportState, ImportStatus, NotionSharing, RunStatus};
use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use self::next_step::quoted_list;
use super::{
    catalog::{self, App, MailProvider, Support},
    models::{
        AccountSummary, AppNote, AppStage, AppSummary, ConnectResult, Handoff, HandoffKind,
        ImportStarted, InboxSummary, PlanRequest, ProposedPlan, SetupId, SetupState, SupportKind,
    },
    plan::{self, NotCoveredLine, PlanText, ResolvedApp},
    ports::{
        AccountStatus, Inbox, Result, SetupAccounts, SetupConnections, SetupError, SetupImports,
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

fn support_kind(app: &App, connectable: bool) -> SupportKind {
    match app.support() {
        Some(Support::Inbox(_)) => SupportKind::Inbox,
        Some(Support::Import(_)) => SupportKind::Import,
        Some(Support::ImportLater(_)) => SupportKind::ImportLater,
        Some(Support::Keep | Support::KeepInMacro(_)) => SupportKind::Keep,
        None if connectable => SupportKind::ConnectOnly,
        None => SupportKind::Unsupported,
    }
}

/// Whether an inbox from `provider` is connected.
fn has_inbox(inboxes: &[Inbox], provider: MailProvider) -> bool {
    inboxes.iter().any(|inbox| inbox.provider == provider)
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
        let provider = match app.support() {
            Some(Support::Inbox(provider)) => Some(provider),
            _ => None,
        };
        let is_inbox = provider.is_some();
        let name = app.name();
        // The connect page connects the slug in its path.
        let url = format!(
            "{}/app/connect/{}?account={}&expires={}",
            self.config.app_base_url,
            app.connect_slug().unwrap_or(app.id()),
            urlencoding::encode(&Self::email(user)),
            expires_at.timestamp()
        );
        let user_will_see = if let Some(provider) = provider {
            let provider = match provider {
                MailProvider::Gmail => "Google",
                MailProvider::Outlook => "Microsoft",
            };
            format!(
                "A Macro page, then {provider} asking to let Macro read and send their {name} \
                 mail and see their calendar. They may be asked to sign in to Macro first, with \
                 the same Google account."
            )
        } else {
            format!(
                "A Macro page that opens {name}'s own screen to choose what Macro can read. They \
                 may be asked to sign in to Macro first, with the same Google account."
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
        inboxes: &[Inbox],
    ) -> Result<Vec<AppFacts<'a>>> {
        let mut facts = Vec::with_capacity(apps.len());
        for app in apps {
            let connected = match app.support() {
                Some(Support::Inbox(provider)) => has_inbox(inboxes, provider),
                // Connected inside Macro (Calendar with the email link, GitHub
                // in settings), which setup can't see.
                Some(Support::KeepInMacro(_)) => false,
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

    /// Whether the workspace counts as set up: onboarded on the web, setup
    /// reached its final report, or work already brought in.
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
        if account.onboarded_on_web || account.setup_done {
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
        Ok(self.assess(user, named_apps).await?.0)
    }

    /// The setup state, and whether nothing is left for setup to do.
    async fn assess(
        &self,
        user: &MacroUserIdStr<'static>,
        named_apps: &[String],
    ) -> Result<(SetupState, bool)> {
        let account = self.accounts.status(user).await?;
        let inboxes = self.inbox.inboxes(user).await?;
        let import_state = self.imports.state(user).await?;
        let apps = self.apps_in_scope(named_apps, &import_state, user);
        let facts = self.facts(user, apps, &import_state, &inboxes).await?;

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
                    Some(Support::Inbox(_)) => AppStage::NotConnected,
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

        let step = next_step::after_state(
            named_apps.is_empty(),
            &summaries,
            account.has_team,
            &self.link("/app/settings/team"),
        );
        let addresses: Vec<String> = inboxes.into_iter().map(|inbox| inbox.address).collect();
        let state = SetupState {
            setup_id: Self::setup_id(user),
            account: AccountSummary {
                email: Self::email(user),
                agent_led: account.agent_led,
                onboarded_on_web: account.onboarded_on_web,
            },
            inbox: InboxSummary {
                connected: !addresses.is_empty(),
                addresses,
            },
            apps: summaries,
            missing: step.missing,
            next_step: step.next_step,
        };
        Ok((state, step.finished))
    }

    /// Whether the person can connect the app to Macro: import apps and the
    /// Google account always; anything else when the connector directory
    /// offers it.
    async fn connectable(&self, app: &App, connected: bool) -> Result<bool> {
        Ok(match app.support() {
            Some(Support::Import(_) | Support::Inbox(_) | Support::KeepInMacro(_)) => true,
            _ if connected => true,
            _ => match app.connect_slug() {
                Some(slug) => self.connections.directory_name(slug).await?.is_some(),
                None => false,
            },
        })
    }

    /// One link per app still to connect, and Macro starts looking through
    /// apps that are already connected, so the agent calls it again once the
    /// person has used the links. Hands setup to the agent first, so opening a
    /// Macro page never drops the person into the web onboarding.
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
        self.accounts.hand_to_agent(user).await?;
        let has_team = self.accounts.status(user).await?.has_team;
        let inboxes = self.inbox.inboxes(user).await?;

        let mut handoffs = Vec::new();
        let mut already_connected = Vec::new();
        let mut not_connectable = Vec::new();
        let mut looking = Vec::new();
        for app in apps {
            match app.support() {
                Some(Support::Inbox(provider)) => {
                    if !has_inbox(&inboxes, provider) {
                        handoffs.push(self.connect_handoff(user, &app));
                    } else {
                        already_connected.push(app.id().to_owned());
                    }
                }
                Some(Support::KeepInMacro(_)) => not_connectable.push(AppNote {
                    app: app.id().to_owned(),
                    note: plan::not_covered(&app, &self.config.app_base_url)
                        .map(|line| format!("{}. There is no link for it in setup.", line.text))
                        .unwrap_or_default(),
                }),
                Some(Support::Import(source)) => {
                    if self.connections.is_connected(user, &app).await? {
                        already_connected.push(app.id().to_owned());
                        if self.start_looking(user, source, has_team).await? {
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
    /// is or something is waiting for the plan. `true` when a look-through is
    /// running now. Notion gets a plan of the whole workspace from Notion's
    /// planner; Linear and Slack are listed. Looking again after an import
    /// finds what is new.
    async fn start_looking(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        has_team: bool,
    ) -> Result<bool> {
        let state = self.imports.state(user).await?;
        let view = SourceView::of(&state, user, source);
        let counts = view.counts();
        let run = view.run;
        let due = match run.map(|run| run.status) {
            None | Some(RunStatus::Failed | RunStatus::Dismissed) => true,
            Some(RunStatus::Ready | RunStatus::Completed) => {
                counts.candidates == 0 && counts.importing == 0
            }
            Some(RunStatus::Running | RunStatus::Importing) => false,
        };
        let launched = if !due {
            false
        } else if source == ImportSource::Notion {
            // Someone on a team chooses who sees each page; the planner
            // suggests it per page and the plan shows the split to approve.
            let sharing = has_team.then_some(NotionSharing::Ai);
            self.imports.plan_notion(user, sharing).await?.status == Some(RunStatus::Running)
        } else {
            self.imports.start_discovery(user, source).await?
        };
        Ok(launched || run.is_some_and(|run| run.status == RunStatus::Running))
    }

    /// What Slack tells the agent when the person has no Macro team yet.
    pub(super) fn slack_needs_team(&self) -> String {
        format!(
            "Slack channels come in as team channels, so they need a Macro team. Send the person \
             to {} to create one, or leave Slack out of the selections and name it under \
             other_apps.",
            self.link("/app/settings/team")
        )
    }

    fn resolve_plan<'a>(
        &self,
        user: &MacroUserIdStr<'static>,
        request: &PlanRequest,
        state: &'a ImportState,
        has_team: bool,
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
            // A plan made while Macro is still looking would change under the
            // person's approval as more candidates arrive.
            if view.run.is_some_and(|run| run.status == RunStatus::Running) {
                let app = catalog::for_source(source).id;
                return Err(SetupError::Actionable(format!(
                    "Macro is still looking through {}. Call SetupDiscover(apps: [\"{app}\"]) and \
                     propose the plan once it has finished.",
                    catalog::source_name(source)
                )));
            }
            if source == ImportSource::Slack && !has_team {
                return Err(SetupError::Actionable(self.slack_needs_team()));
            }
            resolved.push(plan::resolve_selection(
                &view,
                selection,
                &request.declined,
            )?);
        }
        // A declined ref that matches nothing would quietly import the item
        // the person said no to.
        let selected: Vec<ImportSource> = resolved.iter().map(|app| app.source).collect();
        for reference in request
            .declined
            .iter()
            .map(|reference| reference.trim())
            .filter(|reference| !reference.is_empty())
        {
            // Notion's write sets aside what the person declined, so a retried
            // import still knows those refs.
            let known = state.entities.iter().any(|row| {
                row.user_id.as_str() == user.as_ref()
                    && selected.contains(&row.source)
                    && plan::matches_ref(row, reference)
            });
            if !known {
                return Err(SetupError::Actionable(format!(
                    "No candidate in the selected apps has the declined ref \"{reference}\". Use \
                     the refs SetupDiscover returned."
                )));
            }
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
        let account = self.accounts.status(user).await?;
        let state = self.imports.state(user).await?;
        let resolved = self.resolve_plan(user, request, &state, account.has_team)?;
        let inbox: Vec<String> = self
            .inbox
            .inboxes(user)
            .await?
            .into_iter()
            .map(|inbox| inbox.address)
            .collect();
        let not_covered = self.not_covered_lines(request, &resolved);
        let notion = if resolved
            .iter()
            .any(|app| app.source == ImportSource::Notion)
        {
            Some(self.notion_notes(user, request.notion_sharing).await?)
        } else {
            None
        };
        let plan_text = plan::render(&PlanText {
            apps: &resolved,
            notion: notion.as_ref(),
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
                "Show plan_text as written and ask for one approval, then end your turn. On yes, \
                 call SetupImport(plan_id: \"{plan_id}\", approved: true) with the same \
                 selections, declined refs and notion_sharing. If they change anything, call \
                 SetupProposePlan again and show the new plan."
            ),
            plan_id,
            plan_text,
            will_import: u32::try_from(will_import).unwrap_or(u32::MAX),
        })
    }

    /// Everything tied to `review_id` that Notion's write would copy but the
    /// person didn't approve, so a plan that changed since the approval can't
    /// bring in what they never saw. Refuses when the plan moved on.
    async fn notion_exclusions(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ResolvedApp<'_>,
        review_id: Uuid,
    ) -> Result<Vec<Uuid>> {
        let state = self.imports.state(user).await?;
        let view = SourceView::of(&state, user, ImportSource::Notion);
        let approved: HashSet<Uuid> = app.to_import.iter().map(|row| row.id).collect();
        let staged: HashSet<Uuid> = view
            .staged()
            .filter(|row| row.review_id == Some(review_id))
            .map(|row| row.id)
            .collect();
        let ready = view.run.is_none_or(|run| run.status == RunStatus::Ready);
        if !ready || !approved.is_subset(&staged) {
            return Err(SetupError::Actionable(
                "The Notion plan changed since the person approved it. Call SetupDiscover and \
                 SetupProposePlan again, and show them the new plan."
                    .to_owned(),
            ));
        }
        Ok(staged.difference(&approved).copied().collect())
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
        let account = self.accounts.status(user).await?;
        let state = self.imports.state(user).await?;
        let resolved = self.resolve_plan(user, request, &state, account.has_team)?;
        let expected = plan::plan_id(user, request, &resolved);
        if plan_id.trim() != expected {
            return Err(SetupError::Actionable(format!(
                "These selections don't match plan \"{}\", or Macro found more since the person \
                 approved it. Call SetupProposePlan with the person's choices, show them that plan, \
                 and pass its plan_id with exactly the same selections.",
                plan_id.trim()
            )));
        }
        self.accounts.hand_to_agent(user).await?;
        let underway = resolved.iter().map(|app| app.underway.len()).sum::<usize>();
        let mut started = 0u64;
        let mut ids = Vec::new();
        for app in &resolved {
            if app.to_import.is_empty() {
                continue;
            }
            if app.source == ImportSource::Notion {
                // Notion's planner writes its own plan: the folders, documents,
                // databases and tasks, with what the person left out. The plan
                // is tied to its review first, so everything the write can see
                // is read below and either approved or excluded.
                let review_id = self
                    .imports
                    .notion_report(user)
                    .await?
                    .review_id
                    .unwrap_or_else(Uuid::now_v7);
                self.imports.attach_notion_plan(user, review_id).await?;
                let excluded = self.notion_exclusions(user, app, review_id).await?;
                self.imports
                    .write_notion(
                        user,
                        review_id,
                        plan::notion_choices(app, excluded, request.notion_sharing),
                    )
                    .await?;
                started += app.to_import.len() as u64;
            } else {
                ids.extend(app.import_ids());
            }
        }
        if !ids.is_empty() {
            started += self.imports.run_import(user, ids).await?.importing;
        }
        let next_step = if started == 0 && underway == 0 {
            // The person approved bringing nothing in: that ends setup too.
            self.accounts.finish(user).await?;
            format!(
                "Nothing was selected, so nothing is importing. Setup is done: tell the person \
                 and end with their workspace: {}.",
                self.link("/app")
            )
        } else {
            "Call SetupGetStatus with the same apps now; it waits for progress and returns the \
             final report with links. You can tell the person the import started in the same \
             message."
                .to_owned()
        };
        Ok(ImportStarted {
            setup_id: Self::setup_id(user),
            plan_id: expected,
            started: u32::try_from(started).unwrap_or(u32::MAX),
            already_underway: u32::try_from(underway).unwrap_or(u32::MAX),
            next_step,
        })
    }
}
