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
fn programs_round_trip() {
    let task = json!({
        "steps": [
            { "type": "code", "id": "read", "title": "Read", "source": "export async function main() {}" },
            { "type": "agent", "model": "m", "instructions": "Triage it" }
        ]
    });
    let program = RoutineProgram::from_task(&task).unwrap();
    assert_eq!(serde_json::to_value(&program).unwrap(), task);
    assert_eq!(program.agent_steps().len(), 1);
    assert_eq!(program.code_steps().len(), 1);
    assert!(program.leading_agent().is_none());
}

#[test]
fn unknown_fields_steps_and_step_ids_are_rejected() {
    for task in [
        json!({ "steps": [], "extra": true }),
        json!({ "steps": [{ "type": "code", "title": "x", "source": "y", "oops": 1 }] }),
        json!({ "steps": [{ "type": "code", "id": "Task", "title": "x", "source": "y" }] }),
        json!({ "steps": [{ "type": "tool", "tool": "CreateDocument", "arguments": {} }] }),
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
fn code_steps_and_the_sdk_fingerprint_round_trip() {
    let task = json!({
        "steps": [{
            "type": "code",
            "id": "invoice",
            "title": "Label invoices",
            "summary": "Asks whether the email is an invoice and labels it.",
            "source": "export async function main() {}",
        }],
        "sdk": "0.2.2+18cc1c19c35c",
    });
    let program = RoutineProgram::from_task(&task).unwrap();
    assert_eq!(program.code_steps().len(), 1);
    assert_eq!(
        program.sdk.as_ref().map(SdkFingerprint::as_str),
        Some("0.2.2+18cc1c19c35c")
    );
    assert_eq!(serde_json::to_value(&program).unwrap(), task);
    assert!(RoutineProgram::from_task(&json!({ "steps": [], "sdk": " " })).is_err());
}

#[test]
fn code_steps_act_as_the_agent_unless_the_task_says_to_operate_as_the_owner() {
    let steps = json!([
        { "type": "code", "id": "post", "title": "Post", "source": "export async function main() {}" }
    ]);
    let program = RoutineProgram::from_task(&json!({ "steps": steps })).unwrap();
    assert_eq!(program.code_identity(), CodeIdentity::Agent);
    assert_eq!(
        serde_json::to_value(&program).unwrap(),
        json!({ "steps": steps })
    );

    let task = json!({ "steps": steps, "dangerously_operate_as_user": true });
    let program = RoutineProgram::from_task(&task).unwrap();
    assert_eq!(program.code_identity(), CodeIdentity::Owner);
    assert_eq!(serde_json::to_value(&program).unwrap(), task);
}
