//! The one plan the person approves: what comes in, what is left out, and
//! what setup does not cover — rendered so the agent can show it as written.

#[cfg(test)]
mod test;

use std::collections::HashSet;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use import::domain::models::{
    ImportEntity, ImportKind, ImportSource, ImportStatus, NotionDecision, NotionSharing,
    NotionWriteChoices,
};
use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    catalog::{self, App, Kind, Support},
    models::{PlanRequest, Selection},
    ports::{Result, SetupError},
    view::{self, SourceView},
};

/// How many titles a plan lists per app before summarizing the rest.
const TITLES_SHOWN: usize = 12;

/// What one app's selection resolved to.
#[derive(Debug, Clone)]
pub struct ResolvedApp<'a> {
    /// The source.
    pub source: ImportSource,
    /// Staged rows to copy in now.
    pub to_import: Vec<&'a ImportEntity>,
    /// Selected rows already copying in or already in Macro.
    pub underway: Vec<&'a ImportEntity>,
    /// Staged rows the person declined.
    pub declined: Vec<&'a ImportEntity>,
}

impl ResolvedApp<'_> {
    /// Ids to hand to the import service.
    pub fn import_ids(&self) -> impl Iterator<Item = Uuid> + '_ {
        self.to_import.iter().map(|row| row.id)
    }
}

/// The plan's id: a digest of who asked for what and exactly which rows that
/// covers. The same plan always gets the same id, so approving and importing
/// can be retried safely; rows already copying in still count, so a retried
/// import matches. If discovery finds more rows after the person approved, the
/// id changes and the agent has to show the new plan first.
pub fn plan_id(
    user: &MacroUserIdStr<'static>,
    request: &PlanRequest,
    resolved: &[ResolvedApp<'_>],
) -> String {
    let mut selections: Vec<String> = request
        .selections
        .iter()
        .map(|selection| {
            let app = catalog::resolve(&selection.app)
                .map(|app| app.id().to_owned())
                .unwrap_or_default();
            let mut refs: Vec<String> = selection
                .refs
                .iter()
                .map(|r| r.trim().to_lowercase())
                .collect();
            refs.sort();
            refs.dedup();
            format!("{app}:{}:{}", selection.all, refs.join(","))
        })
        .collect();
    selections.sort();
    let mut declined: Vec<String> = request
        .declined
        .iter()
        .map(|r| r.trim().to_lowercase())
        .collect();
    declined.sort();
    declined.dedup();

    let mut rows: Vec<String> = resolved
        .iter()
        .flat_map(|app| app.to_import.iter().chain(app.underway.iter()))
        .map(|row| row.id.simple().to_string())
        .collect();
    rows.sort();
    rows.dedup();

    let mut hasher = Sha256::new();
    hasher.update(user.as_ref().as_bytes());
    hasher.update(b"\n");
    hasher.update(selections.join(";").as_bytes());
    hasher.update(b"\n");
    hasher.update(
        request
            .notion_sharing
            .map(|sharing| sharing.as_ref().to_owned())
            .unwrap_or_default()
            .as_bytes(),
    );
    hasher.update(b"\n");
    hasher.update(declined.join(",").as_bytes());
    hasher.update(b"\n");
    hasher.update(rows.join(",").as_bytes());
    let digest = URL_SAFE_NO_PAD.encode(hasher.finalize());
    format!("plan_{}", &digest[..12])
}

/// Whether `reference` (a ref SetupDiscover returned) points at `row`.
pub fn matches_ref(row: &ImportEntity, reference: &str) -> bool {
    let reference = reference.trim().to_lowercase();
    !reference.is_empty() && row.id.simple().to_string().starts_with(&reference)
}

/// Resolves one selection against the source's rows. A Notion plan item
/// stands for everything under it, both when picked and when declined.
pub fn resolve_selection<'a>(
    view: &SourceView<'a>,
    selection: &Selection,
    declined: &[String],
) -> Result<ResolvedApp<'a>> {
    let app_name = catalog::source_name(view.source);
    let is_declined = |row: &ImportEntity| declined.iter().any(|r| matches_ref(row, r));
    // Any item can be declined, a Notion sub-page too; it takes everything
    // under it along.
    let declined_rows: Vec<&'a ImportEntity> = view
        .staged()
        .copied()
        .filter(|row| is_declined(row))
        .collect();
    let said_no: HashSet<Uuid> = declined_rows
        .iter()
        .flat_map(|row| view.with_everything_under(row))
        .map(|row| row.id)
        .collect();

    let mut resolved = ResolvedApp {
        source: view.source,
        to_import: Vec::new(),
        underway: Vec::new(),
        declined: declined_rows,
    };

    if selection.all {
        resolved.to_import = view
            .staged()
            .copied()
            .filter(|row| !said_no.contains(&row.id))
            .collect();
        resolved.underway = view
            .rows
            .iter()
            .copied()
            .filter(|row| matches!(row.status, ImportStatus::Importing | ImportStatus::Imported))
            .collect();
    } else {
        for reference in &selection.refs {
            let matches: Vec<&ImportEntity> = view
                .rows
                .iter()
                .copied()
                .filter(|row| row.status != ImportStatus::Discarded && matches_ref(row, reference))
                .collect();
            let row = match matches.as_slice() {
                [row] => *row,
                [] => {
                    let valid: Vec<String> =
                        view.choices().into_iter().map(view::reference).collect();
                    return Err(SetupError::Actionable(format!(
                        "No {app_name} candidate has ref \"{reference}\". Use the refs \
                         SetupDiscover returned for {app_name}: {}.",
                        if valid.is_empty() {
                            "there are none waiting".to_owned()
                        } else {
                            valid.join(", ")
                        }
                    )));
                }
                _ => {
                    return Err(SetupError::Actionable(format!(
                        "The ref \"{reference}\" matches more than one {app_name} candidate. Use \
                         the full ref SetupDiscover returned."
                    )));
                }
            };
            if is_declined(row) {
                continue;
            }
            match row.status {
                ImportStatus::Staged => resolved.to_import.extend(
                    view.with_everything_under(row)
                        .into_iter()
                        .filter(|row| !said_no.contains(&row.id)),
                ),
                ImportStatus::Importing | ImportStatus::Imported => resolved.underway.push(row),
                ImportStatus::Discarded => {}
            }
        }
        // The same ref can be given twice, in any order; each row counts once.
        let mut seen = HashSet::new();
        resolved.to_import.retain(|row| seen.insert(row.id));
        let mut seen = HashSet::new();
        resolved.underway.retain(|row| seen.insert(row.id));
    }
    Ok(resolved)
}

/// Whether a Notion item the plan copies ends up shared with the person's
/// team, given the sharing they chose (none: the plan's own choice).
pub fn notion_shared(row: &ImportEntity, sharing: Option<NotionSharing>) -> bool {
    let Some(plan) = view::notion_plan(row) else {
        return false;
    };
    match sharing {
        Some(NotionSharing::Team) => plan.shared || plan.shareable,
        Some(NotionSharing::Personal) => false,
        Some(NotionSharing::Ai) | None => plan.shared,
    }
}

/// What the Notion write is told: everything it would copy that the person
/// didn't approve (`excluded`), and where their sharing differs from the
/// plan's.
pub fn notion_choices(
    app: &ResolvedApp<'_>,
    excluded: Vec<Uuid>,
    sharing: Option<NotionSharing>,
) -> NotionWriteChoices {
    let mut choices = NotionWriteChoices {
        excluded,
        ..NotionWriteChoices::default()
    };
    for row in &app.to_import {
        let planned = view::notion_plan(row).is_some_and(|plan| plan.shared);
        match (planned, notion_shared(row, sharing)) {
            (false, true) => choices.shared.push(row.id),
            (true, false) => choices.personal.push(row.id),
            _ => {}
        }
    }
    choices
}

/// The import app a selection names, or an error the agent can act on.
pub fn selection_source(selection: &Selection) -> Result<ImportSource> {
    let app = catalog::resolve(&selection.app).ok_or_else(|| {
        SetupError::Actionable(
            "A selection is missing its app. Name the app, e.g. \"notion\".".to_owned(),
        )
    })?;
    app.import_source().ok_or_else(|| {
        SetupError::Actionable(format!(
            "{} isn't imported during setup, so it can't be part of the import selections. \
             Mention it under other_apps instead and the plan will say what happens with it.",
            app.name()
        ))
    })
}

fn list_titles(rows: &[&ImportEntity]) -> String {
    let mut titles: Vec<String> = rows.iter().map(|row| view::title(row)).collect();
    titles.sort();
    let shown = titles
        .iter()
        .take(TITLES_SHOWN)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    match titles.len().saturating_sub(TITLES_SHOWN) {
        0 => shown,
        more => format!("{shown} and {more} more"),
    }
}

fn noun(source: ImportSource, count: usize) -> &'static str {
    let (one, many) = catalog::for_source(source).items;
    if count == 1 { one } else { many }
}

/// Where a tool setup doesn't import goes in the plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Group {
    /// A tool the person keeps: it stays connected and Macro works with it
    /// live.
    Keep,
    /// A tool they're leaving that Macro can't import yet.
    Later,
    /// Anything else setup doesn't bring in.
    Other,
}

/// A line for something setup does not bring over.
#[derive(Debug, Clone)]
pub struct NotCoveredLine {
    /// Display name.
    pub name: String,
    /// What happens with it, including any link.
    pub text: String,
    /// Where it goes in the plan.
    pub group: Group,
}

/// What Notion's planner said about the workspace beyond what it copies.
#[derive(Debug, Clone, Default)]
pub struct NotionNotes {
    /// Objects it leaves in Notion.
    pub left_in_notion: u32,
    /// Objects that need bringing over by hand, by title.
    pub by_hand: Vec<String>,
    /// Objects a teammate already brought into Macro, which the import links
    /// to instead of copying.
    pub already_in_macro: u32,
    /// Whether the person is on a team.
    pub on_team: bool,
    /// Who sees what comes in, as the person chose (none: the plan's choice).
    pub sharing: Option<NotionSharing>,
}

/// Everything the plan text needs.
pub struct PlanText<'a> {
    /// What comes in, per app.
    pub apps: &'a [ResolvedApp<'a>],
    /// Notion's planner notes, when Notion is in the plan.
    pub notion: Option<&'a NotionNotes>,
    /// What the person asked for, in their words.
    pub scope_notes: Option<&'a str>,
    /// What setup does not bring over.
    pub not_covered: &'a [NotCoveredLine],
    /// Connected inbox addresses.
    pub inbox: &'a [String],
}

/// Renders the plan for the person.
pub fn render(plan: &PlanText<'_>) -> String {
    let mut text = String::from("**Your Macro setup plan**\n");
    if let Some(notes) = plan
        .scope_notes
        .map(str::trim)
        .filter(|notes| !notes.is_empty())
    {
        text.push_str(&format!("_You asked for: {notes}_\n"));
    }

    text.push_str("\n**Bring into Macro**\n");
    let mut any = false;
    let mut shared_from_notion = 0usize;
    for app in plan.apps {
        let name = catalog::source_name(app.source);
        if app.source == ImportSource::Notion && !app.to_import.is_empty() {
            any = true;
            let notes = plan.notion.cloned().unwrap_or_default();
            shared_from_notion = app
                .to_import
                .iter()
                .filter(|row| notion_shared(row, notes.sharing))
                .count();
            text.push_str(&notion_line(app, &notes, shared_from_notion));
        } else if !app.to_import.is_empty() {
            any = true;
            text.push_str(&format!(
                "- **{name}**: {} {}: {}{}\n",
                app.to_import.len(),
                noun(app.source, app.to_import.len()),
                list_titles(&app.to_import),
                if app.source == ImportSource::Slack {
                    " (the channels and who's in them, not their messages)"
                } else {
                    ""
                }
            ));
        }
        if !app.underway.is_empty() {
            text.push_str(&format!(
                "- **{name}**: {} already in Macro or on the way\n",
                app.underway.len()
            ));
        }
    }
    if !any {
        text.push_str("- Nothing new\n");
    }
    if plan
        .apps
        .iter()
        .any(|app| app.source == ImportSource::Linear && !app.to_import.is_empty())
    {
        text.push_str(
            "_From Linear, Macro brings open issues updated in the last 90 days, as tasks: the \
             whole workspace's if you're a Linear admin, otherwise yours._\n",
        );
    }

    let declined: Vec<&ImportEntity> = plan
        .apps
        .iter()
        .flat_map(|app| app.declined.iter().copied())
        .collect();
    if !declined.is_empty() {
        text.push_str(&format!(
            "\n**Leave out** (you can still bring these in later): {}\n",
            list_titles(&declined)
        ));
    }

    let lines = |group: Group| {
        plan.not_covered
            .iter()
            .filter(move |line| line.group == group)
    };
    let mut kept: Vec<String> = Vec::new();
    if !plan.inbox.is_empty() {
        kept.push(format!(
            "- **Email**: your inbox ({}) is connected\n",
            plan.inbox.join(", ")
        ));
    }
    kept.extend(lines(Group::Keep).map(|line| format!("- **{}**: {}\n", line.name, line.text)));
    if !kept.is_empty() {
        text.push_str("\n**Stays connected** (Macro works with these live)\n");
        text.push_str(&kept.concat());
    }
    for (group, heading) in [
        (Group::Later, "Not imported yet"),
        (Group::Other, "Not brought in by setup"),
    ] {
        if lines(group).next().is_some() {
            text.push_str(&format!("\n**{heading}**\n"));
            for line in lines(group) {
                text.push_str(&format!("- **{}**: {}\n", line.name, line.text));
            }
        }
    }

    let slack = plan
        .apps
        .iter()
        .any(|app| app.source == ImportSource::Slack && !app.to_import.is_empty());
    let mut shared: Vec<&str> = Vec::new();
    if slack {
        shared.push("Slack channels come in as team channels, with teammates already in Macro");
    }
    if shared_from_notion > 0 {
        shared.push("the Notion items marked shared go to your team");
    }
    text.push_str(&if shared.is_empty() {
        "\nEverything stays private to you. Setup doesn't share anything, invite anyone, send \
         email or change billing.\n"
            .to_owned()
    } else {
        format!(
            "\n{}; everything else stays private to you. Setup doesn't invite anyone, send email \
             or change billing.\n",
            capitalized(&shared.join(", and "))
        )
    });
    text
}

fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// The Notion line: what the planner's copy of the workspace becomes.
fn notion_line(app: &ResolvedApp<'_>, notes: &NotionNotes, shared: usize) -> String {
    let (mut pages, mut databases, mut rows, mut task_lists, mut tasks) = (0, 0, 0u32, 0, 0u32);
    for row in &app.to_import {
        let Some(plan) = view::notion_plan(row) else {
            pages += 1;
            continue;
        };
        match (plan.decision, row.kind) {
            (Some(NotionDecision::Tasks), _) => {
                task_lists += 1;
                tasks += plan.rows.unwrap_or_default();
            }
            (_, ImportKind::Database | ImportKind::DataSource) => {
                databases += 1;
                rows += plan.rows.unwrap_or_default();
            }
            _ => pages += 1,
        }
    }
    let mut parts: Vec<String> = Vec::new();
    if pages > 0 {
        parts.push(format!(
            "{pages} {} as documents in folders like Notion's",
            if pages == 1 { "page" } else { "pages" }
        ));
    }
    if databases > 0 {
        parts.push(format!(
            "{databases} {} with {rows} rows",
            if databases == 1 {
                "database"
            } else {
                "databases"
            }
        ));
    }
    if task_lists > 0 {
        parts.push(format!(
            "{task_lists} task {} as {tasks} Macro tasks",
            if task_lists == 1 { "list" } else { "lists" }
        ));
    }
    let tops: Vec<&ImportEntity> = {
        let picked: HashSet<Uuid> = app.to_import.iter().map(|row| row.id).collect();
        app.to_import
            .iter()
            .copied()
            .filter(|row| row.parent_id.is_none_or(|parent| !picked.contains(&parent)))
            .collect()
    };
    let mut line = format!(
        "- **Notion**: your workspace, as Macro's planner sorted it: {}. Top level: {}\n",
        parts.join(", "),
        list_titles(&tops)
    );
    if notes.already_in_macro > 0 {
        line.push_str(&format!(
            "  - {} already brought in by teammates; these link to their copy\n",
            notes.already_in_macro
        ));
    }
    if notes.left_in_notion > 0 {
        line.push_str(&format!(
            "  - {} left in Notion (empty, archived or not worth copying)\n",
            notes.left_in_notion
        ));
    }
    if !notes.by_hand.is_empty() {
        line.push_str(&format!(
            "  - To bring over by hand: {}\n",
            notes.by_hand.join(", ")
        ));
    }
    if notes.on_team {
        let how = match notes.sharing {
            Some(NotionSharing::Team) => "you chose to share everything",
            Some(NotionSharing::Personal) => "you chose to keep it all to yourself",
            Some(NotionSharing::Ai) | None => "Macro chose per page",
        };
        line.push_str(&format!(
            "  - Shared with your team: {shared} of {} ({how})\n",
            app.to_import.len()
        ));
    }
    line
}

/// What setup says about an app it does not import, with a link when there
/// is one. `None` for apps setup covers fully.
pub fn not_covered(app: &App, base_url: &str) -> Option<NotCoveredLine> {
    let name = app.name();
    let (group, text) = match app {
        App::Known(known) => match known.support {
            Support::Inbox(_) => return None,
            Support::Import(ImportSource::Slack) => (
                Group::Other,
                format!(
                    "setup brings the channels, not their messages. For message history, a team \
                     admin uploads Slack's export ZIP at {base_url}/app/settings/team-connections \
                     (Import from Slack), where Macro offers it"
                ),
            ),
            Support::Import(_) => return None,
            Support::ImportLater(kind) => {
                let items = known.items.1;
                let mut text = format!(
                    "Macro can't import {name} yet. Once it's connected, running setup again \
                     brings its {items} in when it can"
                );
                if kind == Kind::Crm {
                    text.push_str(&format!(
                        ". Until then, companies can come in from a CSV with name and domain \
                         columns at {base_url}/app/companies (turn on CRM in Settings first)"
                    ));
                }
                (Group::Later, text)
            }
            Support::Keep => (
                Group::Keep,
                "stays where it is. Once it's connected, Macro and its agents work with it live; \
                 nothing is copied in"
                    .to_owned(),
            ),
            Support::KeepInMacro(note) => (Group::Keep, note.to_owned()),
        },
        App::Other(_) => (
            Group::Other,
            format!(
                "Macro can't import {name} yet. You can drag exported files into Macro yourself, \
                 or keep using {name} alongside it"
            ),
        ),
    };
    Some(NotCoveredLine { name, text, group })
}
