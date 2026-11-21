use super::*;
use crate::expr::typed::{Flag, JobOutput};

#[test]
fn numeric_budgets_stay_numeric_and_conditional_budgets_serialize_as_expressions() {
    let literal = serde_json::to_value(Job::default().timeout_minutes(20u32)).unwrap();
    assert_eq!(literal["timeout-minutes"], 20);

    let guard = JobOutput::<Flag>::new("path-check", "loro_guards");
    let expression = guard.read().is_set().then_else(30i64, 20i64);
    let job = Job::default().timeout_minutes(expression);
    let value = serde_json::to_value(job).unwrap();
    assert_eq!(
        value["timeout-minutes"],
        "${{ needs.path-check.outputs.loro_guards == 'true' && 30 || 20 }}"
    );
    let decoded: Job = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), value);
    assert!(serde_json::from_value::<Job>(serde_json::json!({
        "timeout-minutes": true
    }))
    .is_err());
}

#[test]
fn timeout_expressions_still_use_the_job_context_checker() {
    let job: Job = serde_json::from_value(serde_json::json!({
        "runs-on": "ubuntu-latest",
        "timeout-minutes": "${{ steps.work.outputs.minutes }}"
    }))
    .unwrap();
    let error = crate::Workflow::new("invalid timeout")
        .add_job("check", job)
        .to_string()
        .unwrap_err();
    assert!(format!("{error:?}").contains("steps"), "{error:?}");
}

#[test]
fn timeout_expressions_still_reject_missing_job_references() {
    let guard = JobOutput::<Flag>::new("missing", "loro_guards");
    let error = crate::Workflow::new("invalid timeout reference")
        .add_job(
            "check",
            Job::default().timeout_minutes(guard.read().is_set().then_else(30i64, 20i64)),
        )
        .to_string()
        .unwrap_err();
    let detail = format!("{error:?}");
    assert!(detail.contains("missing"), "{detail}");
    assert!(detail.contains("needs"), "{detail}");
}
