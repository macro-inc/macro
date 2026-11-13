//! Run routine code steps with the routine owner's access in the harness's
//! Deno executor, and type-check them against the SDK.
//!
//! Each SDK call the code makes becomes one entry in the run's history: the
//! operation and how it ended, never its arguments or results.

use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, LazyLock},
    time::{Duration, Instant},
};

use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{Message, PredefinedModel};
use agent_code_mode::domain::symbol_reference;
use agent_egress::outbound::macro_mcp::MacroApiTokenSigner;
use code_execution::domain::{
    CheckError, ExecuteRequest, Outcome, ProgramChecker, ProgramExecutor, RunEnvironment,
    SdkEndpoints, SourceFile, Unattended, operations, sdk_declaration_files, sdk_declarations,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::{
    CallRecord, CallStatus, CodeIdentity, CodeStep, MAX_OUTPUT_BYTES, RoutineProgram, STEP_CONTEXT,
    SdkFingerprint, code_version,
};
use scheduled_action::domain::ports::{
    CodeOutcome, CodeRun, CodeUnavailable, RoutineCode, StepProblems,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;
use tracing::Instrument;

#[cfg(test)]
mod test;

/// A step's whole budget, including waiting for an executor slot.
const STEP_TIMEOUT_MS: u64 = 30_000;
/// Longest a step waits for a free slot on the routine executor. Within the
/// run's own deadline; a full pool otherwise fails event runs that would
/// succeed a minute later.
const SLOT_WAIT: Duration = Duration::from_secs(5 * 60);
/// Waits shorter than this aren't worth recording on the step.
const NOTABLE_WAIT: Duration = Duration::from_secs(1);
/// The credential outlives the step's deadline by a margin; it expires rather
/// than being revoked.
const TOKEN_LIFETIME_SECONDS: usize = 60;
/// Longest failure message kept in the run's history.
const MAX_MESSAGE_CHARS: usize = 500;
/// Calls recorded per step; the executor reports at most this many.
const MAX_CALLS: usize = 128;
/// SDK declarations a rewrite reads, in bytes.
const REWRITE_DECLARATION_BYTES: usize = 48 * 1024;
/// SDK reference a draft reads, in bytes: the symbols its model names,
/// then the types their references name.
const DRAFT_REFERENCE_BYTES: usize = 48 * 1024;
/// SDK reference a direct draft's writer reads for the areas its request
/// uses, in bytes; of that, one area's; and the generated types their
/// declarations import.
const AREA_REFERENCE_BYTES: usize = 64 * 1024;
const ONE_AREA_BYTES: usize = 32 * 1024;
const IMPORTED_TYPE_BYTES: usize = 8 * 1024;
/// Where the SDK declares its entities.
const ENTITY_DECLARATIONS: &str = "src/entities/";

const REWRITE_INSTRUCTIONS: &str = "You maintain TypeScript that a Macro routine runs against Macro's SDK. Macro's SDK has changed and the code no longer type-checks. Rewrite it so it type-checks against the declarations you are given, changing only what the type checker's errors require. Keep exactly what it does: the same reads, the same changes, the same decisions and the same return value. Keep the module's shape, `export async function main(...: StepContext)` with no imports, and keep reading the step's settings from `knobs` as it did. If a call it made no longer exists, use the declarations' replacement for it.";

/// Mints the short-lived token a routine's code acts as its owner with.
pub trait RoutineCredentials: Send + Sync + 'static {
    /// A token for `owner` that outlives one step's deadline, its writes
    /// attributed as `acts_as` says, for a run of `routine_id`.
    fn mint(
        &self,
        owner: &MacroUserIdStr<'static>,
        acts_as: CodeIdentity,
        routine_id: Uuid,
    ) -> impl std::future::Future<Output = anyhow::Result<String>> + Send;
}

impl RoutineCredentials for MacroApiTokenSigner {
    async fn mint(
        &self,
        owner: &MacroUserIdStr<'static>,
        acts_as: CodeIdentity,
        routine_id: Uuid,
    ) -> anyhow::Result<String> {
        // The owner's access either way. As the agent, writes are attributed
        // to Macro acting for them, as an agent step's are; as the owner,
        // they look like the owner's own. The routine id signed into every
        // token marks the events its writes produce, so they never start a
        // routine, this one included.
        let agent_id = match acts_as {
            CodeIdentity::Agent => Some(bot_id::MACRO_NEW_BOT_ID.as_uuid()),
            CodeIdentity::Owner => None,
        };
        Ok(self
            .mint_for_routine(owner, TOKEN_LIFETIME_SECONDS, agent_id, routine_id)
            .await?)
    }
}

/// Looks up the time zone a routine's owner works in. `async_trait` keeps it
/// object-safe, so the adapter holds it as `Arc<dyn OwnerTimeZones>`.
#[async_trait::async_trait]
pub trait OwnerTimeZones: Send + Sync + 'static {
    /// The IANA zone of `owner`'s primary calendar, when they have one.
    async fn time_zone(&self, owner: &MacroUserIdStr<'static>) -> Option<String>;
}

/// Owners' zones from their primary calendars.
pub struct CalendarTimeZones<Calendars>(pub Arc<Calendars>);

#[async_trait::async_trait]
impl<Calendars> OwnerTimeZones for CalendarTimeZones<Calendars>
where
    Calendars: calendar_events::domain::ports::CalendarOccurrenceService,
{
    async fn time_zone(&self, owner: &MacroUserIdStr<'static>) -> Option<String> {
        self.0
            .primary_time_zone(owner.as_ref())
            .await
            .inspect_err(|error| tracing::warn!(?error, "owner's calendar zone unavailable"))
            .ok()
            .flatten()
    }
}

/// Routine code over the harness's own executor and type checker.
pub struct SdkRoutineCode<Credentials = MacroApiTokenSigner> {
    executor: Arc<dyn ProgramExecutor>,
    checker: Arc<dyn ProgramChecker>,
    credentials: Credentials,
    endpoints: SdkEndpoints,
    recorder: Arc<dyn ai_usage::UsageRecorder>,
    /// Chooses the SDK entities relevant to a task, as code mode does.
    cognition: Option<Arc<dyn cognition::domain::Cognition>>,
    time_zones: Arc<dyn OwnerTimeZones>,
    /// One permit per program the executor runs at once: a step waits here,
    /// before its credential is minted, rather than queueing in the executor,
    /// so its credential and time limit start when it runs.
    slots: Arc<Semaphore>,
}

impl<Credentials> SdkRoutineCode<Credentials> {
    /// `executor` should be routines' own, so they can't take the slots
    /// agent sessions use. Rewrites for new SDKs are billed to the
    /// routine's owner through `recorder`.
    pub fn new(
        executor: Arc<dyn ProgramExecutor>,
        checker: Arc<dyn ProgramChecker>,
        credentials: Credentials,
        endpoints: SdkEndpoints,
        recorder: Arc<dyn ai_usage::UsageRecorder>,
        cognition: Option<Arc<dyn cognition::domain::Cognition>>,
        time_zones: Arc<dyn OwnerTimeZones>,
    ) -> Self {
        Self {
            executor,
            checker,
            credentials,
            endpoints,
            recorder,
            cognition,
            time_zones,
            slots: Arc::new(Semaphore::new(Semaphore::MAX_PERMITS)),
        }
    }

    /// Run at most `slots` programs at once, the executor's running limit;
    /// more steps wait for a slot, up to five minutes each.
    pub fn with_slots(mut self, slots: usize) -> Self {
        self.slots = Arc::new(Semaphore::new(slots));
        self
    }
}

impl<Credentials: RoutineCredentials> RoutineCode for SdkRoutineCode<Credentials> {
    fn sdk(&self) -> Option<SdkFingerprint> {
        Some(code_version(self.checker.sdk_fingerprint()))
    }

    async fn check_program(
        &self,
        program: &RoutineProgram,
    ) -> Result<Vec<StepProblems>, CodeUnavailable> {
        let files = program.check_files();
        if files.is_empty() {
            return Ok(Vec::new());
        }
        let sources: Vec<SourceFile> = files
            .iter()
            .map(|file| SourceFile {
                name: file.name.clone(),
                source: file.source.clone(),
            })
            .collect();
        let diagnostics = match self.checker.check_files(&sources, STEP_CONTEXT).await {
            Ok(diagnostics) => diagnostics,
            Err(CheckError::InvalidSource) => {
                return Ok(vec![StepProblems {
                    index: 0,
                    title: files[0].title.clone(),
                    problems: vec![
                        "A code step is empty or larger than the 64 KiB limit.".to_owned(),
                    ],
                }]);
            }
            Err(error) => {
                return Err(CodeUnavailable(format!(
                    "The code couldn't be type-checked: {error}"
                )));
            }
        };
        // A problem outside every step's file (an unresolvable import) is
        // the first step's to report.
        let mut failing: Vec<StepProblems> = Vec::new();
        for diagnostic in diagnostics {
            let file = diagnostic
                .file
                .as_deref()
                .and_then(|name| files.iter().find(|file| file.name == name))
                .unwrap_or(&files[0]);
            match failing.iter_mut().find(|step| step.index == file.index) {
                Some(step) => step.problems.push(diagnostic.message),
                None => failing.push(StepProblems {
                    index: file.index,
                    title: file.title.clone(),
                    problems: vec![diagnostic.message],
                }),
            }
        }
        failing.sort_by_key(|step| step.index);
        Ok(failing)
    }

    async fn owner_time_zone(&self, owner: &MacroUserIdStr<'static>) -> Option<String> {
        self.time_zones.time_zone(owner).await
    }

    // Arguments, outputs and failures are the owner's content; the span
    // records only their shape.
    #[tracing::instrument(name = "routine.code", skip_all, fields(
        dry_run = run.dry_run,
        source_bytes = run.step.source.len(),
        waited_ms = tracing::field::Empty,
        outcome = tracing::field::Empty,
    ))]
    async fn run(&self, owner: &MacroUserIdStr<'static>, run: CodeRun<'_>) -> CodeOutcome {
        // Tokio's clock, so the wait follows the runtime's time.
        let queued = tokio::time::Instant::now();
        let slot = tokio::time::timeout(SLOT_WAIT, self.slots.acquire())
            .instrument(tracing::info_span!("routine.code_slot"))
            .await;
        let waited = queued.elapsed();
        tracing::Span::current().record("waited_ms", waited.as_millis() as u64);
        let waited_ms =
            (waited >= NOTABLE_WAIT).then(|| u32::try_from(waited.as_millis()).unwrap_or(u32::MAX));
        let Ok(Ok(_slot)) = slot else {
            tracing::Span::current().record("outcome", "busy");
            return CodeOutcome {
                result: Err(format!(
                    "Macro was busy running other routines; this run waited {} minutes for a turn.",
                    SLOT_WAIT.as_secs() / 60
                )),
                calls: Vec::new(),
                calls_truncated: false,
                waited_ms,
            };
        };
        let token = match self
            .credentials
            .mint(owner, run.acts_as, run.routine_id)
            .await
        {
            Ok(token) => token,
            Err(error) => {
                tracing::error!(?error, "could not mint a routine code credential");
                return CodeOutcome {
                    result: Err("This step's credential couldn't be issued.".to_owned()),
                    calls: Vec::new(),
                    calls_truncated: false,
                    waited_ms,
                };
            }
        };
        let mut arguments = match run.context {
            Value::Object(context) => context.clone(),
            _ => Map::new(),
        };
        if let Some(Value::Object(info)) = arguments.get_mut("run") {
            info.insert("dryRun".into(), Value::Bool(run.dry_run));
        }
        arguments.insert("steps".into(), run.steps.clone());
        arguments.insert("knobs".into(), Value::Object(run.step.knob_values()));
        let environment = RunEnvironment {
            token,
            trace_headers: crate::code_mode::trace_headers(),
            endpoints: self.endpoints.clone(),
            session_id: None,
            execution_id: None,
            unattended: Some(Unattended {
                arguments,
                dry_run: run.dry_run,
            }),
        };
        let (progress, mut updates) = tokio::sync::mpsc::channel(512);
        let started = Instant::now();
        // Dropping this future (the run's deadline) stops the process.
        let execution = self.executor.execute_program_with_progress(
            ExecuteRequest {
                source: run.step.source.clone(),
                timeout_ms: STEP_TIMEOUT_MS,
            },
            environment,
            CancellationToken::new(),
            progress,
        );
        tokio::pin!(execution);
        let mut journal = Journal::default();
        let mut progress_open = true;
        let outcome = loop {
            tokio::select! {
                outcome = &mut execution => break outcome,
                update = updates.recv(), if progress_open => match update {
                    Some(value) => journal.observe(value, started.elapsed()),
                    None => progress_open = false,
                },
            }
        };
        while let Ok(value) = updates.try_recv() {
            journal.observe(value, started.elapsed());
        }
        let result = result(outcome);
        tracing::Span::current().record("outcome", if result.is_ok() { "ok" } else { "failed" });
        CodeOutcome {
            result,
            calls: journal.calls,
            calls_truncated: journal.truncated,
            waited_ms,
        }
    }

    // The task is the person's words; the span records only the outcome.
    #[tracing::instrument(name = "routine.code_reference", skip_all, fields(
        entities = tracing::field::Empty,
        status = tracing::field::Empty,
    ))]
    async fn reference(
        &self,
        user: &MacroUserIdStr<'static>,
        task: &str,
    ) -> Result<String, CodeUnavailable> {
        let documentation = agent_code_mode::domain::documentation_for_task(
            user,
            task,
            self.cognition.as_ref(),
            &CancellationToken::new(),
        )
        .await;
        let span = tracing::Span::current();
        span.record("entities", documentation.entities.len());
        span.record("status", tracing::field::debug(documentation.status));
        // The drafter reads symbols through `symbol_references`, not the
        // ReadCodeDocs tool the indexes point code mode's agent to.
        let mut reference: String = documentation
            .entities
            .iter()
            .filter_map(|entity| entity.index.as_deref())
            .map(drafter_index)
            .collect::<Vec<_>>()
            .join("\n\n");
        if reference.is_empty() {
            // Without a ranking, the catalog still names every entity.
            reference = agent_code_mode::domain::sdk_documentation()
                .iter()
                .map(|entity| format!("{}: {}", entity.name, entity.description))
                .collect::<Vec<_>>()
                .join("\n");
        }
        Ok(reference)
    }

    fn declarations(&self, problems: &[String]) -> String {
        declarations_for(problems)
    }

    fn symbol_references(&self, symbols: &[String], shown: &str) -> String {
        symbol_references(symbols, shown, DRAFT_REFERENCE_BYTES)
    }

    fn sdk_areas(&self) -> String {
        sdk_areas()
    }

    fn area_reference(&self, areas: &[String]) -> String {
        area_reference(areas)
    }

    async fn rewrite(
        &self,
        owner: &MacroUserIdStr<'static>,
        step: &CodeStep,
        steps: &str,
        problems: &[String],
    ) -> Result<String, String> {
        self.rewrite_source(owner, step, steps, problems)
            .await
            .map_err(|_| "the model couldn't rewrite it".to_owned())
    }
}

impl<Credentials> SdkRoutineCode<Credentials> {
    // The span records no code or problems: both can quote the owner's data.
    #[tracing::instrument(name = "routine.code_rewrite", skip_all, err)]
    async fn rewrite_source(
        &self,
        owner: &MacroUserIdStr<'static>,
        step: &CodeStep,
        steps: &str,
        problems: &[String],
    ) -> anyhow::Result<String> {
        let declarations = declarations_for(problems);
        let prompt = format!(
            "Step: {title}\n{summary}\n\nIts code:\n```ts\n{source}\n```\n\nThe type checker's errors against the current SDK:\n{problems}\n\nThe declarations every step is checked with:\n```ts\n{STEP_CONTEXT}```\n\nThis step's `StepContext`, with the outputs of the steps before it:\n```ts\n{steps}\n```\n\nThe current SDK's declarations for the types in those errors:\n```ts\n{declarations}```",
            title = step.title.trim(),
            summary = step.summary.trim(),
            source = step.source,
            problems = problems.join("\n\n"),
        );
        let value = dynamic_structured_completion(
            PredefinedModel::Smart,
            REWRITE_INSTRUCTIONS,
            vec![Message::user(prompt)],
            DynamicSchema {
                name: "RoutineCodeRewrite".to_owned(),
                description: Some("The whole rewritten module.".to_owned()),
                schema: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["source"],
                    "properties": {
                        "source": { "type": "string", "description": "The complete TypeScript module." }
                    }
                }),
            },
            self.recorder.as_ref(),
            ai_usage::UsageContext::new(ai_usage::AiFeature::Automation, owner.clone()),
        )
        .await?;
        value
            .get("source")
            .and_then(Value::as_str)
            .filter(|source| !source.trim().is_empty())
            .map(str::to_owned)
            .ok_or_else(|| anyhow::anyhow!("the model returned no code"))
    }
}

/// The SDK declarations of the types type-checker messages name.
fn declarations_for(problems: &[String]) -> String {
    let names = quoted_names(problems);
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    sdk_declarations(&names, REWRITE_DECLARATION_BYTES)
        .into_iter()
        .map(|(path, text)| format!("// @macro-inc/sdk/{path}\n{text}\n"))
        .collect()
}

/// The SDK reference a draft's writer asked for by symbol: the indexes of the
/// entities those symbols belong to that `shown` doesn't hold, each
/// symbol's reference as code mode's ReadCodeDocs reads it, then the types
/// those references name and the types those name, nearest first and once
/// each, until the budget is spent; and the names the SDK doesn't have, so
/// the writer doesn't use them.
fn symbol_references(symbols: &[String], shown: &str, budget: usize) -> String {
    let symbols: Vec<&str> = symbols.iter().map(|symbol| symbol.trim()).collect();
    let (known, unknown): (Vec<&str>, Vec<&str>) = symbols
        .iter()
        .partition(|symbol| symbol_reference(symbol).is_some());
    let mut output = String::new();
    // A class's entity lists what it has, which the writer may have guessed
    // without seeing.
    let mut indexes: Vec<&str> = Vec::new();
    for symbol in &symbols {
        let class = symbol.split('.').next().unwrap_or_default();
        let Some(index) = entity_index(class) else {
            continue;
        };
        if !indexes.contains(&index) && !shown.contains(index) {
            indexes.push(index);
        }
    }
    for index in indexes {
        if output.len() + index.len() <= budget {
            output.push_str(index);
            output.push_str("\n\n");
        }
    }
    // Breadth first, nearest types first: a method's options and result
    // types, then the types those name, such as a property value's union.
    let mut queue: VecDeque<&str> = known.iter().copied().collect();
    let mut read: Vec<&str> = Vec::new();
    while let Some(symbol) = queue.pop_front() {
        let Some(reference) = symbol_reference(symbol) else {
            continue;
        };
        if read.contains(&symbol) || output.len() + reference.len() > budget {
            continue;
        }
        read.push(symbol);
        // A method's reference is headed by its name alone, without its class.
        output.push_str(&format!("## `{symbol}`\n{reference}\n\n"));
        queue.extend(backticked(reference).filter(|name| !read.contains(name)));
    }
    let mut missing: Vec<&str> = Vec::new();
    for symbol in unknown {
        if !symbol.is_empty() && !missing.contains(&symbol) {
            missing.push(symbol);
        }
    }
    if !missing.is_empty() {
        output.push_str(&format!(
            "Macro's SDK has none of these; use what the indexes and references name instead: {}\n",
            missing
                .iter()
                .map(|name| format!("`{name}`"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    output
}

/// The index of the SDK entity that declares `class`, as the drafter shows
/// it: without code mode's pointer to ReadCodeDocs.
fn entity_index(class: &str) -> Option<&'static str> {
    static INDEXES: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
        let mut indexes = HashMap::new();
        for entity in agent_code_mode::domain::sdk_documentation() {
            let Some(index) = entity.index.as_deref() else {
                continue;
            };
            let shown = drafter_index(index);
            for line in index.lines() {
                if let Some(class) = line
                    .strip_prefix("### ")
                    .and_then(|header| header.split_whitespace().next())
                {
                    indexes.insert(class.to_owned(), shown.clone());
                }
            }
        }
        indexes
    });
    INDEXES.get(class).map(String::as_str)
}

/// An entity index without code mode's pointer to the ReadCodeDocs tool,
/// which the drafter doesn't have.
fn drafter_index(index: &str) -> String {
    index
        .lines()
        .filter(|line| !line.starts_with("Read any symbol below"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Every SDK area, one line each: its name and when to use it.
fn sdk_areas() -> String {
    agent_code_mode::domain::sdk_documentation()
        .iter()
        .filter(|entity| entity.index.is_some())
        .map(|entity| format!("- `{}`: {}", entity.name, entity.description))
        .collect::<Vec<_>>()
        .join("\n")
}

/// What a direct draft's writer reads of the SDK areas `areas` names, in
/// order, each whole or not at all, within [`AREA_REFERENCE_BYTES`]: each
/// area's index, guidance and declarations, then the generated types those
/// declarations import.
fn area_reference(areas: &[String]) -> String {
    let mut output = String::new();
    let mut imported: Vec<String> = Vec::new();
    let mut shown: Vec<&str> = Vec::new();
    for area in areas {
        let Some(reference) = AREAS.get(area.trim()) else {
            continue;
        };
        if shown.contains(&area.trim()) || output.len() + reference.text.len() > AREA_REFERENCE_BYTES
        {
            continue;
        }
        shown.push(area.trim());
        output.push_str(&reference.text);
        output.push_str("\n\n");
        for name in &reference.imports {
            if !imported.contains(name) {
                imported.push(name.clone());
            }
        }
    }
    if !imported.is_empty() {
        let types = symbol_references(&imported, &output, IMPORTED_TYPE_BYTES);
        if !types.is_empty() {
            output.push_str("The generated types those declarations import:\n\n");
            output.push_str(&types);
        }
    }
    output
}

/// One SDK area as a direct draft's writer reads it.
struct AreaReference {
    text: String,
    /// The generated types its declarations import, which the SDK's
    /// reference has.
    imports: Vec<String>,
}

/// Each SDK area's reference by its name, built once.
static AREAS: LazyLock<HashMap<&'static str, AreaReference>> = LazyLock::new(|| {
    agent_code_mode::domain::sdk_documentation()
        .iter()
        .filter_map(|entity| {
            let index = entity.index.as_deref()?;
            Some((
                entity.name.as_str(),
                area(&entity.name, index, entity.guide.as_deref()),
            ))
        })
        .collect()
});

/// An area's index, its guidance, and as many of its declaration files as
/// fit in [`ONE_AREA_BYTES`], its namespace's first, without their imports.
fn area(name: &str, index: &str, guide: Option<&str>) -> AreaReference {
    let mut text = drafter_index(index);
    if let Some(guide) = guide.filter(|guide| !guide.trim().is_empty()) {
        text.push_str("\n\nHow it works:\n");
        text.push_str(guide.trim());
    }
    let mut imports = Vec::new();
    let mut files = area_declarations(name, index);
    // Its namespace first: what `macro.<area>` has.
    files.sort_by_key(|(path, _)| !path.ends_with("/namespace.d.ts"));
    let mut declarations = String::new();
    for (path, file) in files {
        let mut kept = format!("// @macro-inc/sdk/{path}\n");
        let mut names = Vec::new();
        for line in file.lines() {
            if line.starts_with("import ") {
                names.extend(generated_imports(line));
            } else {
                kept.push_str(line);
                kept.push('\n');
            }
        }
        if text.len() + declarations.len() + kept.len() > ONE_AREA_BYTES {
            continue;
        }
        declarations.push_str(&kept);
        imports.extend(names.into_iter().filter(|name| symbol_reference(name).is_some()));
    }
    if !declarations.is_empty() {
        text.push_str("\n\nIts declarations:\n```ts\n");
        text.push_str(&declarations);
        text.push_str("```");
    }
    AreaReference { text, imports }
}

/// The declaration files of the area `name`, whose index this is: those in
/// its namespace class's directory, such as `src/entities/tasks/` for
/// `TaskNamespace`.
fn area_declarations(name: &str, index: &str) -> Vec<(&'static str, &'static str)> {
    let Some(namespace) = index.lines().find_map(|line| {
        line.strip_prefix("### ")?
            .split_whitespace()
            .next()
            .filter(|class| class.ends_with("Namespace"))
    }) else {
        return Vec::new();
    };
    // Most areas live in their name's directory, `agentSessions` in
    // `agent-sessions`; searching every file is the fallback.
    let kebab: String = name
        .chars()
        .flat_map(|c| {
            let dash = c.is_ascii_uppercase().then_some('-');
            dash.into_iter().chain(std::iter::once(c.to_ascii_lowercase()))
        })
        .collect();
    let guessed = sdk_declaration_files(&format!("{ENTITY_DECLARATIONS}{kebab}/"));
    let declared = format!("class {namespace} ");
    if guessed.iter().any(|(_, text)| text.contains(&declared)) {
        return guessed;
    }
    sdk_declarations(&[namespace], usize::MAX)
        .into_iter()
        .filter(|(path, _)| path.starts_with(ENTITY_DECLARATIONS))
        .find_map(|(path, _)| path.rsplit_once('/'))
        .map(|(directory, _)| sdk_declaration_files(&format!("{directory}/")))
        .unwrap_or_default()
}

/// The names an `import` line takes from the SDK's generated clients, such
/// as `DecisionRequest` from `import type { DecisionRequest } from
/// '../../../generated/cognition/types.gen';`.
fn generated_imports(line: &str) -> Vec<String> {
    let Some((names, from)) = line.split_once('}') else {
        return Vec::new();
    };
    if !from.contains("/generated/") {
        return Vec::new();
    }
    let names = names.rsplit('{').next().unwrap_or_default();
    names
        .split(',')
        .filter_map(|name| {
            let name = name.trim();
            let name = name.strip_prefix("type ").unwrap_or(name);
            name.split_whitespace().next()
        })
        .map(str::to_owned)
        .collect()
}

/// The names a reference writes in backticks, such as `SearchOpts`.
fn backticked(reference: &str) -> impl Iterator<Item = &str> {
    reference.split('`').skip(1).step_by(2)
}

/// The identifiers type-checker messages quote, such as `'TaskNamespace'`
/// or the `Macro` of `'Macro<MacroOpts>'`, in order and once each.
fn quoted_names(problems: &[String]) -> Vec<String> {
    let mut names = Vec::new();
    for problem in problems {
        for quoted in problem.split('\'').skip(1).step_by(2) {
            let name: String = quoted
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
                .collect();
            if !name.is_empty() && !names.contains(&name) {
                names.push(name);
            }
        }
    }
    names
}

/// What `main` returned, or why the step failed, for the run's history.
fn result(outcome: Outcome) -> Result<Value, String> {
    match outcome {
        Outcome::Succeeded { value } if value.to_string().len() > MAX_OUTPUT_BYTES => Err(format!(
            "The step's output is {} KB as JSON; a step's output can be at most {} KB. Return only what later steps need.",
            value.to_string().len().div_ceil(1024),
            MAX_OUTPUT_BYTES / 1024
        )),
        Outcome::Succeeded { value } => Ok(value),
        Outcome::Failed { error } => Err(bounded(error.message)),
        Outcome::Cancelled => Err("The step was stopped before it finished.".to_owned()),
        Outcome::TimedOut => Err(format!(
            "The step ran out of time ({} seconds).",
            STEP_TIMEOUT_MS / 1000
        )),
    }
}

fn bounded(message: String) -> String {
    match message.char_indices().nth(MAX_MESSAGE_CHARS) {
        Some((end, _)) => format!("{}…", &message[..end]),
        None => message,
    }
}

/// The executor's SDK activity, as the step's calls.
#[derive(Default)]
struct Journal {
    calls: Vec<CallRecord>,
    /// Activity id to its call, for calls still running.
    running: HashMap<u64, usize>,
    truncated: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Activity {
    id: u64,
    service: String,
    operation: String,
    status: String,
}

impl Journal {
    fn observe(&mut self, value: Value, at: Duration) {
        if value.get("truncated") == Some(&Value::Bool(true)) {
            self.truncated = true;
            return;
        }
        let Ok(activity) = serde_json::from_value::<Activity>(value) else {
            return;
        };
        let at = u32::try_from(at.as_millis()).unwrap_or(u32::MAX);
        let ended = match activity.status.as_str() {
            "completed" => CallStatus::Completed,
            "failed" => CallStatus::Failed,
            "started" => return self.start(&activity, at, CallStatus::Unknown, None),
            "skipped" => return self.start(&activity, at, CallStatus::Skipped, Some(0)),
            "refused" => return self.start(&activity, at, CallStatus::Refused, Some(0)),
            _ => return,
        };
        if let Some(index) = self.running.remove(&activity.id)
            && let Some(call) = self.calls.get_mut(index)
        {
            call.status = ended;
            call.duration_ms = Some(at.saturating_sub(call.started_ms));
        }
    }

    fn start(&mut self, activity: &Activity, at: u32, status: CallStatus, duration: Option<u32>) {
        if self.calls.len() >= MAX_CALLS {
            self.truncated = true;
            return;
        }
        let key = format!("{}.{}", activity.service, activity.operation);
        // An operation missing from the catalog is treated as a write.
        let (label, write) = operations()
            .get(&key)
            .map_or_else(|| (key.clone(), true), |op| (op.label.clone(), op.write));
        if status == CallStatus::Unknown {
            self.running.insert(activity.id, self.calls.len());
        }
        self.calls.push(CallRecord {
            operation: key,
            label,
            write,
            status,
            started_ms: at,
            duration_ms: duration,
        });
    }
}
