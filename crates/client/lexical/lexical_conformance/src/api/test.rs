use crate::{api, replay::Replayer};
use lexical_model::*;
use serde_json::json;

#[test]
fn api_node_handles_remain_usable_after_the_shared_counter_resets()
-> Result<(), crate::replay::ReplayError> {
    let keys = SharedKeyCounter::new();
    keys.reset()?;
    let mut editor = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(keys))
        .build()
        .expect("editor");
    let mut replayer = Replayer {
        in_callback: true,
        ..Replayer::default()
    };
    let mut tx = editor.transaction();
    let text = api::lexical::call(
        &mut replayer,
        &mut tx,
        &json!({"fn":"lexical.$createTextNode","args":["hi"]}),
    )?;
    let content = api::lexical::call(
        &mut replayer,
        &mut tx,
        &json!({"fn":"LexicalNode.getTextContent","this":text,"args":[]}),
    )?;
    assert_eq!(content, "hi");
    let key = api::lexical::call(
        &mut replayer,
        &mut tx,
        &json!({"fn":"LexicalNode.getKey","this":text,"args":[]}),
    )?;
    let selected = api::lexical::call(
        &mut replayer,
        &mut tx,
        &json!({"fn":"lexical.$getNodeByKey","args":[key]}),
    )?;
    assert_eq!(selected, text);
    Ok(())
}
