use jev::domain::Probability;
use serde_json::json;

use super::*;

fn program(value: serde_json::Value) -> RoutineProgram {
    RoutineProgram::from_task(&value).unwrap()
}

fn answers(values: &[f32]) -> Vec<Probability> {
    values
        .iter()
        .map(|v| Probability::new(*v).unwrap())
        .collect()
}

fn triage() -> RoutineProgram {
    program(json!({ "steps": [
        { "type": "tool", "id": "first", "tool": "UpdateThreadLabels", "arguments": {} },
        {
            "type": "choose",
            "question": "What kind of email is this?",
            "options": [
                { "label": "Invoice", "description": "bills", "steps": [
                    { "type": "if", "condition": "Is it overdue?", "then": [
                        { "type": "tool", "tool": "SendChannelMessage", "arguments": {} }
                    ] }
                ] },
                { "label": "Newsletter", "steps": [
                    { "type": "tool", "tool": "SetSenderPolicy", "arguments": {} }
                ] }
            ],
            "otherwise": [{ "type": "agent", "model": "m", "instructions": "Triage" }]
        },
        { "type": "if", "condition": "Is it from a customer?", "then": [], "else": [
            { "type": "tool", "tool": "Comment", "arguments": {} }
        ] }
    ] }))
}

fn kinds(plan: &[PlannedStep<'_>]) -> Vec<String> {
    plan.iter()
        .map(|step| match step {
            PlannedStep::Decided(record) => format!("{}:{:?}", record.path, record.result),
            PlannedStep::Tool { path, step } => format!("{path}:{}", step.tool),
            PlannedStep::Agent { path, .. } => format!("{path}:agent"),
        })
        .collect()
}

#[test]
fn a_choice_asks_all_its_options_before_any_nested_decision() {
    let questions: Vec<String> = triage()
        .questions()
        .unwrap()
        .into_iter()
        .map(String::from)
        .collect();
    assert_eq!(
        questions,
        [
            "What kind of email is this? Is the answer \"Invoice\" (bills)?",
            "What kind of email is this? Is the answer \"Newsletter\"?",
            "Is it overdue?",
            "Is it from a customer?",
        ]
    );
}

#[test]
fn the_best_fitting_option_runs_and_nested_answers_are_consumed_in_order() {
    let program = triage();
    let plan = program.resolve(&answers(&[0.9, 0.3, 0.8, 0.1])).unwrap();
    assert_eq!(
        kinds(&plan),
        [
            "0:UpdateThreadLabels",
            "1:Choose { choices: [\"Invoice\"], probability: Some(0.9) }",
            "1.options.0.0:If { answer: true, probability: 0.8 }",
            "1.options.0.0.then.0:SendChannelMessage",
            "2:If { answer: false, probability: 0.1 }",
            "2.else.0:Comment",
        ]
    );
}

#[test]
fn untaken_branches_still_consume_their_answers() {
    let program = triage();
    // Newsletter wins; the invoice branch's "overdue" answer must not be read
    // as the customer question.
    let plan = program.resolve(&answers(&[0.2, 0.7, 0.99, 0.6])).unwrap();
    assert_eq!(
        kinds(&plan),
        [
            "0:UpdateThreadLabels",
            "1:Choose { choices: [\"Newsletter\"], probability: Some(0.7) }",
            "1.options.1.0:SetSenderPolicy",
            "2:If { answer: true, probability: 0.6 }",
        ]
    );
}

#[test]
fn no_fitting_option_runs_the_fallback_and_ties_pick_the_first() {
    let program = triage();
    let plan = program.resolve(&answers(&[0.4, 0.4, 0.0, 0.5])).unwrap();
    assert_eq!(
        kinds(&plan)[1..3],
        [
            "1:Choose { choices: [], probability: Some(0.4) }".to_owned(),
            "1.otherwise.0:agent".to_owned(),
        ]
    );
    let plan = program.resolve(&answers(&[0.6, 0.6, 0.0, 0.5])).unwrap();
    assert!(kinds(&plan)[1].contains("[\"Invoice\"]"));
}

fn labels() -> RoutineProgram {
    let label = |name: &str| {
        json!({ "label": name, "steps": [
            { "type": "tool", "tool": "UpdateThreadLabels", "arguments": { "label": name } }
        ] })
    };
    program(json!({ "steps": [{
        "type": "choose",
        "question": "Which labels fit this email?",
        "multiple": true,
        "options": [label("Finance"), label("Customers"), label("Hiring")],
        "otherwise": [{ "type": "tool", "tool": "UpdateThreadLabels", "arguments": { "label": "Other" } }]
    }] }))
}

#[test]
fn a_multiple_choice_asks_whether_each_option_applies() {
    let questions: Vec<String> = labels()
        .questions()
        .unwrap()
        .into_iter()
        .map(String::from)
        .collect();
    assert_eq!(
        questions[0],
        "Which labels fit this email? Does \"Finance\" apply?"
    );
}

#[test]
fn a_multiple_choice_runs_every_fitting_option_in_order() {
    let program = labels();
    let plan = program.resolve(&answers(&[0.8, 0.2, 0.6])).unwrap();
    assert_eq!(
        kinds(&plan),
        [
            "0:Choose { choices: [\"Finance\", \"Hiring\"], probability: Some(0.8) }",
            "0.options.0.0:UpdateThreadLabels",
            "0.options.2.0:UpdateThreadLabels",
        ]
    );
    let plan = program.resolve(&answers(&[0.1, 0.2, 0.3])).unwrap();
    assert_eq!(
        kinds(&plan),
        [
            "0:Choose { choices: [], probability: Some(0.3) }",
            "0.otherwise.0:UpdateThreadLabels",
        ]
    );
}

#[test]
fn answers_must_match_the_questions() {
    assert!(triage().resolve(&answers(&[0.5])).is_err());
    assert!(triage().resolve(&answers(&[0.5; 5])).is_err());
    let plain =
        program(json!({ "steps": [{ "type": "agent", "model": "m", "instructions": "x" }] }));
    assert!(plain.questions().unwrap().is_empty());
    assert_eq!(kinds(&plain.resolve(&[]).unwrap()), ["0:agent"]);
}

#[test]
fn records_serialize_flat_with_their_kind() {
    let record = StepRecord {
        path: StepPath::root(1).child("then", 0),
        result: StepResult::Tool {
            tool: crate::RoutineTool::CreateDocument,
            error: Some("boom".into()),
        },
    };
    let value = serde_json::to_value(&record).unwrap();
    assert_eq!(
        value,
        json!({ "path": "1.then.0", "kind": "tool", "tool": "CreateDocument", "error": "boom" })
    );
    assert_eq!(serde_json::from_value::<StepRecord>(value).unwrap(), record);
}
