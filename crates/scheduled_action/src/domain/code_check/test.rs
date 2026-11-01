use std::sync::Mutex;

use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;

use super::*;
use crate::domain::ports::{CodeOutcome, CodeRun, CodeUnavailable, NoRoutineCode};

/// Reports `problems` for any source containing `bad`, and counts checks.
#[derive(Default)]
struct Checker {
    checked: Mutex<Vec<String>>,
    unavailable: bool,
}

impl RoutineCode for Checker {
    fn sdk(&self) -> Option<routine_program::SdkFingerprint> {
        Some("0.3.0+current".to_owned().try_into().unwrap())
    }

    async fn check(&self, source: &str) -> Result<Vec<String>, CodeUnavailable> {
        if self.unavailable {
            return Err(CodeUnavailable("checker is down".into()));
        }
        self.checked.lock().unwrap().push(source.to_owned());
        Ok(if source.contains("bad") {
            vec!["TS2339 [ERROR]: Property 'nope' does not exist\n    at main.ts:1:1".into()]
        } else {
            Vec::new()
        })
    }

    async fn run(&self, _: &MacroUserIdStr<'static>, _: CodeRun<'_>) -> CodeOutcome {
        unreachable!("saving never runs code")
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

    async fn rewrite(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &routine_program::CodeStep,
        _: &[String],
    ) -> Result<String, String> {
        unreachable!("saving never rewrites code")
    }
}

fn task(sources: &[&str], sdk: Option<&str>) -> Value {
    let mut task = json!({ "steps": sources.iter().map(|source| json!({
        "type": "code", "title": "Label invoices", "source": source,
    })).collect::<Vec<_>>() });
    if let Some(sdk) = sdk {
        task["sdk"] = json!(sdk);
    }
    task
}

#[tokio::test]
async fn saved_code_records_the_sdk_it_checked_against() {
    let checker = Checker::default();
    // A fingerprint the client sends is never trusted.
    let checked = checked_task(&checker, &task(&["one", "two"], Some("forged")), None)
        .await
        .unwrap();
    assert_eq!(checked, task(&["one", "two"], Some("0.3.0+current")));
    assert_eq!(*checker.checked.lock().unwrap(), ["one", "two"]);
}

#[tokio::test]
async fn unchanged_code_checked_against_this_sdk_is_not_checked_again() {
    let checker = Checker::default();
    let stored = task(&["one"], Some("0.3.0+current"));
    checked_task(&checker, &task(&["one", "two"], None), Some(&stored))
        .await
        .unwrap();
    assert_eq!(*checker.checked.lock().unwrap(), ["two"]);

    // Stored code checked against another SDK is checked again.
    let checker = Checker::default();
    let stored = task(&["one"], Some("0.2.0+old"));
    checked_task(&checker, &task(&["one"], None), Some(&stored))
        .await
        .unwrap();
    assert_eq!(*checker.checked.lock().unwrap(), ["one"]);
}

#[tokio::test]
async fn problems_name_the_step_for_its_author() {
    let error = checked_task(&Checker::default(), &task(&["bad"], None), None)
        .await
        .unwrap_err();
    assert!(
        matches!(&error, CodeCheckError::DoesNotCheck { step, problems }
        if step == "Label invoices" && problems.len() == 1)
    );
    assert!(
        error
            .to_string()
            .contains("doesn't type-check against Macro's SDK")
    );
    assert!(error.to_string().contains("at main.ts:1:1"));
}

#[tokio::test]
async fn code_needs_a_checker_but_other_programs_do_not() {
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
    let agent = json!({ "steps": [{ "type": "agent", "model": "m", "instructions": "Go" }], "sdk": "stale" });
    assert_eq!(
        checked_task(&NoRoutineCode, &agent, None).await.unwrap(),
        json!({ "steps": [{ "type": "agent", "model": "m", "instructions": "Go" }] })
    );
}

#[test]
fn the_recorded_sdk_is_not_configuration() {
    assert!(same_task(
        &task(&["one"], Some("0.3.0+current")),
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
    assert_eq!(found.sdk, "0.3.0+current");
    assert_eq!(found.steps, routine_program::CODE_STEPS);
    assert!(found.contract.contains("interface StepContext"));
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
async fn checking_code_reports_its_problems_with_the_declarations_to_fix_them() {
    let checked = check(&Checker::default(), "fine").await.unwrap();
    assert_eq!(
        (checked.problems.len(), checked.declarations.as_str()),
        (0, "")
    );
    let checked = check(&Checker::default(), "bad").await.unwrap();
    assert_eq!(checked.problems.len(), 1);
    assert_eq!(checked.declarations, "declarations for 1 problems");
    assert_eq!(checked.sdk, "0.3.0+current");
}
