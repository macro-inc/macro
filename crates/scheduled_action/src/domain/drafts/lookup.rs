//! Finds the channels, people, folders, labels, tags and agents a person's
//! words name, so a draft can use their ids. The model lists the names; a
//! fixed code step looks them up as the person, with their access, as a dry
//! run that can't write. A name that matches nothing, or several items
//! equally, stays unresolved, and the person picks it when reviewing.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::{CodeIdentity, CodeStep};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::super::ports::{CodeRun, DraftCompletion, DraftModel, OutputSchema, RoutineCode};

#[cfg(test)]
mod test;

/// Most names one draft looks up.
pub const MAX_LOOKUPS: usize = 12;
/// How long the lookup step may take, waiting for a code slot included.
/// Past it, the draft goes on with nothing found.
pub const LOOKUP_TIMEOUT: Duration = Duration::from_secs(20);

const LOOKUP_SOURCE: &str = include_str!("lookup.ts");
const LIST_NAMES: &str = "List the specific items in the person's workspace that their words name and a routine would need the id of: channels, people, folders (projects), email labels, tags and agents. Only names they actually wrote, as they wrote them, without a leading # or @; never guess or add items they didn't name. Return {\"lookups\": [{\"kind\": KIND, \"name\": NAME}]}, [] when they name none.";

/// What kind of item a name is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LookupKind {
    Channel,
    Person,
    Folder,
    Label,
    Tag,
    Agent,
}

/// One name to look up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lookup {
    pub kind: LookupKind,
    pub name: String,
}

/// A name and the items the lookup step found for it.
#[derive(Debug, Clone, Deserialize)]
struct Found {
    kind: LookupKind,
    name: String,
    #[serde(default)]
    matches: Vec<Match>,
}

/// An item whose name contains the one looked up.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Match {
    name: String,
    id: String,
    /// A tag's property definition.
    #[serde(default)]
    definition_id: Option<String>,
}

/// The items found, by name and id, as the model reads them. Saving checks
/// every id a draft uses.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub email_labels: Vec<String>,
    pub tags: Vec<WorkspaceTag>,
    pub channels: Vec<NamedItem>,
    /// Projects.
    pub folders: Vec<NamedItem>,
    pub people: Vec<NamedItem>,
    /// Agents a step may hand the run to.
    pub agents: Vec<WorkspaceAgent>,
}

impl Workspace {
    fn len(&self) -> usize {
        self.email_labels.len()
            + self.tags.len()
            + self.channels.len()
            + self.folders.len()
            + self.people.len()
            + self.agents.len()
    }
}

/// An item and its name.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NamedItem {
    pub name: String,
    pub id: String,
}

/// A tag: one option of a property.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTag {
    pub label: String,
    pub definition_id: String,
    pub option_id: String,
}

/// An agent and its bot id.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceAgent {
    pub name: String,
    pub bot_id: String,
}

/// Look up the items `request` names, as `owner`. Empty when it names none,
/// code can't run here, or the lookup fails or runs out of time; the span
/// says which.
#[tracing::instrument(name = "routine.draft.lookup", skip_all, fields(
    routine.draft.lookups = tracing::field::Empty,
    routine.draft.lookups_resolved = tracing::field::Empty,
    routine.draft.lookup_outcome = tracing::field::Empty,
))]
pub async fn look_up<Code: RoutineCode, Model: DraftModel>(
    code: &Code,
    model: &Model,
    owner: &MacroUserIdStr<'static>,
    request: &str,
    now: DateTime<Utc>,
    turns: &AtomicUsize,
) -> Workspace {
    let span = tracing::Span::current();
    if code.sdk().is_none() {
        span.record("routine.draft.lookup_outcome", "unavailable");
        return Workspace::default();
    }
    let schema = lookups_schema();
    turns.fetch_add(1, Ordering::Relaxed);
    let lookups: Vec<Lookup> = model
        .complete(
            owner,
            DraftCompletion {
                instructions: LIST_NAMES,
                prompt: request,
                schema: &schema,
            },
        )
        .await
        .and_then(|answer| serde_json::from_value(answer.get("lookups")?.clone()).ok())
        .unwrap_or_default();
    let lookups: Vec<Lookup> = lookups
        .into_iter()
        .filter(|lookup| !lookup.name.trim().is_empty())
        .take(MAX_LOOKUPS)
        .collect();
    span.record("routine.draft.lookups", lookups.len());
    if lookups.is_empty() {
        span.record("routine.draft.lookup_outcome", "none_named");
        return Workspace::default();
    }
    let step = CodeStep {
        id: None,
        title: "Look up named items".to_owned(),
        summary: String::new(),
        source: LOOKUP_SOURCE.to_owned(),
        knobs: Vec::new(),
        sentence: None,
    };
    let context = json!({
        "run": { "id": Uuid::now_v7().to_string(), "at": now, "timezone": "UTC", "dryRun": true, "previous": null, "lastSucceededAt": null },
        "routine": { "id": "routine-draft", "name": "Routine draft" },
        "trigger": { "kind": "manual", "by": owner.as_ref() },
        "lookups": lookups,
    });
    let no_steps = json!({});
    let run = code.run(
        owner,
        CodeRun {
            step: &step,
            context: &context,
            steps: &no_steps,
            dry_run: true,
            acts_as: CodeIdentity::Agent,
            routine_id: Uuid::now_v7(),
        },
    );
    let Ok(outcome) = tokio::time::timeout(LOOKUP_TIMEOUT, run).await else {
        span.record("routine.draft.lookup_outcome", "timeout");
        return Workspace::default();
    };
    let found = outcome
        .result
        .map_err(|error| error.to_string())
        .and_then(|value| serde_json::from_value::<Vec<Found>>(value).map_err(|e| e.to_string()));
    match found {
        Ok(found) => {
            let workspace = resolve(&found);
            span.record("routine.draft.lookups_resolved", workspace.len());
            span.record("routine.draft.lookup_outcome", "looked_up");
            workspace
        }
        Err(error) => {
            span.record("routine.draft.lookup_outcome", "failed");
            tracing::warn!(error = %error, "looking up named items failed; drafting without them");
            Workspace::default()
        }
    }
}

/// The item each name means: the one whose name is the name (ignoring case
/// and a leading # or @), or for a person, the only one found. Nothing for a
/// name that matches nothing or several items.
fn resolve(found: &[Found]) -> Workspace {
    let mut workspace = Workspace::default();
    for found in found {
        let wanted = normalized(&found.name);
        let exact: Vec<&Match> = found
            .matches
            .iter()
            .filter(|item| normalized(&item.name) == wanted)
            .collect();
        let chosen = match (exact.as_slice(), found.kind, found.matches.as_slice()) {
            ([only], _, _) => *only,
            ([], LookupKind::Person, [only]) => only,
            _ => continue,
        };
        let named = || NamedItem {
            name: chosen.name.clone(),
            id: chosen.id.clone(),
        };
        match found.kind {
            LookupKind::Channel => push_new(&mut workspace.channels, named()),
            LookupKind::Person => push_new(&mut workspace.people, named()),
            LookupKind::Folder => push_new(&mut workspace.folders, named()),
            LookupKind::Label => push_new(&mut workspace.email_labels, chosen.name.clone()),
            LookupKind::Tag => {
                let Some(definition_id) = chosen.definition_id.clone() else {
                    continue;
                };
                push_new(
                    &mut workspace.tags,
                    WorkspaceTag {
                        label: chosen.name.clone(),
                        definition_id,
                        option_id: chosen.id.clone(),
                    },
                );
            }
            LookupKind::Agent => push_new(
                &mut workspace.agents,
                WorkspaceAgent {
                    name: chosen.name.clone(),
                    bot_id: chosen.id.clone(),
                },
            ),
        }
    }
    workspace
}

fn push_new<T: PartialEq>(items: &mut Vec<T>, item: T) {
    if !items.contains(&item) {
        items.push(item);
    }
}

fn normalized(name: &str) -> String {
    name.trim()
        .trim_start_matches(['#', '@'])
        .trim()
        .to_lowercase()
}

/// The shape of the names the model lists.
fn lookups_schema() -> OutputSchema {
    OutputSchema {
        name: "lookups",
        description: "The workspace items the person's words name.",
        schema: json!({
            "type": "object",
            "properties": {
                "lookups": {
                    "type": "array",
                    "maxItems": MAX_LOOKUPS,
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {
                                "type": "string",
                                "enum": ["channel", "person", "folder", "label", "tag", "agent"],
                            },
                            "name": { "type": "string" },
                        },
                        "required": ["kind", "name"],
                    },
                },
            },
            "required": ["lookups"],
        }),
    }
}
