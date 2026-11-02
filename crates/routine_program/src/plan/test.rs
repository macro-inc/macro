use serde_json::json;

use super::*;

#[test]
fn records_serialize_flat_with_their_kind() {
    let record = StepRecord {
        path: StepPath::root(1),
        result: StepResult::Agent {
            error: Some("boom".into()),
        },
    };
    let value = serde_json::to_value(&record).unwrap();
    assert_eq!(
        value,
        json!({ "path": "1", "kind": "agent", "error": "boom" })
    );
    assert_eq!(serde_json::from_value::<StepRecord>(value).unwrap(), record);

    // A step's output is recorded beside it, and records from before outputs
    // still read.
    let code = StepRecord {
        path: StepPath::root(0),
        result: StepResult::Code {
            calls: Vec::new(),
            calls_truncated: false,
            waited_ms: None,
            output: Some(json!({ "count": 2 })),
            error: None,
        },
    };
    let value = serde_json::to_value(&code).unwrap();
    assert_eq!(value["output"], json!({ "count": 2 }));
    assert_eq!(serde_json::from_value::<StepRecord>(value).unwrap(), code);
}
