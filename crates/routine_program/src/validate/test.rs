use serde_json::json;

use super::*;

fn validate(steps: serde_json::Value) -> Result<ProgramSummary, ProgramError> {
    RoutineProgram::from_task(&json!({ "steps": steps }))
        .unwrap()
        .validate()
}

fn agent() -> serde_json::Value {
    json!({ "type": "agent", "model": "m", "instructions": "Do it" })
}

fn tool(arguments: serde_json::Value) -> serde_json::Value {
    json!({ "type": "tool", "tool": "SendChannelMessage", "arguments": arguments })
}

#[test]
fn a_plain_agent_needs_no_event() {
    let summary = validate(json!([agent()])).unwrap();
    assert!(!summary.needs_event());
}

#[test]
fn trigger_placeholders_need_an_event() {
    let summary = validate(json!([tool(
        json!({ "content": "{{trigger.email.subject}}" })
    )]))
    .unwrap();
    assert!(summary.reads_trigger && summary.needs_event());
}

#[test]
fn a_routine_hands_off_to_at_most_one_agent() {
    validate(json!([tool(json!({})), agent()])).unwrap();
    assert_eq!(
        validate(json!([agent(), agent()])),
        Err(ProgramError::TooManyAgents)
    );
}

#[test]
fn step_references_must_name_an_earlier_tool_step() {
    let create = json!({ "type": "tool", "id": "task", "tool": "CreateDocument", "arguments": {} });
    let read = tool(json!({ "content": "{{steps.task.documentId}}" }));
    validate(json!([create.clone(), read.clone()])).unwrap();
    assert!(matches!(
        validate(json!([read, create.clone()])),
        Err(ProgramError::UnknownStep(_))
    ));
    assert!(matches!(
        validate(json!([create.clone(), create])),
        Err(ProgramError::DuplicateStepId(_))
    ));
    let own = json!({ "type": "tool", "id": "me", "tool": "CreateDocument", "arguments": { "x": "{{steps.me.id}}" } });
    assert!(matches!(
        validate(json!([own])),
        Err(ProgramError::UnknownStep(_))
    ));
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
    let many: Vec<_> = (0..=limits::MAX_STEPS).map(|_| tool(json!({}))).collect();
    assert_eq!(validate(json!(many)), Err(ProgramError::TooManySteps));
    let big = tool(json!({ "content": "x".repeat(limits::MAX_ARGUMENT_BYTES) }));
    assert_eq!(validate(json!([big])), Err(ProgramError::ArgumentsTooLarge));
    assert!(matches!(
        validate(json!([tool(json!({ "content": "{{nope}}" }))])),
        Err(ProgramError::Template(_))
    ));
}

#[test]
fn required_apps_need_an_agent_to_hand_them_to() {
    let apps = json!([{ "app_slug": "linear", "server_name": "Linear" }]);
    let program = |steps: serde_json::Value| {
        RoutineProgram::from_task(&json!({ "steps": steps, "mcp_servers": apps })).unwrap()
    };
    program(json!([agent()])).validate().unwrap();
    assert_eq!(
        program(json!([tool(json!({ "content": "Hi" }))])).validate(),
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
fn code_steps_need_a_title_and_bounded_source() {
    let summary = validate(json!([code(json!({ "writes": ["email", "workspace"] }))])).unwrap();
    // Code reads its trigger when it has one; a scheduled run gets null.
    assert!(!summary.needs_event());
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
fn later_steps_can_read_a_code_steps_output_by_id() {
    validate(json!([
        code(json!({ "id": "invoice" })),
        tool(json!({ "content": "{{steps.invoice.total}}" })),
    ]))
    .unwrap();
    assert_eq!(
        validate(json!([
            code(json!({ "id": "invoice" })),
            tool(json!({ "content": "x" })),
            code(json!({ "id": "invoice" })),
        ])),
        Err(ProgramError::DuplicateStepId(
            "invoice".to_owned().try_into().unwrap()
        ))
    );
}

#[test]
fn unknown_write_scopes_do_not_parse() {
    assert!(
        RoutineProgram::from_task(&json!({ "steps": [code(json!({ "writes": ["auth"] }))] }))
            .is_err()
    );
}
