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
fn decisions_and_trigger_placeholders_need_an_event() {
    let summary =
        validate(json!([{ "type": "if", "condition": "Urgent?", "then": [agent()] }])).unwrap();
    assert_eq!(summary.questions, 1);
    assert!(summary.needs_event());
    let summary = validate(json!([tool(
        json!({ "content": "{{trigger.email.subject}}" })
    )]))
    .unwrap();
    assert!(summary.reads_trigger && summary.needs_event());
}

#[test]
fn agents_may_sit_in_different_branches_but_not_in_sequence() {
    validate(
        json!([{ "type": "if", "condition": "Urgent?", "then": [agent()], "else": [agent()] }]),
    )
    .unwrap();
    assert_eq!(
        validate(json!([agent(), agent()])),
        Err(ProgramError::TooManyAgents)
    );
    assert_eq!(
        validate(json!([agent(), { "type": "if", "condition": "Urgent?", "then": [agent()] }])),
        Err(ProgramError::TooManyAgents)
    );
    let options = |multiple: bool| {
        json!([{ "type": "choose", "multiple": multiple, "options": [
            { "label": "Bug", "steps": [agent()] },
            { "label": "Question", "steps": [agent()] }
        ] }])
    };
    validate(options(false)).unwrap();
    // Every fitting option runs, so two of them may both reach an agent.
    assert_eq!(validate(options(true)), Err(ProgramError::TooManyAgents));
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
fn step_references_only_reach_steps_that_ran_on_every_path() {
    let create =
        |id: &str| json!({ "type": "tool", "id": id, "tool": "CreateDocument", "arguments": {} });
    let read = |id: &str| tool(json!({ "content": format!("{{{{steps.{id}.documentId}}}}") }));
    let unknown =
        |steps: serde_json::Value| matches!(validate(steps), Err(ProgramError::UnknownStep(_)));

    // The `else` branch runs exactly when `then` didn't.
    assert!(unknown(json!([{ "type": "if", "condition": "Urgent?",
        "then": [create("task")], "else": [read("task")] }])));
    // Another option of a choice may not have run.
    assert!(unknown(json!([{ "type": "choose", "options": [
        { "label": "Invoice", "steps": [create("task")] },
        { "label": "Newsletter", "steps": [read("task")] }
    ] }])));
    // After the decision, its branches' steps may not have run.
    assert!(unknown(json!([
        { "type": "choose", "options": [
            { "label": "Invoice", "steps": [create("task")] },
            { "label": "Newsletter", "steps": [] }
        ] },
        read("task")
    ])));
    assert!(unknown(json!([
        { "type": "if", "condition": "Urgent?", "then": [create("task")] },
        read("task")
    ])));

    // Earlier in the same branch.
    validate(json!([{ "type": "if", "condition": "Urgent?",
        "then": [create("task"), read("task")] }]))
    .unwrap();
    // Earlier in an enclosing list, read inside a nested branch.
    validate(json!([
        create("task"),
        { "type": "if", "condition": "Urgent?", "then": [
            { "type": "choose", "options": [
                { "label": "A", "steps": [read("task")] },
                { "label": "B", "steps": [] }
            ] }
        ] }
    ]))
    .unwrap();
    // Ids stay unique across branches even though they can't see each other.
    assert!(matches!(
        validate(json!([{ "type": "if", "condition": "Urgent?",
            "then": [create("task")], "else": [create("task")] }])),
        Err(ProgramError::DuplicateStepId(_))
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
    let one_option = json!([{ "type": "choose", "options": [{ "label": "A" }] }]);
    assert_eq!(validate(one_option), Err(ProgramError::OptionCount));
    let duplicate =
        json!([{ "type": "choose", "options": [{ "label": "A" }, { "label": " a " }] }]);
    assert!(matches!(
        validate(duplicate),
        Err(ProgramError::DuplicateOption(_))
    ));
    let blank = json!([{ "type": "choose", "options": [{ "label": "A" }, { "label": " " }] }]);
    assert_eq!(validate(blank), Err(ProgramError::OptionLabel));
    let many: Vec<_> = (0..=limits::MAX_STEPS).map(|_| tool(json!({}))).collect();
    assert_eq!(validate(json!(many)), Err(ProgramError::TooManySteps));
    let mut nested = json!([tool(json!({}))]);
    for _ in 0..=limits::MAX_DEPTH {
        nested = json!([{ "type": "if", "condition": "Deeper?", "then": nested }]);
    }
    assert_eq!(validate(nested), Err(ProgramError::TooDeep));
    let big = tool(json!({ "content": "x".repeat(limits::MAX_ARGUMENT_BYTES) }));
    assert_eq!(validate(json!([big])), Err(ProgramError::ArgumentsTooLarge));
    assert!(matches!(
        validate(json!([tool(json!({ "content": "{{nope}}" }))])),
        Err(ProgramError::Template(_))
    ));
}

#[test]
fn all_decisions_fit_in_one_classifier_call() {
    let options: Vec<_> = (0..8)
        .map(|i| json!({ "label": format!("Option {i}") }))
        .collect();
    let choice = json!({ "type": "choose", "options": options });
    validate(json!([
        choice.clone(),
        choice.clone(),
        choice.clone(),
        choice.clone()
    ]))
    .unwrap();
    assert_eq!(
        validate(
            json!([choice.clone(), choice.clone(), choice.clone(), choice, { "type": "if", "condition": "One more?" }])
        ),
        Err(ProgramError::TooManyQuestions)
    );
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
