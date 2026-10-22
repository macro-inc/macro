//! `SetupDiscover`: what Macro found in each connected import app.

use std::time::Duration;

use import::domain::models::{ImportSource, ImportState, NotionSharing, RunStatus};
use macro_user_id::user_id::MacroUserIdStr;

use super::{AgentSetupService, next_step};
use crate::domain::{
    catalog::{self, App, Support},
    models::{AppDiscovery, DiscoverResult, DiscoveryStatus},
    plan::{self, NotionNotes},
    ports::{Result, SetupError},
    view::{self, Counts, SourceView},
};

impl AgentSetupService {
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
        let account = self.accounts.status(user).await?;
        let mut watched: Vec<ImportSource> = Vec::new();
        for app in &apps {
            if let Some(source) = app.import_source()
                && self.connections.is_connected(user, app).await?
            {
                watched.push(source);
            }
        }
        // A look-through that hasn't shown up yet may still be starting (the
        // connection just landed), so wait for it too. Rows without a run
        // (staged from chat, or a page imported by URL) aren't a run starting.
        let state = self
            .wait_while(user, wait, |state| {
                watched.iter().any(|source| {
                    let view = SourceView::of(state, user, *source);
                    match view.run {
                        Some(run) => run.status == RunStatus::Running,
                        None => view.rows.is_empty(),
                    }
                })
            })
            .await?;

        let mut results = Vec::with_capacity(apps.len());
        for app in &apps {
            results.push(
                self.discovery_for(user, app, &state, account.has_team)
                    .await?,
            );
        }
        let next_step = next_step::after_discovery(&results);
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
        has_team: bool,
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
                Some(Support::Inbox(_)) => {
                    format!(
                        "{} is the inbox itself; there is nothing to discover.",
                        app.name()
                    )
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
            Some(RunStatus::Running) => DiscoveryStatus::Discovering,
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
            DiscoveryStatus::AlreadyImported => Some(format!(
                "{} {} came in earlier. SetupConnect(apps: [\"{}\"]) looks again for anything \
                 new.",
                counts.imported + counts.importing,
                catalog::for_source(source).items.1,
                app.id()
            )),
            DiscoveryStatus::Ready => match source {
                ImportSource::Notion => Some(self.notion_note(user).await?),
                ImportSource::Linear => Some(
                    "Macro listed the open issues updated in the last 90 days: the whole \
                     workspace's for a Linear admin, otherwise the person's own. They come in \
                     as tasks."
                        .to_owned(),
                ),
                ImportSource::Slack if !has_team => Some(self.slack_needs_team()),
                ImportSource::Slack => Some(
                    "These channels come in with teammates already in Macro, not their \
                     messages; the plan says how an admin brings history."
                        .to_owned(),
                ),
            },
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

    /// What the agent hears about a ready Notion plan.
    async fn notion_note(&self, user: &MacroUserIdStr<'static>) -> Result<String> {
        let report = self.imports.notion_report(user).await?;
        let mut note = format!(
            "Macro's planner read the whole workspace: {} pages and {} databases. It copies {}, \
             turns {} task lists into tasks and leaves {} in Notion.",
            report.pages, report.data_sources, report.copy, report.tasks, report.skip
        );
        if !report.hand_items.is_empty() {
            note.push_str(&format!(
                " {} need bringing over by hand; the plan lists them.",
                report.hand_items.len()
            ));
        }
        note.push_str(
            " Each candidate is a top-level item and stands for everything under it: decline a \
             ref to leave it out with everything under it.",
        );
        if report.on_team {
            note.push_str(
                " Macro suggested who sees each item and the plan shows how many go to the \
                 team. If the person wants all of it shared or all kept to themselves, pass \
                 notion_sharing (\"team\" or \"personal\").",
            );
        }
        Ok(note)
    }

    /// What Notion's planner says beyond what it copies, for the plan text.
    pub(super) async fn notion_notes(
        &self,
        user: &MacroUserIdStr<'static>,
        sharing: Option<NotionSharing>,
    ) -> Result<NotionNotes> {
        let report = self.imports.notion_report(user).await?;
        Ok(NotionNotes {
            left_in_notion: report.skip,
            by_hand: report
                .hand_items
                .iter()
                .map(|item| item.title.clone())
                .collect(),
            already_in_macro: report.already_in_macro,
            on_team: report.on_team,
            sharing,
        })
    }
}
