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

fn knobbed(knobs: serde_json::Value, sentence: Option<&str>) -> Result<(), ProgramError> {
    let mut extra = json!({
        "source": "export async function main({ macro, knobs }: StepContext) { return [knobs.label, knobs.days, knobs.priority, knobs.aboutMoney]; }",
        "knobs": knobs,
    });
    if let Some(sentence) = sentence {
        extra["sentence"] = json!(sentence);
    }
    validate(json!([code(extra)]))
}

fn label() -> serde_json::Value {
    json!({ "type": "text", "name": "label", "label": "Label", "value": "vc" })
}

fn about_money() -> serde_json::Value {
    json!({ "type": "question", "name": "aboutMoney", "label": "it's about money", "value": "Is it about money?" })
}

#[test]
fn knobs_fit_their_types() {
    knobbed(json!([label(), about_money()]), None).unwrap();
    let error = |knob: serde_json::Value| match knobbed(json!([knob]), None) {
        Err(ProgramError::KnobValue { reason, .. }) => reason,
        other => panic!("{other:?}"),
    };
    assert_eq!(
        error(json!({ "type": "number", "name": "days", "label": "Days", "value": 0, "min": 1 })),
        "its value is outside its min and max"
    );
    assert_eq!(
        error(
            json!({ "type": "number", "name": "days", "label": "Days", "value": 5, "min": 9, "max": 1 })
        ),
        "its min is above its max"
    );
    assert_eq!(
        error(
            json!({ "type": "choice", "name": "priority", "label": "Priority", "value": "Urgent", "options": ["Low", "High"] })
        ),
        "its value must be one of its options"
    );
    assert_eq!(
        error(
            json!({ "type": "choice", "name": "priority", "label": "Priority", "value": "Low", "options": ["Low"] })
        ),
        "a choice offers 2 to 12 options"
    );
    assert_eq!(
        error(
            json!({ "type": "choice", "name": "priority", "label": "Priority", "value": "Low", "options": ["Low", "Low"] })
        ),
        "options must be distinct, with 1 to 60 characters each"
    );
    assert_eq!(
        error(
            json!({ "type": "question", "name": "aboutMoney", "label": "it's about money", "value": " " })
        ),
        "a question needs 1 to 300 characters"
    );
}

#[test]
fn knobs_are_named_once_labeled_and_read_by_the_code() {
    assert_eq!(
        knobbed(json!([label(), label()]), None),
        Err(ProgramError::DuplicateKnob("label".into()))
    );
    assert_eq!(
        knobbed(
            json!([{ "type": "text", "name": "label", "label": " ", "value": "vc" }]),
            None
        ),
        Err(ProgramError::KnobLabel("label".into()))
    );
    assert_eq!(
        knobbed(
            json!([{ "type": "boolean", "name": "notify", "label": "Notify me", "value": true }]),
            None
        ),
        Err(ProgramError::UnusedKnob("notify".into()))
    );
    let many: Vec<_> = (0..=limits::MAX_KNOBS)
        .map(|n| json!({ "type": "boolean", "name": format!("k{n}"), "label": "K", "value": true }))
        .collect();
    assert_eq!(knobbed(json!(many), None), Err(ProgramError::TooManyKnobs));
}

#[test]
fn a_sentence_shows_only_the_steps_knobs_each_in_its_own_form() {
    let knobs = json!([label(), about_money()]);
    knobbed(knobs.clone(), Some("Label it {label} when {?aboutMoney}.")).unwrap();
    assert_eq!(
        knobbed(
            knobs.clone(),
            Some("Label it {label} when {?aboutMarketing}.")
        ),
        Err(ProgramError::SentenceUnknownKnob("aboutMarketing".into()))
    );
    assert_eq!(
        knobbed(knobs.clone(), Some("Label it {label} when {aboutMoney}.")),
        Err(ProgramError::SentenceSlotKind("aboutMoney".into()))
    );
    assert_eq!(
        knobbed(knobs.clone(), Some("Label it {?label}.")),
        Err(ProgramError::SentenceSlotKind("label".into()))
    );
    assert_eq!(
        knobbed(knobs.clone(), Some("Label it {label")),
        Err(ProgramError::SentenceSyntax(SentenceSyntax))
    );
    let long = "x".repeat(limits::MAX_SENTENCE_CHARS + 1);
    assert_eq!(
        knobbed(knobs, Some(&long)),
        Err(ProgramError::SentenceTooLong)
    );
}
