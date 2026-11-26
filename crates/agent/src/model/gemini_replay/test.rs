use super::*;
use crate::{GEMINI_4_CARBON, GEMINI_4_NEON};

#[test]
fn cold_replay_restores_exact_boundaries_and_excludes_plain_content_from_metadata() {
    let parts = json!([
        {"text": "One "},
        {"text": "item", "thoughtSignature": "dGV4dA=="},
        {"text": "", "thoughtSignature": "ZW1wdHk="},
        {"functionCall": {"id":"call-a_", "name":"lookup", "args":{"name":"private-demo"}},
         "thoughtSignature":"Y2FsbA=="},
        {"functionCall": {"id":"call-b", "name":"lookup", "args":{"name":"other"}}}
    ]);
    let (response, _) = capture_parts(parts.as_array().unwrap()).unwrap();
    let saved = serde_json::to_string(&Gemini4Replay {
        model: GEMINI_4_NEON.into(),
        responses: vec![response],
    })
    .unwrap();
    assert!(!saved.contains("private-demo"));
    assert!(!saved.contains("One "));
    let saved: Gemini4Replay = serde_json::from_str(&saved).unwrap();
    assert!(Gemini4ReplaySession::new(GEMINI_4_CARBON, vec![saved.clone()]).is_none());
    let resumed = Gemini4ReplaySession::new(GEMINI_4_NEON, vec![saved]).unwrap();

    let first = call_alias("call-a_");
    let second = call_alias("call-b");
    let mut body = json!({"contents":[
        {"role":"user","parts":[{"text":"find items"}]},
        {"role":"model","parts":[
            {"text":"One item"},
            {"functionCall":{"name":"lookup","id":first,"args":{"name":"private-demo"}}},
            {"functionCall":{"id":second,"name":"lookup","args":{"name":"other"}}}
        ]},
        {"role":"user","parts":[
            {"functionResponse":{"id":first,"name":"lookup","response":{"result":"a"}}},
            {"functionResponse":{"id":second,"name":"lookup","response":{"result":"b"}}}
        ]},
        {"role":"user","parts":[{"text":"continue"}]}
    ]});
    let mut mismatched = body.clone();
    mismatched["contents"][1]["parts"][0]["text"] = json!("Two items");
    assert!(resumed.apply(&mut mismatched).is_none());
    resumed.apply(&mut body).unwrap();
    assert_eq!(body["contents"][1]["parts"], parts);
    let results = &body["contents"][2]["parts"];
    assert_eq!(results[0]["functionResponse"]["id"], "call-a_");
    assert_eq!(results[1]["functionResponse"]["id"], "call-b");
}

#[test]
fn incomplete_parallel_call_sets_cannot_attest_a_tool() {
    let replay = Gemini4ReplaySession::new(GEMINI_4_NEON, vec![]).unwrap();
    let invalid = json!({"candidates":[{
        "finishReason":"STOP",
        "content":{"role":"model","parts":[
            {"functionCall":{"id":"call-a","name":"lookup","args":{}},"thoughtSignature":"YQ=="},
            {"functionCall":{"id":"call-b","name":"lookup","args":{}},"thoughtSignature":"Yg=="}
        ]}
    }]});
    Capture::new(replay.clone()).event(&invalid, 100);
    assert!(!replay.attests_tool_call(&call_alias("call-a"), "lookup", "{}"));
    assert!(replay.complete().is_none());
}
