//! Run routine code steps as the routine's owner in the harness's Deno
//! executor, under the step's write scopes, and type-check them against the
//! SDK.
//!
//! Each SDK call the code makes becomes one entry in the run's history: the
//! operation and how it ended, never its arguments or results.

use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
    time::{Duration, Instant},
};

use agent::structured_output::{DynamicSchema, dynamic_structured_completion};
use agent::{Message, PredefinedModel};
use agent_egress::outbound::macro_mcp::MacroApiTokenSigner;
use code_execution::domain::{
    CheckError, ExecuteRequest, Outcome, ProgramChecker, ProgramExecutor, RunEnvironment,
    Unattended, WritePolicy, operations, sdk_declarations,
};
use macro_user_id::user_id::MacroUserIdStr;
use routine_program::{CallRecord, CallStatus, CodeStep, STEP_CONTEXT, SdkFingerprint};
use scheduled_action::domain::ports::{CodeOutcome, CodeRun, CodeUnavailable, RoutineCode};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

/// A step's whole budget, including waiting for an executor slot.
const STEP_TIMEOUT_MS: u64 = 30_000;
/// The credential outlives the step's deadline by a margin; it expires rather
/// than being revoked.
const TOKEN_LIFETIME_SECONDS: usize = 60;
/// Largest output kept for later steps; anything larger becomes null.
const MAX_OUTPUT_BYTES: usize = 32 * 1024;
/// Longest failure message kept in the run's history.
const MAX_MESSAGE_CHARS: usize = 500;
/// Calls recorded per step; the executor reports at most this many.
const MAX_CALLS: usize = 128;
/// SDK declarations a rewrite reads, in bytes.
const REWRITE_DECLARATION_BYTES: usize = 48 * 1024;

const REWRITE_INSTRUCTIONS: &str = "You maintain TypeScript that a Macro routine runs against Macro's SDK. Macro's SDK has changed and the code no longer type-checks. Rewrite it so it type-checks against the declarations you are given, changing only what the type checker's errors require. Keep exactly what it does: the same reads, the same changes, the same decisions and the same return value. Keep the module's shape: `export async function main({ macro, trigger, steps }: StepContext)`, no imports. If a call it made no longer exists, use the declarations' replacement for it.";

/// Mints the short-lived token a routine's code acts as its owner with.
pub trait RoutineCredentials: Send + Sync + 'static {
    /// A token for `owner` that outlives one step's deadline.
    fn mint(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> impl std::future::Future<Output = anyhow::Result<String>> + Send;
}

impl RoutineCredentials for MacroApiTokenSigner {
    async fn mint(&self, owner: &MacroUserIdStr<'static>) -> anyhow::Result<String> {
        // Writes are the owner's own, not an agent's.
        Ok(self
            .mint_for_agent(owner, TOKEN_LIFETIME_SECONDS, None)
            .await?)
    }
}

/// Routine code over the harness's own executor and type checker.
pub struct SdkRoutineCode<Credentials = MacroApiTokenSigner> {
    executor: Arc<dyn ProgramExecutor>,
    checker: Arc<dyn ProgramChecker>,
    credentials: Credentials,
    hosts: BTreeMap<String, String>,
    recorder: Arc<dyn ai_usage::UsageRecorder>,
}

impl<Credentials> SdkRoutineCode<Credentials> {
    /// `executor` should be routines' own, so they can't take the slots
    /// agent sessions use. Rewrites for new SDKs are billed to the
    /// routine's owner through `recorder`.
    pub fn new(
        executor: Arc<dyn ProgramExecutor>,
        checker: Arc<dyn ProgramChecker>,
        credentials: Credentials,
        hosts: BTreeMap<String, String>,
        recorder: Arc<dyn ai_usage::UsageRecorder>,
    ) -> Self {
        Self {
            executor,
            checker,
            credentials,
            hosts,
            recorder,
        }
    }
}

impl<Credentials: RoutineCredentials> RoutineCode for SdkRoutineCode<Credentials> {
    fn sdk(&self) -> Option<SdkFingerprint> {
        SdkFingerprint::try_from(self.checker.sdk_fingerprint().to_owned()).ok()
    }

    async fn check(&self, source: &str) -> Result<Vec<String>, CodeUnavailable> {
        match self.checker.check(source, STEP_CONTEXT).await {
            Ok(diagnostics) => Ok(diagnostics
                .into_iter()
                .map(|diagnostic| diagnostic.message)
                .collect()),
            Err(CheckError::InvalidSource) => Ok(vec![
                "The code is empty or larger than the 64 KiB limit.".to_owned(),
            ]),
            Err(error) => Err(CodeUnavailable(format!(
                "The code couldn't be type-checked: {error}"
            ))),
        }
    }

    // Arguments, outputs and failures are the owner's content; the span
    // records only their shape.
    #[tracing::instrument(name = "routine.code", skip_all, fields(
        dry_run = run.dry_run,
        source_bytes = run.step.source.len(),
        outcome = tracing::field::Empty,
    ))]
    async fn run(&self, owner: &MacroUserIdStr<'static>, run: CodeRun<'_>) -> CodeOutcome {
        let token = match self.credentials.mint(owner).await {
            Ok(token) => token,
            Err(error) => {
                tracing::error!(?error, "could not mint a routine code credential");
                return CodeOutcome {
                    result: Err("This step's credential couldn't be issued.".to_owned()),
                    calls: Vec::new(),
                    calls_truncated: false,
                };
            }
        };
        let mut arguments = Map::new();
        arguments.insert(
            "trigger".into(),
            run.trigger.cloned().unwrap_or(Value::Null),
        );
        arguments.insert("steps".into(), run.steps.clone());
        let writes = if run.dry_run {
            WritePolicy::DryRun
        } else {
            WritePolicy::Services {
                services: run
                    .step
                    .writes
                    .iter()
                    .map(|scope| scope.service().to_owned())
                    .collect(),
            }
        };
        let environment = RunEnvironment {
            token,
            trace_headers: crate::code_mode::trace_headers(),
            hosts: self.hosts.clone(),
            session_id: None,
            execution_id: None,
            unattended: Some(Unattended { arguments, writes }),
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
        }
    }

    async fn rewrite(
        &self,
        owner: &MacroUserIdStr<'static>,
        step: &CodeStep,
        problems: &[String],
    ) -> Result<String, String> {
        self.rewrite_source(owner, step, problems)
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
        problems: &[String],
    ) -> anyhow::Result<String> {
        let names = quoted_names(problems);
        let names: Vec<&str> = names.iter().map(String::as_str).collect();
        let declarations: String = sdk_declarations(&names, REWRITE_DECLARATION_BYTES)
            .into_iter()
            .map(|(path, text)| format!("// @macro-inc/sdk/{path}\n{text}\n"))
            .collect();
        let prompt = format!(
            "Step: {title}\n{summary}\n\nIts code:\n```ts\n{source}\n```\n\nThe type checker's errors against the current SDK:\n{problems}\n\nThe type of `main`'s argument:\n```ts\n{STEP_CONTEXT}```\n\nThe current SDK's declarations for the types in those errors:\n```ts\n{declarations}```",
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
        Outcome::Succeeded { value } if value.to_string().len() > MAX_OUTPUT_BYTES => {
            Ok(Value::Null)
        }
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
