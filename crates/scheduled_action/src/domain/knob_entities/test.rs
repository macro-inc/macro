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
            step: "Post elsewhere".into(),
            label: "Channel to post in".into(),
            kind: EntityKind::Channel,
            picked: true,
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
