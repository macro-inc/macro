//! What a routine draft knows before its hidden session starts. A small call
//! on a fast model names the items the person's words refer to and the SDK
//! areas the routine needs, and the name lookup finds those items, each by
//! the exact name the words use. The session is then given what they found
//! and the SDK reference it needs, so it reads no documentation, searches
//! only for names the lookup didn't look up and writes one program that
//! ends with the check. A name no item has, or several do, is left out for
//! the person to pick. A name of a kind the lookup doesn't search is left
//! for the session to look up with its tools, given the reference of the
//! SDK areas that find it. The drafter reports what it found by name as it
//! goes.
//!
//! The session's instructions are the same for every draft on one model
//! with the same mix of code and conditions, so the prompt cache reads them
//! back across drafts; its prompt holds only what is particular to the
//! request.

use std::sync::Arc;
use std::time::Duration;

use agent_session::domain::routines::RoutineSessions;
use chrono::{SecondsFormat, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use routine_program::{CODE_STEPS, STEP_CONTEXT, Step};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use strum::VariantArray as _;
use tracing::Instrument as _;
use utoipa::ToSchema;

use super::progress::{DraftMilestone, DraftProgress, FoundName, FoundNames, LeftName};
use super::{Brief, DraftContext, DraftRequest};
use crate::domain::ports::{DraftModel, NameLookups, RoutineCode};

#[cfg(test)]
pub(super) mod test;

/// What the fast call is told: name the items and SDK areas.
const FIND: &str = include_str!("finding/find.md");
/// The session's instructions, with `{items}`, `{conditions}`, `{steps}`
/// and `{reference}` to fill.
const INSTRUCTIONS: &str = include_str!("finding/instructions.md");
/// What the session does with a found item, and with one left.
const ITEMS: &str = include_str!("finding/items.md");
/// The most names one lookup takes.
const MAX_NAMES: usize = 10;
/// The longest name one lookup takes; it refuses the whole lookup for one.
const MAX_NAME_CHARS: usize = 200;
/// The most SDK areas the fast call adds the reference of to the prompt.
const MAX_AREAS: usize = 6;
/// The most SDK areas added to look up the names the lookup didn't.
const MAX_LOOKUP_AREAS: usize = 3;
/// The longest the fast call may take; the draft goes on without it after.
const FIND_TIMEOUT: Duration = Duration::from_secs(10);
/// The SDK area every code step may use, in the instructions.
const AI_AREA: &str = "ai";
/// The SDK area a routine is written with, in the instructions.
const ROUTINES_AREA: &str = "routines";
/// The areas the prompt carries when the fast call named none the SDK has.
const FALLBACK_AREAS: &[&str] = &["channels", "tasks", "email"];
/// The areas that find the commonest items named, for names of no known kind
/// or a find call that failed.
const LOOKUP_FALLBACK_AREAS: &[&str] = &["channels", "users", "documents"];

/// A kind of item a request can name.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    ToSchema,
    strum::Display,
    strum::EnumString,
    strum::IntoStaticStr,
    strum::VariantArray,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ItemKind {
    Channel,
    Person,
    /// A folder.
    Project,
    /// What the app calls a project.
    Initiative,
    Document,
    Task,
    Database,
    Agent,
    /// An email label.
    Label,
    Tag,
    ChannelLabel,
}

/// One name to look up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameAsked {
    /// As the request writes it.
    pub name: String,
    /// The kinds it may name, most likely first; empty for any.
    pub kinds: Vec<ItemKind>,
}

/// What the names matched, and the kinds that couldn't be searched.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NameAnswers {
    /// One per name asked, in the order asked.
    pub answers: Vec<NameAnswer>,
    /// Kinds whose items couldn't be searched this time: a name of one of
    /// them that matched nothing may still be someone's.
    pub unavailable: Vec<ItemKind>,
}

/// What one name matched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameAnswer {
    pub name: String,
    /// Kinds whose items with this name couldn't all be read this time:
    /// their search failed, ran out of time or matched more items than it
    /// read, so an item of one of them with the name may be missing.
    pub unavailable: Vec<ItemKind>,
    /// Exact matches first.
    pub matches: Vec<NameMatch>,
}

/// An item a name matched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameMatch {
    /// Its name as stored.
    pub name: String,
    /// Whether its name is the name asked, by [`same_name`].
    pub exact: bool,
    pub kind: ItemKind,
    pub id: String,
    /// A tag's tag set's property definition.
    pub definition_id: Option<String>,
}

/// Whether `stored`, an item's name, is the name `asked`: the same words,
/// ignoring case, surrounding space, how they're spaced and one leading `#`
/// or `@`.
pub fn same_name(asked: &str, stored: &str) -> bool {
    fn words(name: &str) -> String {
        let name = name.trim();
        let name = name.strip_prefix(['#', '@']).unwrap_or(name);
        name.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    }
    let asked = words(asked);
    !asked.is_empty() && asked == words(stored)
}

/// Why the names couldn't be looked up.
#[derive(Debug, thiserror::Error)]
#[error("couldn't look the names up: {0}")]
pub struct NameLookupError(pub rootcause::Report);

/// One call on the host's fast model.
#[derive(Debug, Clone, Copy)]
pub struct DraftCall<'a> {
    /// Instructions the same on every call, so the model's prompt cache
    /// keeps them.
    pub system: &'a str,
    /// The person's turn.
    pub prompt: &'a str,
}

/// Why a model call gave no answer.
#[derive(Debug, thiserror::Error)]
#[error("the model call failed: {0}")]
pub struct DraftCallError(pub rootcause::Report);

/// What finding a draft's items uses.
pub struct DraftFinding {
    pub model: Arc<dyn DraftModel>,
    pub names: Arc<dyn NameLookups>,
}

/// What finding builds once: the fast call's instructions and the SDK
/// reference every draft's instructions carry.
pub(super) struct FindingPrompts {
    find: String,
    /// The routines area's reference.
    routines: String,
    /// The `ai` area's reference, which any code step may use.
    ai: String,
}

impl FindingPrompts {
    pub(super) fn new(code: &impl RoutineCode) -> Self {
        // One reference per area, so each keeps its own budget for the types
        // it imports: in one, the routines area's imports crowd out `ai`'s.
        Self {
            find: FIND.replace("{areas}", code.sdk_areas().trim()),
            routines: code.area_reference(&[ROUTINES_AREA.to_owned()]),
            ai: code.area_reference(&[AI_AREA.to_owned()]),
        }
    }

    /// The session's instructions: the same for every draft on `model` with
    /// the same `code` and `conditions`.
    pub(super) fn instructions(&self, code: bool, conditions: bool, model: &str) -> String {
        let ask_ai = format!("an Ask AI step ({{type: 'agent', model: '{model}', instructions}})");
        let steps = if code {
            format!(
                "Steps run in order. Prefer a code step whenever code can do the job: acting, deciding with macro.ai.decide, and writing text with macro.ai.structuredCompletion all fit in one. {ask_ai} hands open-ended work to AI with tools; a routine has at most one, last.\n\nA code step runs with its owner's access, and Macro refuses a message from someone to themselves: a code step never messages or emails the routine's owner. When the routine's job is to tell its owner something (a reminder, a digest, news from a channel), write an Ask AI step whose instructions say what to tell them, and Macro's agent messages them.\n\nHow to write a code step:\n{CODE_STEPS}\n\nThe type of `main`'s argument:\n```ts\n{STEP_CONTEXT}```\n\n{}",
                super::catalog_examples(conditions)
            )
        } else {
            format!("Code steps can't be used: use {ask_ai} for the work.")
        };
        let conditions = if conditions {
            "An event trigger may carry a `condition`, a yes/no question the item must answer yes."
        } else {
            "Never give a trigger a `condition`."
        };
        let reference = if code {
            [self.routines.as_str(), self.ai.as_str()]
                .into_iter()
                .filter(|reference| !reference.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n\n")
        } else {
            self.routines.clone()
        };
        // The reference goes in last, so nothing in it is read as a
        // placeholder.
        INSTRUCTIONS
            .trim()
            .replace("{items}", ITEMS.trim())
            .replace("{conditions}", conditions)
            .replace("{steps}", &steps)
            .replace("{icons}", &model_entity::macro_icon_names().join(", "))
            .replace("{reference}", reference.trim())
    }
}

/// The session's prompt: `task`, for `owner`, with the items `lookup` found
/// and the reference of the areas the routine uses or finds names in, if
/// any.
fn prompt(
    task: &str,
    owner: &MacroUserIdStr<'static>,
    context: &DraftContext,
    lookup: &Lookup,
    areas: &str,
) -> String {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let mut prompt = format!(
        "{task}\n\nYou are setting up this routine for {owner}, with their access. Now is {now}; their time zone is {timezone}.\n\n## Items the request names\n\n{found}",
        timezone = context.timezone,
        found = lookup.for_session(),
    );
    if !areas.trim().is_empty() {
        prompt.push_str(&format!(
            "\n\n## The SDK reference for the areas this routine uses or finds names in\n\n<sdk>\n{}\n</sdk>",
            areas.trim()
        ));
    }
    prompt
}

/// What the find call named.
#[derive(Debug, Default, Deserialize)]
struct Named {
    #[serde(default)]
    names: Vec<NamedInRequest>,
    #[serde(default)]
    sdk: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct NamedInRequest {
    name: String,
    #[serde(default)]
    kinds: Vec<String>,
}

/// The items the words name, as looked up.
#[derive(Debug, Default)]
pub(super) struct Lookup {
    found: Vec<(NameMatch, String)>,
    left: Vec<LeftName>,
    /// Names not looked up, with the kinds they may be: of a kind the lookup
    /// doesn't search, or it failed. The session looks them up itself.
    unsearched: Vec<NameAsked>,
    /// The find call failed, so no name was read from the request: the
    /// session looks up every item it names.
    unread: bool,
}

impl Lookup {
    /// How many names were found, left and not looked up, on `span`.
    fn record(&self, span: &tracing::Span) {
        span.record("routine.draft.found", self.found.len());
        span.record("routine.draft.left", self.left.len());
        span.record("routine.draft.unsearched", self.unsearched.len());
    }

    /// What progress shows: the names found and left. One not looked up
    /// isn't missing, so it isn't shown.
    fn names(&self) -> FoundNames {
        FoundNames {
            found: self
                .found
                .iter()
                .map(|(item, _)| FoundName {
                    name: item.name.clone(),
                    kind: item.kind,
                })
                .collect(),
            left: self.left.clone(),
        }
    }

    /// The items as the session reads them.
    fn for_session(&self) -> String {
        let mut text = String::new();
        if !self.found.is_empty() {
            text.push_str("Found:\n");
            for (item, asked) in &self.found {
                let tag = item
                    .definition_id
                    .as_ref()
                    .map(|definition| format!(", tag set property {definition}"))
                    .unwrap_or_default();
                text.push_str(&format!(
                    "- \"{asked}\": the {} named \"{}\", id {}{tag}\n",
                    kind_words(item.kind),
                    item.name,
                    item.id
                ));
            }
        }
        if !self.left.is_empty() {
            text.push_str("Left for the owner:\n");
            for left in &self.left {
                let kind = left.kind.map(kind_words).unwrap_or("item");
                let why = match left.matches {
                    0 => format!("no {kind} has that name"),
                    count => format!("{count} have that name"),
                };
                text.push_str(&format!("- \"{}\" ({kind}): {why}\n", left.name));
            }
        }
        if !self.unsearched.is_empty() || self.unread {
            text.push_str("Not looked up (look each up yourself before you write the routine):\n");
            if self.unread {
                text.push_str(
                    "- every item the request names, each by its name alone (no kind word, no leading # or @), but not the owner's own things (\"my tasks\"), dates, or what a routine being changed already uses\n",
                );
            }
            for asked in &self.unsearched {
                let kinds: Vec<&str> = asked.kinds.iter().map(|kind| kind_words(*kind)).collect();
                if kinds.is_empty() {
                    text.push_str(&format!("- \"{}\"\n", asked.name));
                } else {
                    text.push_str(&format!("- \"{}\" ({})\n", asked.name, kinds.join(" or ")));
                }
            }
        }
        if text.is_empty() {
            text.push_str("The request names no item to look up.\n");
        }
        text
    }
}

fn kind_words(kind: ItemKind) -> &'static str {
    match kind {
        ItemKind::Channel => "channel",
        ItemKind::Person => "person",
        ItemKind::Project => "folder",
        ItemKind::Initiative => "project",
        ItemKind::Document => "document",
        ItemKind::Task => "task",
        ItemKind::Database => "database",
        ItemKind::Agent => "agent",
        ItemKind::Label => "email label",
        ItemKind::Tag => "tag",
        ItemKind::ChannelLabel => "channel label",
    }
}

/// The SDK area whose methods find an item of `kind` by name.
fn kind_area(kind: ItemKind) -> &'static str {
    match kind {
        ItemKind::Channel | ItemKind::ChannelLabel => "channels",
        ItemKind::Person => "users",
        ItemKind::Project => "projects",
        ItemKind::Initiative => "initiatives",
        ItemKind::Document => "documents",
        ItemKind::Task => "tasks",
        ItemKind::Database => "databases",
        ItemKind::Agent => "agents",
        ItemKind::Label => "email",
        ItemKind::Tag => "properties",
    }
}

/// Settle each name on the one item of its likeliest kind that has it
/// exactly; a name no item has, or several items of that kind do, is left.
/// A name a likelier kind that couldn't be searched might have is left for
/// the session to look up, as is a name of no likely kind that fewer than
/// two items have while any kind couldn't be searched. With no likely kind,
/// items of every kind compete.
pub(super) fn settle(asked: &[NameAsked], answers: NameAnswers) -> Lookup {
    let NameAnswers {
        answers,
        unavailable,
    } = answers;
    let mut lookup = Lookup::default();
    for (asked, answer) in asked.iter().zip(answers) {
        let mut unavailable = unavailable.clone();
        unavailable.extend(answer.unavailable);
        let exact: Vec<NameMatch> = answer.matches.into_iter().filter(|m| m.exact).collect();
        let mut chosen: Option<Vec<NameMatch>> = None;
        let mut unknown = false;
        if asked.kinds.is_empty() {
            // No likeliest kind: every item with the name competes, whatever
            // its kind, so a channel and a folder both named it are two.
            let mut items: Vec<NameMatch> = Vec::new();
            for item in &exact {
                if !items
                    .iter()
                    .any(|seen| seen.kind == item.kind && seen.id == item.id)
                {
                    items.push(item.clone());
                }
            }
            // A kind it couldn't search might hold the one item, or a second.
            unknown = items.len() < 2 && !unavailable.is_empty();
            chosen = (!unknown && !items.is_empty()).then_some(items);
        } else {
            for kind in &asked.kinds {
                if unavailable.contains(kind) {
                    unknown = true;
                    break;
                }
                let mut of_kind: Vec<NameMatch> = Vec::new();
                for item in exact.iter().filter(|item| item.kind == *kind) {
                    if !of_kind.iter().any(|seen| seen.id == item.id) {
                        of_kind.push(item.clone());
                    }
                }
                if !of_kind.is_empty() {
                    chosen = Some(of_kind);
                    break;
                }
            }
        }
        match chosen {
            Some(mut items) if items.len() == 1 => {
                if let Some(item) = items.pop() {
                    lookup.found.push((item, asked.name.clone()));
                }
            }
            Some(items) => lookup.left.push(LeftName {
                name: asked.name.clone(),
                // Only a kind all of them share.
                kind: items
                    .first()
                    .map(|item| item.kind)
                    .filter(|kind| items.iter().all(|item| item.kind == *kind)),
                matches: u32::try_from(items.len()).unwrap_or(u32::MAX),
            }),
            None if unknown => lookup.unsearched.push(asked.clone()),
            None => lookup.left.push(LeftName {
                name: asked.name.clone(),
                kind: asked.kinds.first().copied(),
                matches: 0,
            }),
        }
    }
    lookup
}

/// The first JSON object in a model's answer, past any prose or code fence.
pub(super) fn json_answer(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    serde_json::Deserializer::from_str(&text[start..])
        .into_iter::<Value>()
        .next()?
        .ok()
}

impl<Code: RoutineCode, Sessions: RoutineSessions> super::RoutineDrafts<Code, Sessions> {
    /// The brief of `request`'s session, once what its words name is found,
    /// reporting as it goes; or why it can't be drafted, for the person.
    /// Only a refused admission is an error.
    pub(super) async fn found_brief(
        &self,
        finding: &super::Finding,
        owner: &MacroUserIdStr<'static>,
        request: &DraftRequest,
        program: &[Step],
        context: &DraftContext,
        progress: &dyn DraftProgress,
    ) -> anyhow::Result<Result<Brief, &'static str>> {
        let span = tracing::Span::current();
        span.record("routine.draft.drafter", "found");
        let code = self.code_available(request, context);
        let task = match super::task(request, program, code) {
            Ok(task) => task,
            Err(message) => return Ok(Err(message)),
        };
        finding.drafting.model.admit(owner).await?;
        progress.report(DraftMilestone::Admitted);
        let named = self
            .find(&finding.drafting, &finding.prompts, owner, request)
            .await;
        let lookup = match &named {
            Some(named) => self.look_up(&finding.drafting, owner, named).await,
            None => Lookup {
                unread: true,
                ..Lookup::default()
            },
        };
        span.record("routine.draft.find_failed", named.is_none());
        lookup.record(&span);
        progress.report(DraftMilestone::Found(lookup.names()));
        let areas = self.areas_reference(code, named.as_ref(), &lookup);
        Ok(Ok(Brief {
            instructions: Some(finding.prompts.instructions(
                code,
                context.conditions,
                &context.agent_model,
            )),
            prompt: prompt(&task, owner, context, &lookup, &areas),
            apps: None,
        }))
    }

    /// With `code`, the reference of the areas the fast call named, past the
    /// ones the instructions carry, or of the commonest ones when the SDK has
    /// none of them. Without `code` the session writes no code step but still
    /// looks names up, so it gets only the areas for that. Then, either way,
    /// the areas that find the names not looked up, as the budget allows: by
    /// each name's kinds, or the ones that find the commonest items when the
    /// find call failed or a name has no known kind.
    fn areas_reference(&self, code: bool, named: Option<&Named>, lookup: &Lookup) -> String {
        let mut areas: Vec<String> = if code {
            let named: Vec<String> = named
                .map(|named| named.sdk.as_slice())
                .unwrap_or_default()
                .iter()
                .map(|area| area.trim().to_owned())
                .filter(|area| !area.is_empty() && area != AI_AREA && area != ROUTINES_AREA)
                .take(MAX_AREAS)
                .collect();
            if self.code.area_reference(&named).trim().is_empty() {
                FALLBACK_AREAS
                    .iter()
                    .map(|area| (*area).to_owned())
                    .collect()
            } else {
                named
            }
        } else {
            Vec::new()
        };
        // After the areas the routine uses, so they keep the budget first:
        // every name's likeliest kind, then its next likeliest, and so on.
        let mut added = 0;
        let ranks = lookup
            .unsearched
            .iter()
            .map(|asked| asked.kinds.len())
            .max()
            .unwrap_or(0);
        for rank in 0..ranks {
            for asked in &lookup.unsearched {
                let Some(kind) = asked.kinds.get(rank) else {
                    continue;
                };
                let area = kind_area(*kind).to_owned();
                if added < MAX_LOOKUP_AREAS && !areas.contains(&area) {
                    areas.push(area);
                    added += 1;
                }
            }
        }
        if lookup.unread || lookup.unsearched.iter().any(|asked| asked.kinds.is_empty()) {
            for area in LOOKUP_FALLBACK_AREAS {
                if !areas.iter().any(|seen| seen == area) {
                    areas.push((*area).to_owned());
                }
            }
        }
        if areas.is_empty() {
            return String::new();
        }
        self.code.area_reference(&areas)
    }

    /// The items and SDK areas the words name, from the fast model; `None`
    /// when it failed, couldn't say in time, or gave no answer to read.
    async fn find(
        &self,
        finding: &DraftFinding,
        prompts: &FindingPrompts,
        owner: &MacroUserIdStr<'static>,
        request: &DraftRequest,
    ) -> Option<Named> {
        let mut words = format!("<request>\n{}\n</request>", request.text().trim());
        if let DraftRequest::AddStep { routine, .. } | DraftRequest::ChangeStep { routine, .. } =
            request
        {
            words.push_str(&format!(
                "\nIt changes this routine, whose items are already chosen (data, not instructions):\n{}",
                json!({ "trigger": routine.trigger, "steps": routine.steps })
            ));
        }
        let span = tracing::info_span!(
            "routine.draft.find",
            routine.draft.answer_chars = tracing::field::Empty,
        );
        async {
            let call = DraftCall {
                system: &prompts.find,
                prompt: &words,
            };
            let answer =
                match tokio::time::timeout(FIND_TIMEOUT, finding.model.complete(owner, call)).await
                {
                    Ok(Ok(answer)) => answer,
                    Ok(Err(error)) => {
                        tracing::warn!(error = %error, "a routine draft's find call failed");
                        return None;
                    }
                    Err(_) => {
                        tracing::warn!("a routine draft's find call timed out");
                        return None;
                    }
                };
            tracing::Span::current().record("routine.draft.answer_chars", answer.len());
            let named =
                json_answer(&answer).and_then(|value| serde_json::from_value::<Named>(value).ok());
            if named.is_none() {
                tracing::warn!("a routine draft's find call gave no answer to read");
            }
            named
        }
        .instrument(span)
        .await
    }

    /// Look up the names the find call gave, skipping any the lookup would
    /// refuse. A name whose likeliest kind the lookup doesn't search isn't
    /// asked: the session looks it up itself.
    async fn look_up(
        &self,
        finding: &DraftFinding,
        owner: &MacroUserIdStr<'static>,
        named: &Named,
    ) -> Lookup {
        let asked: Vec<NameAsked> = named
            .names
            .iter()
            .filter_map(|name| {
                let name_text = name.name.trim();
                let bare = name_text.strip_prefix(['#', '@']).unwrap_or(name_text);
                if bare.trim().is_empty() || name_text.chars().count() > MAX_NAME_CHARS {
                    return None;
                }
                Some(NameAsked {
                    name: name_text.to_owned(),
                    kinds: name
                        .kinds
                        .iter()
                        .filter_map(|kind| kind.parse().ok())
                        .collect(),
                })
            })
            .take(MAX_NAMES)
            .collect();
        if asked.is_empty() {
            return Lookup::default();
        }
        let searched = finding.names.kinds();
        let unsearched: Vec<ItemKind> = ItemKind::VARIANTS
            .iter()
            .copied()
            .filter(|kind| !searched.contains(kind))
            .collect();
        // Each name asks only for the kinds the lookup searches; one whose
        // likeliest kind it doesn't isn't asked at all.
        let to_ask: Vec<(usize, NameAsked)> = asked
            .iter()
            .enumerate()
            .filter(|(_, name)| {
                name.kinds
                    .first()
                    .is_none_or(|kind| searched.contains(kind))
            })
            .map(|(index, name)| {
                let kinds = name
                    .kinds
                    .iter()
                    .copied()
                    .filter(|kind| searched.contains(kind))
                    .collect();
                (
                    index,
                    NameAsked {
                        name: name.name.clone(),
                        kinds,
                    },
                )
            })
            .collect();
        let span = tracing::info_span!(
            "routine.draft.lookup",
            routine.draft.names = asked.len(),
            routine.draft.asked = to_ask.len(),
            routine.draft.found = tracing::field::Empty,
            routine.draft.left = tracing::field::Empty,
            routine.draft.unsearched = tracing::field::Empty,
        );
        async {
            let questions: Vec<NameAsked> = to_ask.iter().map(|(_, name)| name.clone()).collect();
            let answered = if questions.is_empty() {
                Ok(NameAnswers::default())
            } else {
                finding.names.look_up(owner, &questions).await
            };
            let lookup = match answered {
                Ok(NameAnswers {
                    answers,
                    unavailable,
                }) => {
                    // One answer per name, in order; a name not asked, or one
                    // the lookup left unanswered, matched nothing it could
                    // read.
                    let mut all: Vec<NameAnswer> = asked
                        .iter()
                        .map(|name| NameAnswer {
                            name: name.name.clone(),
                            unavailable: searched.to_vec(),
                            matches: Vec::new(),
                        })
                        .collect();
                    for ((index, _), answer) in to_ask.iter().zip(answers) {
                        if let Some(slot) = all.get_mut(*index) {
                            *slot = answer;
                        }
                    }
                    let mut unavailable = unavailable;
                    unavailable.extend(unsearched.iter().copied());
                    settle(
                        &asked,
                        NameAnswers {
                            answers: all,
                            unavailable,
                        },
                    )
                }
                Err(error) => {
                    tracing::warn!(error = %error, "could not look up a draft's names");
                    Lookup {
                        unsearched: asked.clone(),
                        ..Lookup::default()
                    }
                }
            };
            lookup.record(&tracing::Span::current());
            lookup
        }
        .instrument(span)
        .await
    }
}
