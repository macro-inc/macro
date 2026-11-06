use std::sync::Mutex;

use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;

use super::*;
use crate::domain::ports::{CodeOutcome, CodeRun, CodeUnavailable, NoRoutineCode};

const VERSION: &str = "0.3.0+current+ctx.0000";

/// Reports a problem for every code step whose source contains `bad`, and
/// records the programs it checked, as their steps' sources.
#[derive(Default)]
pub(crate) struct Checker {
    pub checked: Mutex<Vec<Vec<String>>>,
    pub unavailable: bool,
    /// What a run returns; saving never runs code, drafting looks up names.
    pub runs: Option<serde_json::Value>,
    /// The knobs each run's step had.
    pub ran: Mutex<Vec<serde_json::Map<String, serde_json::Value>>>,
    /// Runs never finish.
    pub hangs: bool,
}

impl RoutineCode for Checker {
    fn sdk(&self) -> Option<routine_program::SdkFingerprint> {
        Some(VERSION.to_owned().try_into().unwrap())
    }

    async fn check_program(
        &self,
        program: &RoutineProgram,
    ) -> Result<Vec<StepProblems>, CodeUnavailable> {
        if self.unavailable {
            return Err(CodeUnavailable("checker is down".into()));
        }
        let steps = program.code_steps();
        self.checked
            .lock()
            .unwrap()
            .push(steps.iter().map(|step| step.source.clone()).collect());
        Ok(steps
            .iter()
            .enumerate()
            .filter(|(_, step)| step.source.contains("bad"))
            .map(|(index, step)| StepProblems {
                index,
                title: step.title.clone(),
                problems: vec![
                    "TS2339 [ERROR]: Property 'nope' does not exist\n    at step_0.ts:1:1".into(),
                ],
            })
            .collect())
    }

    async fn owner_time_zone(&self, _: &MacroUserIdStr<'static>) -> Option<String> {
        None
    }

    async fn run(&self, _: &MacroUserIdStr<'static>, run: CodeRun<'_>) -> CodeOutcome {
        assert!(run.dry_run, "only dry runs here");
        self.ran.lock().unwrap().push(run.step.knob_values());
        if self.hangs {
            std::future::pending::<()>().await;
        }
        CodeOutcome {
            result: self
                .runs
                .clone()
                .ok_or_else(|| "no code runs here".to_owned()),
            calls: Vec::new(),
            calls_truncated: false,
            waited_ms: None,
        }
    }

    async fn reference(
        &self,
        _: &MacroUserIdStr<'static>,
        task: &str,
    ) -> Result<String, CodeUnavailable> {
        Ok(format!("TaskNamespace methods for: {task}"))
    }

    fn declarations(&self, problems: &[String]) -> String {
        format!("declarations for {} problems", problems.len())
    }

    fn symbol_references(&self, symbols: &[String], _: &str) -> String {
        if symbols.is_empty() {
            String::new()
        } else {
            format!("reference for {}", symbols.join(", "))
        }
    }

    async fn rewrite(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &routine_program::CodeStep,
        _: &str,
        _: &[String],
    ) -> Result<String, String> {
        unreachable!("saving never rewrites code")
    }
}

fn steps(sources: &[&str]) -> Value {
    json!(
        sources
            .iter()
            .map(|source| json!({ "type": "code", "title": "Label invoices", "source": source }))
            .collect::<Vec<_>>()
    )
}

fn task(sources: &[&str], sdk: Option<&str>) -> Value {
    let mut task = json!({ "steps": steps(sources) });
    if let Some(sdk) = sdk {
        task["sdk"] = json!(sdk);
    }
    task
}

#[tokio::test]
async fn saved_code_is_checked_together_and_records_the_version_and_ids() {
    let checker = Checker::default();
    // A version the client sends is never trusted.
    let checked = checked_task(&checker, &task(&["one", "two"], Some("forged")), None)
        .await
        .unwrap();
    assert_eq!(checked["sdk"], VERSION);
    assert_eq!(checked["steps"][0]["id"], "label_invoices");
    assert_eq!(checked["steps"][1]["id"], "label_invoices_2");
    assert_eq!(*checker.checked.lock().unwrap(), [["one", "two"]]);
}

#[tokio::test]
async fn unchanged_code_checked_against_this_version_is_not_checked_again() {
    let checker = Checker::default();
    let stored = checked_task(&checker, &task(&["one"], None), None)
        .await
        .unwrap();
    checker.checked.lock().unwrap().clear();
    let mut resubmitted = stored.clone();
    resubmitted.as_object_mut().unwrap().remove("sdk");
    checked_task(&checker, &resubmitted, Some(&stored))
        .await
        .unwrap();
    assert!(checker.checked.lock().unwrap().is_empty());

    // Any change checks every code step again, together.
    let mut changed = stored.clone();
    changed["steps"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "type": "code", "title": "More", "source": "two" }));
    checked_task(&checker, &changed, Some(&stored))
        .await
        .unwrap();
    assert_eq!(*checker.checked.lock().unwrap(), [["one", "two"]]);

    // So does code last checked against another version.
    checker.checked.lock().unwrap().clear();
    let mut old = stored.clone();
    old["sdk"] = json!("0.2.0+old");
    checked_task(&checker, &resubmitted, Some(&old))
        .await
        .unwrap();
    assert_eq!(checker.checked.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn problems_name_every_failing_step_for_its_author() {
    let error = checked_task(
        &Checker::default(),
        &task(&["bad", "fine", "bad"], None),
        None,
    )
    .await
    .unwrap_err();
    let CodeCheckError::DoesNotCheck { steps } = &error else {
        panic!("{error:?}");
    };
    assert_eq!(
        steps.iter().map(|step| step.index).collect::<Vec<_>>(),
        [0, 2]
    );
    assert!(
        error
            .to_string()
            .contains("doesn't type-check against Macro's SDK")
    );
    assert!(error.to_string().contains("at step_0.ts:1:1"));
}

#[tokio::test]
async fn code_needs_a_checker_but_other_programs_only_get_ids() {
    let unavailable = Checker {
        unavailable: true,
        ..Checker::default()
    };
    assert_eq!(
        checked_task(&unavailable, &task(&["one"], None), None).await,
        Err(CodeCheckError::Unavailable("checker is down".into()))
    );
    assert!(matches!(
        checked_task(&NoRoutineCode, &task(&["one"], None), None).await,
        Err(CodeCheckError::Unavailable(_))
    ));
    let agent = json!({
        "steps": [{ "type": "agent", "model": "m", "instructions": "Go" }],
        "sdk": "stale",
    });
    assert_eq!(
        checked_task(&NoRoutineCode, &agent, None).await.unwrap(),
        json!({ "steps": [{ "type": "agent", "model": "m", "instructions": "Go" }] })
    );
    // A task from before steps keeps its shape.
    let legacy = json!({ "model": "m", "prompt": "", "user_prompt": "Go" });
    assert_eq!(
        checked_task(&NoRoutineCode, &legacy, None).await.unwrap(),
        legacy
    );
}

#[test]
fn the_recorded_sdk_is_not_configuration() {
    assert!(same_task(
        &task(&["one"], Some(VERSION)),
        &task(&["one"], None)
    ));
    assert!(!same_task(&task(&["one"], None), &task(&["two"], None)));
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()
}

#[tokio::test]
async fn a_guide_carries_the_shared_rules_the_contract_and_the_tasks_reference() {
    let found = guide(
        &Checker::default(),
        &user(),
        "  go through my notifications  ",
    )
    .await
    .unwrap();
    assert_eq!(found.sdk, VERSION);
    assert_eq!(found.steps, routine_program::CODE_STEPS);
    assert_eq!(found.examples, starters(&Checker::default()));
    assert!(found.contract.contains("interface RoutineStepContext"));
    assert_eq!(
        found.reference,
        "TaskNamespace methods for: go through my notifications"
    );
    for task in ["  ", &"x".repeat(MAX_TASK_CHARS + 1)] {
        let error = guide(&Checker::default(), &user(), task).await.unwrap_err();
        assert!(error.downcast_ref::<InvalidCodeTask>().is_some());
    }
    assert!(guide(&NoRoutineCode, &user(), "task").await.is_err());
}

#[tokio::test]
async fn checking_steps_reports_each_failing_step_with_declarations_to_fix_it() {
    let checked = check(&Checker::default(), &steps(&["fine"])).await.unwrap();
    assert!(checked.steps.is_empty());
    let checked = check(&Checker::default(), &steps(&["fine", "bad"]))
        .await
        .unwrap();
    assert_eq!(checked.sdk, VERSION);
    assert_eq!(checked.steps.len(), 1);
    assert_eq!(checked.steps[0].index, 1);
    assert_eq!(checked.steps[0].declarations, "declarations for 1 problems");
    let error = check(&Checker::default(), &json!([{ "type": "nope" }]))
        .await
        .unwrap_err();
    assert!(error.downcast_ref::<InvalidCodeSteps>().is_some());
}

#[tokio::test]
async fn checking_steps_reports_knobs_and_sentences_saving_would_refuse() {
    let step = json!({
        "type": "code",
        "title": "Label",
        "source": "export async function main({ knobs }: StepContext) { return knobs.label; }",
        "knobs": [{ "type": "text", "name": "label", "label": "Label", "value": "vc" }],
        "sentence": "Label it {label} when {?aboutMoney}.",
    });
    let checked = check(&Checker::default(), &json!([step])).await.unwrap();
    assert_eq!(checked.steps.len(), 1);
    assert_eq!(checked.steps[0].index, 0);
    assert_eq!(
        checked.steps[0].problems,
        ["the sentence shows `aboutMoney`, but the step has no knob by that name"]
    );
}

#[test]
fn starters_are_offered_as_code_only_where_code_can_be_saved() {
    assert!(starters(&NoRoutineCode).is_empty());
    let offered = starters(&Checker::default());
    assert_eq!(
        offered
            .iter()
            .map(|starter| starter.key.as_str())
            .collect::<Vec<_>>(),
        ["inbox", "triage", "updates", "invoices"]
    );
    for starter in &offered {
        assert_eq!(starter.steps.len(), 1);
        assert_eq!(starter.steps[0]["type"], "code");
        // Each is a program that saves as it is.
        RoutineProgram::from_task(&json!({ "steps": starter.steps }))
            .unwrap()
            .validate()
            .unwrap();
    }
}
