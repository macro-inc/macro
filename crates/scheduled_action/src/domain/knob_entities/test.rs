use std::sync::Mutex;

use routine_program::RoutineProgram;
use serde_json::json;

use super::*;

/// Items by `kind:id`: the ones listed are usable, everything else isn't;
/// `broken` makes every lookup fail.
#[derive(Default)]
pub(crate) struct Items {
    pub usable: Vec<&'static str>,
    pub broken: bool,
    pub lookups: Mutex<Vec<String>>,
}

#[async_trait::async_trait]
impl KnobEntities for Items {
    async fn usable(
        &self,
        _owner: &MacroUserIdStr<'static>,
        item: &EntityValue,
    ) -> Result<bool, Report> {
        let key = format!(
            "{}:{}",
            serde_json::to_value(item.kind).unwrap().as_str().unwrap(),
            item.id.as_str()
        );
        self.lookups.lock().unwrap().push(key.clone());
        if self.broken {
            return Err(rootcause::report!("the access service is down"));
        }
        Ok(self.usable.contains(&key.as_str()))
    }
}

pub(crate) fn channel_knob(id: &str) -> serde_json::Value {
    json!({
        "type": "entity", "name": "bugs", "label": "Channel to post in",
        "entity_types": ["channel"], "value": { "type": "channel", "id": id },
    })
}

/// A channel, as a knob names it.
fn channel(id: &str) -> EntityValue {
    serde_json::from_value(json!({ "type": "channel", "id": id })).unwrap()
}

pub(crate) fn posting_step(title: &str, id: &str) -> serde_json::Value {
    json!({
        "type": "code", "title": title,
        "source": "export async function main({ knobs }: StepContext) { await knobs.bugs.send('Open bugs'); }",
        "knobs": [channel_knob(id)],
    })
}

#[tokio::test]
async fn an_item_is_unusable_when_its_owner_cant_reach_it_and_looked_up_once() {
    let program = RoutineProgram::from_task(&json!({ "steps": [
        posting_step("Post bugs", "kept"),
        posting_step("Post them again", "kept"),
        posting_step("Post elsewhere", "deleted"),
    ] }))
    .unwrap();
    let items = Items {
        usable: vec!["channel:kept"],
        ..Items::default()
    };
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    let unusable = unusable_items(&items, &owner, &program.code_steps())
        .await
        .unwrap();
    assert_eq!(
        unusable,
        [UnusableItem {
            position: 2,
            step: "Post elsewhere".into(),
            knob: "bugs".into(),
            label: "Channel to post in".into(),
            kind: Some(EntityKind::Channel),
            item: Some(channel("deleted")),
        }]
    );
    assert_eq!(
        *items.lookups.lock().unwrap(),
        ["channel:kept", "channel:deleted"]
    );
    assert_eq!(
        unusable[0].save_problem(),
        "\"Post elsewhere\": the channel picked for \"Channel to post in\" doesn't exist or you can't open it; pick another"
    );
}

#[tokio::test]
async fn a_failed_lookup_is_an_error_not_a_refusal() {
    let program =
        RoutineProgram::from_task(&json!({ "steps": [posting_step("Post bugs", "c1")] })).unwrap();
    let items = Items {
        broken: true,
        ..Items::default()
    };
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    assert!(
        unusable_items(&items, &owner, &program.code_steps())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn an_entity_knob_with_nothing_picked_is_never_usable() {
    let mut step = posting_step("Post bugs", "c1");
    step["knobs"][0]["value"] = serde_json::Value::Null;
    let program = RoutineProgram::from_task(&json!({ "steps": [step] })).unwrap();
    let items = Items::default();
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    let unusable = unusable_items(&items, &owner, &program.code_steps())
        .await
        .unwrap();
    assert_eq!(
        unusable[0].save_problem(),
        "\"Post bugs\": pick a channel for \"Channel to post in\""
    );
    assert_eq!(
        unusable[0].run_failure(),
        "No channel is picked for \"Channel to post in\". Pick one in the routine's settings."
    );
    assert!(items.lookups.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unpicked_knob_allowing_several_kinds_asks_for_an_item() {
    let knob = |name: &str, kinds: serde_json::Value| {
        json!({
            "type": "entity", "name": name, "label": format!("{name} to read"),
            "entity_types": kinds, "value": null,
        })
    };
    let program = RoutineProgram::from_task(&json!({ "steps": [{
        "type": "code", "title": "Read it",
        "source": "export async function main({ knobs }: StepContext) { return [knobs.thread, knobs.anything]; }",
        "knobs": [
            knob("thread", json!(["email_thread"])),
            knob("anything", json!(["email_thread", "task", "crm_company"])),
        ],
    }] }))
    .unwrap();
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    let unusable = unusable_items(&Items::default(), &owner, &program.code_steps())
        .await
        .unwrap();
    assert_eq!(
        unusable
            .iter()
            .map(|item| (item.knob.as_str(), item.kind, item.save_problem()))
            .collect::<Vec<_>>(),
        [
            (
                "thread",
                Some(EntityKind::EmailThread),
                "\"Read it\": pick an email thread for \"thread to read\"".to_owned()
            ),
            (
                "anything",
                None,
                "\"Read it\": pick an item for \"anything to read\"".to_owned()
            ),
        ]
    );
    assert_eq!(
        unusable[1].run_failure(),
        "No item is picked for \"anything to read\". Pick one in the routine's settings."
    );
}

#[tokio::test]
async fn every_kind_is_looked_up_and_named_in_its_failure() {
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    for kind in EntityKind::ALL {
        let name = serde_json::to_value(kind).unwrap();
        let program = RoutineProgram::from_task(&json!({ "steps": [{
            "type": "code", "title": "Use it",
            "source": "export async function main({ knobs }: StepContext) { return knobs.item; }",
            "knobs": [{
                "type": "entity", "name": "item", "label": "Item",
                "entity_types": [name], "value": { "type": name, "id": "gone" },
            }],
        }] }))
        .unwrap();
        let items = Items::default();
        let unusable = unusable_items(&items, &owner, &program.code_steps())
            .await
            .unwrap();
        assert_eq!(
            *items.lookups.lock().unwrap(),
            [format!("{}:gone", name.as_str().unwrap())]
        );
        assert_eq!(
            unusable[0].run_failure(),
            format!(
                "The {} picked for \"Item\" was deleted or you no longer have access to it. Pick another in the routine's settings.",
                kind.noun()
            )
        );
    }
}

#[tokio::test]
async fn a_saved_routine_lists_its_knobs_needing_a_new_pick_by_step_id() {
    let with_id = |id: &str, mut step: serde_json::Value| {
        step["id"] = json!(id);
        step
    };
    let program = RoutineProgram::from_task(&json!({ "steps": [
        with_id("post_bugs", posting_step("Post bugs", "kept")),
        { "type": "agent", "instructions": "Summarize the week.", "model": "anthropic/claude-sonnet-4-5" },
        with_id("post_elsewhere", posting_step("Post elsewhere", "deleted")),
        posting_step("Saved before steps had ids", "deleted"),
    ] }))
    .unwrap();
    let items = Items {
        usable: vec!["channel:kept"],
        ..Items::default()
    };
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    assert_eq!(
        unusable_knobs(&items, &owner, &program).await.unwrap(),
        [
            UnusableKnob {
                step: Some(StepId::try_from("post_elsewhere".to_owned()).unwrap()),
                knob: "bugs".into(),
                item: Some(channel("deleted")),
                reason: "The channel picked for \"Channel to post in\" was deleted or you no longer have access to it. Pick another in the routine's settings.".into(),
            },
            UnusableKnob {
                step: None,
                knob: "bugs".into(),
                item: Some(channel("deleted")),
                reason: "The channel picked for \"Channel to post in\" was deleted or you no longer have access to it. Pick another in the routine's settings.".into(),
            },
        ]
    );
}
