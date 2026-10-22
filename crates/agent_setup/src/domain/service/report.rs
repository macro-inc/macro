//! The final report: what came in, what didn't and why, and what stays
//! connected.

use std::time::Duration;

use std::collections::HashSet;

use import::domain::models::{ImportSource, ImportStatus, NotionDecision};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::AgentSetupService;
use crate::domain::{
    catalog::{self, App, Kind, Support},
    models::{
        AppNote, AppProgress, Handoff, HandoffKind, NotCovered, ReportItem, ReportStatus,
        SetupReport,
    },
    plan::{self, Group},
    ports::Result,
    view::{self, SourceView},
};

impl AgentSetupService {
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
            // A Notion import is a tree: its top items stand for the rest.
            let imported_ids: HashSet<Uuid> = view
                .rows
                .iter()
                .filter(|row| row.status == ImportStatus::Imported)
                .map(|row| row.id)
                .collect();
            let is_top = |row: &import::domain::models::ImportEntity| {
                row.parent_id
                    .is_none_or(|parent| !imported_ids.contains(&parent))
            };
            for row in &view.rows {
                let by_hand = view::notion_plan(row)
                    .filter(|plan| plan.decision == Some(NotionDecision::Hand));
                match row.status {
                    ImportStatus::Staged if by_hand.is_some() => not_imported.push(ReportItem {
                        app: app.clone(),
                        title: view::title(row),
                        link: None,
                        reason: Some(match by_hand.and_then(|plan| plan.reason) {
                            Some(reason) => {
                                format!("bring it over by hand: {}", view::reason(&reason))
                            }
                            None => "bring it over by hand".to_owned(),
                        }),
                    }),
                    ImportStatus::Imported if !is_top(row) => {}
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
        // Setup is done only when nothing named is still connecting, being
        // looked through or waiting for a plan, or the person approved a plan
        // that brings nothing in. This is the one place that records it.
        let finished = importing == 0
            && (self.accounts.status(user).await?.setup_done
                || self.assess(user, named_apps).await?.1);
        let status = if importing > 0 {
            ReportStatus::InProgress
        } else if finished {
            ReportStatus::Done
        } else {
            ReportStatus::NotStarted
        };
        let next_step = match status {
            ReportStatus::InProgress => format!(
                "{importing} items are still copying in. Call SetupGetStatus again; it waits."
            ),
            ReportStatus::NotStarted => "Setup isn't finished. Call SetupGetState with the same \
                                         apps and follow its next_step."
                .to_owned(),
            ReportStatus::Done => {
                self.accounts.finish(user).await?;
                format!(
                    "Report to the person: a table of what came in with links (or, if nothing \
                     did, what's connected), what didn't and why, stays_connected, and \
                     not_covered with its alternatives. Don't copy \
                     anything in yourself; running setup again looks through Notion, Linear and \
                     Slack for anything new. Name one thing to open first and end with their workspace: {}. Setup is done. \
                     Then, in one message, offer: this week's meetings (ListCalendarEvents); one \
                     routine that writes only to them, such as a Monday summary of what changed \
                     (check ListRoutines, then CreateRoutine with their time zone, only if they \
                     say yes); and the people from their tools they work with, to invite \
                     themselves at {}.",
                    self.link("/app"),
                    self.link("/app/settings/team-members")
                )
            }
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
                "/app/settings/team-connections",
                "Macro's team connections settings, where a team admin uploads the ZIP from \
                 Slack's export page under Import from Slack, where Macro offers it.",
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
