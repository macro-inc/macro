use serde_json::json;

use super::*;

fn validate(steps: serde_json::Value) -> Result<(), ProgramError> {
    RoutineProgram::from_task(&json!({ "steps": steps }))
        .unwrap()
        .validate()
}

fn agent() -> serde_json::Value {
    json!({ "type": "agent", "model": "m", "instructions": "Do it" })
}

fn code(extra: serde_json::Value) -> serde_json::Value {
    let mut step = json!({
        "type": "code",
        "title": "Label invoices",
        "source": "export async function main({ macro }: StepContext) { return 1; }",
    });
    step.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    step
}

#[test]
fn a_routine_hands_off_to_at_most_one_agent() {
    validate(json!([code(json!({})), agent()])).unwrap();
    assert_eq!(
        validate(json!([agent(), agent()])),
        Err(ProgramError::TooManyAgents)
    );
}

#[test]
fn structural_limits_are_enforced() {
    assert_eq!(validate(json!([])), Err(ProgramError::Empty));
    assert_eq!(
        validate(json!([{ "type": "agent", "instructions": "x" }])),
        Err(ProgramError::MissingTarget)
    );
    assert_eq!(
        validate(json!([{ "type": "agent", "model": " ", "instructions": "x" }])),
        Err(ProgramError::BlankModel)
    );
    assert_eq!(
        validate(json!([{ "type": "agent", "model": "m", "instructions": " " }])),
        Err(ProgramError::BlankInstructions)
    );
    let many: Vec<_> = (0..=limits::MAX_STEPS).map(|_| code(json!({}))).collect();
    assert_eq!(validate(json!(many)), Err(ProgramError::TooManySteps));
}

#[test]
fn required_apps_need_an_agent_to_hand_them_to() {
    let apps = json!([{ "app_slug": "linear", "server_name": "Linear" }]);
    let program = |steps: serde_json::Value| {
        RoutineProgram::from_task(&json!({ "steps": steps, "mcp_servers": apps })).unwrap()
    };
    program(json!([agent()])).validate().unwrap();
    assert_eq!(
        program(json!([code(json!({}))])).validate(),
        Err(ProgramError::AppsWithoutAgent)
    );
}

#[test]
fn old_single_agent_tasks_keep_the_rules_they_were_saved_under() {
    let long = "x".repeat(limits::MAX_INSTRUCTION_CHARS + 1);
    let legacy = |user_prompt: &str| {
        RoutineProgram::from_task(
            &json!({ "model": "m", "prompt": "", "user_prompt": user_prompt }),
        )
        .unwrap()
    };
    legacy(&long).validate().unwrap();
    legacy("").validate().unwrap();
    assert_eq!(
        validate(json!([{ "type": "agent", "model": "m", "instructions": long }])),
        Err(ProgramError::InstructionsTooLong)
    );
    // Its target still has to resolve.
    assert_eq!(
        RoutineProgram::from_task(&json!({ "prompt": "", "user_prompt": "x" }))
            .unwrap()
            .validate(),
        Err(ProgramError::MissingTarget)
    );
}

#[test]
fn code_steps_need_a_title_and_bounded_source() {
    validate(json!([code(json!({ "writes": ["email", "workspace"] }))])).unwrap();
    assert_eq!(
        validate(json!([code(json!({ "title": "  " }))])),
        Err(ProgramError::CodeTitle)
    );
    assert_eq!(
        validate(json!([code(json!({ "source": "" }))])),
        Err(ProgramError::CodeSource)
    );
    assert_eq!(
        validate(json!([code(
            json!({ "source": "x".repeat(limits::MAX_SOURCE_BYTES + 1) })
        )])),
        Err(ProgramError::CodeSource)
    );
    assert_eq!(
        validate(json!([code(json!({ "writes": ["email", "email"] }))])),
        Err(ProgramError::DuplicateWriteScope("email".into()))
    );
}

#[test]
fn step_ids_are_unique() {
    assert_eq!(
        validate(json!([
            code(json!({ "id": "invoice" })),
            agent(),
            code(json!({ "id": "invoice" })),
        ])),
        Err(ProgramError::DuplicateStepId(
            "invoice".to_owned().try_into().unwrap()
        ))
    );
}

#[test]
fn removed_step_types_do_not_parse() {
    for step in [
        json!({ "type": "tool", "tool": "CreateDocument", "arguments": {} }),
        json!({ "type": "if", "condition": "Urgent?", "then": [] }),
        json!({ "type": "choose", "options": [] }),
        code(json!({ "writes": ["auth"] })),
    ] {
        assert!(RoutineProgram::from_task(&json!({ "steps": [step] })).is_err());
    }
}
