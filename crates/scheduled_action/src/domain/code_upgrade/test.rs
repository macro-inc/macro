use std::sync::Mutex;

use serde_json::json;

use super::*;
use crate::domain::ports::{CodeOutcome, CodeUnavailable};
use crate::domain::program_runner::test::{OWNER, action};

const CURRENT: &str = "0.3.0+current";

/// Code that uses `tasks.create` fails to check; the model rewrites it to
/// `tasks.add`, unless `rewrite_fails`; a dry run fails if `dry_run_fails`.
#[derive(Default)]
struct Code {
    /// A step that reads `steps.count` fails once an earlier step returns a
    /// string instead, as the type checker would find with the steps typed.
    readers_break: bool,
    rewrite_fails: bool,
    rewrite_still_fails: bool,
    dry_run_fails: bool,
    dry_runs: Mutex<Vec<(Value, bool)>>,
    rewrites: Mutex<Vec<(String, Vec<String>)>>,
}

impl RoutineCode for Code {
    fn sdk(&self) -> Option<SdkFingerprint> {
        Some(CURRENT.to_owned().try_into().unwrap())
    }

    async fn check_program(
        &self,
        program: &RoutineProgram,
    ) -> std::result::Result<Vec<StepProblems>, CodeUnavailable> {
        let steps = program.code_steps();
        let returns_string = |index: usize| {
            steps[..index]
                .iter()
                .any(|step| step.source.contains("return String"))
        };
        Ok(steps
            .iter()
            .enumerate()
            .filter(|(index, step)| {
                step.source.contains("tasks.create")
                    || step.source.contains("still broken")
                    || (self.readers_break
                        && step.source.contains("steps.count")
                        && returns_string(*index))
            })
            .map(|(index, step)| StepProblems {
                index,
                title: step.title.clone(),
                problems: vec![
                    "TS2339 [ERROR]: Property 'create' does not exist on type 'TaskNamespace'."
                        .into(),
                ],
            })
            .collect())
    }

    async fn owner_time_zone(&self, _: &MacroUserIdStr<'static>) -> Option<String> {
        None
    }

    async fn run(&self, _: &MacroUserIdStr<'static>, run: CodeRun<'_>) -> CodeOutcome {
        self.dry_runs
            .lock()
            .unwrap()
            .push((run.context.clone(), run.dry_run));
        CodeOutcome {
            result: if self.dry_run_fails {
                Err("TypeError: cannot read properties of undefined".into())
            } else {
                Ok(Value::Null)
            },
            calls: Vec::new(),
            calls_truncated: false,
            waited_ms: None,
        }
    }

    async fn reference(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
    ) -> std::result::Result<String, CodeUnavailable> {
        Ok(String::new())
    }

    fn declarations(&self, _: &[String]) -> String {
        String::new()
    }

    async fn rewrite(
        &self,
        _: &MacroUserIdStr<'static>,
        step: &routine_program::CodeStep,
        steps: &str,
        problems: &[String],
    ) -> std::result::Result<String, String> {
        self.rewrites
            .lock()
            .unwrap()
            .push((steps.to_owned(), problems.to_vec()));
        if self.rewrite_fails {
            return Err("the model is unavailable".into());
        }
        if self.rewrite_still_fails {
            return Ok("still broken".into());
        }
        if self.readers_break {
            return Ok("return String(await macro.tasks.add(x))".into());
        }
        Ok(step.source.replace("tasks.create", "tasks.add"))
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Recorded {
    Checked(String),
    Claimed(String),
    Saved(Value),
    NeedsUpdate(String, Option<Value>),
}

struct Upgrades {
    claimable: bool,
    recorded: Mutex<Vec<Recorded>>,
}

impl Default for Upgrades {
    fn default() -> Self {
        Self {
            claimable: true,
            recorded: Mutex::default(),
        }
    }
}

impl CodeUpgrades for Upgrades {
    async fn record_checked(&self, _: &ScheduledAction, sdk: &SdkFingerprint) -> Result<()> {
        self.recorded
            .lock()
            .unwrap()
            .push(Recorded::Checked(sdk.to_string()));
        Ok(())
    }

    async fn claim_rewrite(&self, _: &ScheduledAction, sdk: &SdkFingerprint) -> Result<bool> {
        self.recorded
            .lock()
            .unwrap()
            .push(Recorded::Claimed(sdk.to_string()));
        Ok(self.claimable)
    }

    async fn save_rewrite(
        &self,
        _: &ScheduledAction,
        _: &SdkFingerprint,
        task: &Value,
    ) -> Result<()> {
        self.recorded
            .lock()
            .unwrap()
            .push(Recorded::Saved(task.clone()));
        Ok(())
    }

    async fn needs_update(
        &self,
        _: &ScheduledAction,
        _: &SdkFingerprint,
        reason: &str,
        proposal: Option<&Value>,
    ) -> Result<()> {
        self.recorded
            .lock()
            .unwrap()
            .push(Recorded::NeedsUpdate(reason.into(), proposal.cloned()));
        Ok(())
    }

    async fn stale_routines(
        &self,
        _: &SdkFingerprint,
        _: Option<Uuid>,
        _: u16,
    ) -> Result<Vec<Uuid>> {
        Ok(Vec::new())
    }

    async fn list_upgrades(&self, _: Uuid) -> Result<Vec<CodeUpgrade>> {
        Ok(Vec::new())
    }
}

fn routine(source: &str, sdk: Option<&str>) -> ScheduledAction {
    let mut task = json!({ "steps": [
        { "type": "code", "title": "File invoices", "source": source },
        { "type": "agent", "model": "m", "instructions": "Summarize" },
    ] });
    if let Some(sdk) = sdk {
        task["sdk"] = json!(sdk);
    }
    action(task)
}

fn context() -> Value {
    json!({
        "run": { "id": "run-1", "at": "2026-11-01T09:00:00Z", "timezone": "UTC", "dryRun": false },
        "trigger": { "kind": "event", "event": "email.message_received", "item": { "entity_id": "thread-1" } },
    })
}

async fn upgrade(
    code: &Code,
    upgrades: &Upgrades,
    action: &ScheduledAction,
) -> Result<RoutineProgram> {
    current_code(
        code,
        upgrades,
        &MacroUserIdStr::parse_from_str(OWNER).unwrap(),
        action,
        RoutineProgram::from_task(&action.task).unwrap(),
        &context(),
    )
    .await
}

#[tokio::test]
async fn code_on_the_current_sdk_is_left_alone() {
    let (code, upgrades) = (Code::default(), Upgrades::default());
    let program = upgrade(&code, &upgrades, &routine("tasks.create", Some(CURRENT)))
        .await
        .unwrap();
    assert_eq!(program.code_steps()[0].source, "tasks.create");
    assert!(upgrades.recorded.lock().unwrap().is_empty());
}

#[tokio::test]
async fn code_that_still_checks_only_records_the_new_sdk() {
    let (code, upgrades) = (Code::default(), Upgrades::default());
    let program = upgrade(&code, &upgrades, &routine("tasks.add", Some("0.2.0+old")))
        .await
        .unwrap();
    assert_eq!(program.sdk.unwrap().as_str(), CURRENT);
    assert_eq!(
        *upgrades.recorded.lock().unwrap(),
        [Recorded::Checked(CURRENT.into())]
    );
    assert!(code.rewrites.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failing_code_is_rewritten_checked_dry_run_and_saved_once() {
    let (code, upgrades) = (Code::default(), Upgrades::default());
    let action = routine("await macro.tasks.create(x)", Some("0.2.0+old"));
    let program = upgrade(&code, &upgrades, &action).await.unwrap();
    assert_eq!(program.code_steps()[0].source, "await macro.tasks.add(x)");
    // The model saw the code's problems, not the trigger.
    assert_eq!(code.rewrites.lock().unwrap().len(), 1);
    let dry_runs = code.dry_runs.lock().unwrap().clone();
    assert_eq!(dry_runs.len(), 1);
    let (context, dry_run) = &dry_runs[0];
    assert!(*dry_run);
    // The dry run replays this run's trigger and time, marked as a dry run.
    assert_eq!(context["trigger"]["item"]["entity_id"], "thread-1");
    assert_eq!(context["run"]["at"], "2026-11-01T09:00:00Z");
    assert_eq!(context["run"]["dryRun"], true);
    let recorded = upgrades.recorded.lock().unwrap().clone();
    assert_eq!(recorded[0], Recorded::Claimed(CURRENT.into()));
    let Recorded::Saved(task) = &recorded[1] else {
        panic!("{recorded:?}");
    };
    assert_eq!(task["sdk"], CURRENT);
    assert_eq!(task["steps"][0]["source"], "await macro.tasks.add(x)");
    assert_eq!(task["steps"][1]["type"], "agent");
}

#[tokio::test]
async fn another_runs_rewrite_or_a_past_failure_fails_this_run() {
    let code = Code::default();
    let upgrades = Upgrades {
        claimable: false,
        ..Upgrades::default()
    };
    let error = upgrade(&code, &upgrades, &routine("tasks.create", None))
        .await
        .unwrap_err();
    assert!(error.downcast_ref::<NeedsUpdate>().is_some());
    assert!(code.rewrites.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_rewrite_that_fails_its_checks_pauses_the_routine_with_it() {
    for (code, expected) in [
        (
            Code {
                rewrite_fails: true,
                ..Code::default()
            },
            "couldn't be updated: the model is unavailable",
        ),
        (
            Code {
                rewrite_still_fails: true,
                ..Code::default()
            },
            "the update doesn't type-check",
        ),
        (
            Code {
                dry_run_fails: true,
                ..Code::default()
            },
            "the update failed a dry run",
        ),
    ] {
        let upgrades = Upgrades::default();
        let error = upgrade(&code, &upgrades, &routine("tasks.create", None))
            .await
            .unwrap_err();
        let NeedsUpdate(reason) = error.downcast_ref::<NeedsUpdate>().unwrap().clone();
        assert!(reason.contains(expected), "{reason}");
        let recorded = upgrades.recorded.lock().unwrap().clone();
        let Recorded::NeedsUpdate(recorded_reason, proposal) = &recorded[1] else {
            panic!("{recorded:?}");
        };
        assert_eq!(*recorded_reason, reason);
        // A rewrite that exists is kept for the owner to review.
        assert_eq!(proposal.is_some(), !code.rewrite_fails);
    }
}

#[tokio::test]
async fn a_rewrite_must_still_suit_the_steps_that_read_its_output() {
    let code = Code {
        readers_break: true,
        ..Code::default()
    };
    let upgrades = Upgrades::default();
    let action = action(json!({ "steps": [
        { "type": "code", "id": "count", "title": "Count tasks", "source": "await macro.tasks.create(x); return { n: 1 }" },
        { "type": "code", "title": "Report", "source": "return steps.count.n" },
    ] }));
    let error = upgrade(&code, &upgrades, &action).await.unwrap_err();
    let NeedsUpdate(reason) = error.downcast_ref::<NeedsUpdate>().unwrap().clone();
    assert!(reason.contains("\"Report\""), "{reason}");
    assert!(reason.contains("doesn't type-check"), "{reason}");
    // The model saw the first step's own view of the outputs before it.
    let rewrites = code.rewrites.lock().unwrap().clone();
    assert_eq!(rewrites.len(), 1);
    assert!(
        rewrites[0]
            .0
            .starts_with("type StepContext = RoutineStepContext<")
    );
}

/// A later step reads outputs that don't exist before the run, so its
/// rewrite stands on the joint type check rather than a dry run.
#[tokio::test]
async fn a_rewritten_later_step_is_checked_but_not_dry_run() {
    let code = Code {
        dry_run_fails: true,
        ..Code::default()
    };
    let upgrades = Upgrades::default();
    let action = action(json!({ "steps": [
        { "type": "code", "id": "count", "title": "Count tasks", "source": "return { n: 1 }" },
        { "type": "code", "title": "Report", "source": "await macro.tasks.create(steps.count.n)" },
    ], "sdk": "0.2.0+old" }));
    let program = upgrade(&code, &upgrades, &action).await.unwrap();
    assert_eq!(
        program.code_steps()[1].source,
        "await macro.tasks.add(steps.count.n)"
    );
    assert!(code.dry_runs.lock().unwrap().is_empty());
}
