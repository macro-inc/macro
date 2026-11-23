use super::*;

#[test]
fn a_kind_this_build_does_not_know_decodes_as_unknown() {
    let origin: TriggerOrigin =
        serde_json::from_value(serde_json::json!({"origin": "from_the_future", "field": 1}))
            .unwrap();

    assert_eq!(origin, TriggerOrigin::Unknown);
}

#[test]
fn an_agent_task_assignment_reads_back_with_its_lineage() {
    let encoded = serde_json::json!({
        "origin": "task_assigned",
        "task": "task-1",
        "by": {
            "type": "agent",
            "bot": "01a0fd65-0ef7-763f-86ba-f065d75eaa66",
            "on_behalf_of": "macro|user@example.com",
            "lineage": {
                "type": "session",
                "session": "01a1a9da-8e60-7e60-9678-68ce6e69e117",
                "root": {"type": "routine", "routine": "01a1a90c-c2cb-7f25-8b21-0de250451c91"},
            },
        },
    });

    let origin: TriggerOrigin = serde_json::from_value(encoded).unwrap();

    let TriggerOrigin::TaskAssigned {
        by: Caller::Agent(actor),
        ..
    } = origin
    else {
        panic!("expected an agent's assignment");
    };
    let Lineage::Session { root, .. } = actor.lineage else {
        panic!("expected a known session");
    };
    assert_eq!(
        root,
        Root::Routine {
            routine: "01a1a90c-c2cb-7f25-8b21-0de250451c91".parse().unwrap()
        }
    );
}
