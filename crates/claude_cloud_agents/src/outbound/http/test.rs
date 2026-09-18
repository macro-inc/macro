use super::*;

#[test]
fn model_and_prompt_are_serialized_in_one_ordered_batch() {
    let batch = event_batch(vec![
        json!({"type":"control_request","request":{"subtype":"set_model","model":"sonnet"}}),
        json!({"type":"user","message":{"content":"hello"}}),
    ]);
    assert_eq!(batch["events"].as_array().unwrap().len(), 2);
    assert_eq!(batch["events"][0]["payload"]["request"]["model"], "sonnet");
    assert_eq!(batch["events"][1]["payload"]["type"], "user");
}
