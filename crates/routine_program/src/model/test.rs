use serde_json::json;

use super::*;

#[test]
fn legacy_agent_tasks_become_one_agent_step() {
    let bot = Uuid::now_v7();
    let program = RoutineProgram::from_task(&json!({
        "agent": { "bot_id": bot },
        "model": null,
        "prompt": "",
        "user_prompt": "Summarize my inbox",
    }))
    .unwrap();
    assert_eq!(
        program.steps,
        vec![Step::Agent(AgentStep {
            model: None,
            agent: Some(AgentSelection { bot_id: bot }),
            instructions: "Summarize my inbox".into(),
        })]
    );
    assert!(program.leading_agent().is_some());
}

#[test]
fn a_legacy_task_keeps_its_required_apps_on_the_program() {
    let task = json!({
        "model": "claude",
        "mcp_servers": [{ "app_slug": "linear", "server_name": "Linear" }],
        "prompt": "",
        "user_prompt": "File the bugs",
    });
    let program = RoutineProgram::from_task(&task).unwrap();
    assert_eq!(
        serde_json::to_value(&program).unwrap(),
        json!({
            "steps": [{ "type": "agent", "model": "claude", "instructions": "File the bugs" }],
            "mcp_servers": [{ "app_slug": "linear", "server_name": "Linear" }],
        })
    );
    // A program states its apps beside its steps.
    let program = RoutineProgram::from_task(&serde_json::to_value(&program).unwrap()).unwrap();
    assert_eq!(program.mcp_servers[0].app_slug, "linear");
}

#[test]
fn a_legacy_system_prompt_is_kept_ahead_of_the_task() {
    let program = RoutineProgram::from_task(&json!({
        "model": "claude",
        "prompt": "Be brief.",
        "user_prompt": "Summarize",
    }))
    .unwrap();
    assert_eq!(
        program.agent_steps()[0].instructions,
        "Be brief.\n\nSummarize"
    );
}

#[test]
fn programs_round_trip_with_nested_branches() {
    let task = json!({
        "steps": [
            {
                "type": "choose",
                "question": "What kind of email is this?",
                "options": [
                    {
                        "label": "Invoice",
                        "steps": [{
                            "type": "tool",
                            "tool": "UpdateThreadLabels",
                            "arguments": { "thread_id": "{{trigger.entity_id}}", "label_id": "x", "add": true }
                        }]
                    },
                    { "label": "Newsletter", "description": "Marketing", "steps": [] }
                ],
                "otherwise": [{ "type": "agent", "model": "m", "instructions": "Triage it" }]
            },
            {
                "type": "if",
                "condition": "Is it urgent?",
                "then": [{ "type": "tool", "id": "task", "tool": "CreateDocument", "arguments": {} }],
                "else": []
            }
        ]
    });
    let program = RoutineProgram::from_task(&task).unwrap();
    let mut expected = task.clone();
    // Empty else branches are omitted when written back.
    expected["steps"][1].as_object_mut().unwrap().remove("else");
    assert_eq!(serde_json::to_value(&program).unwrap(), expected);
    assert_eq!(program.agent_steps().len(), 1);
    assert!(program.leading_agent().is_none());
}

#[test]
fn unknown_fields_tools_and_step_ids_are_rejected() {
    for task in [
        json!({ "steps": [], "extra": true }),
        json!({ "steps": [{ "type": "tool", "tool": "DeleteDocument", "arguments": {} }] }),
        json!({ "steps": [{ "type": "tool", "tool": "CreateDocument", "arguments": {}, "oops": 1 }] }),
        json!({ "steps": [{ "type": "tool", "id": "Task", "tool": "CreateDocument", "arguments": {} }] }),
        json!({ "steps": [{ "type": "if", "condition": " ", "then": [] }] }),
        json!({ "steps": [{ "type": "wait" }] }),
        json!({ "user_prompt": "missing prompt" }),
    ] {
        assert!(RoutineProgram::from_task(&task).is_err(), "{task}");
    }
}

#[test]
fn step_ids_are_lowercase_identifiers() {
    for valid in ["a", "task", "reply_2", "a234567890123456789012345678901"] {
        assert!(StepId::try_from(valid.to_owned()).is_ok(), "{valid}");
    }
    for invalid in [
        "",
        "2nd",
        "Task",
        "has-dash",
        "a2345678901234567890123456789012x",
    ] {
        assert!(StepId::try_from(invalid.to_owned()).is_err(), "{invalid}");
    }
}

#[test]
fn tool_names_match_their_serialized_form() {
    for tool in RoutineTool::ALL {
        assert_eq!(serde_json::to_value(tool).unwrap(), json!(tool.name()));
    }
}
