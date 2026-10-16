use super::*;
use std::sync::{Arc, Mutex};

fn shaped(body: Value) -> Result<Option<Value>, PromptLayoutError> {
    shape_body(&serde_json::to_vec(&body).unwrap())
        .map(|shaped| shaped.map(|bytes| serde_json::from_slice(&bytes).unwrap()))
}

#[test]
fn a_body_without_a_layout_is_left_alone() {
    let body = json!({
        "model": "claude-opus-4-8",
        "system": [{"type": "text", "text": "You are Macro.", "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": [{"type": "text", "text": "hi"}]}],
    });
    assert_eq!(shaped(body), Ok(None));
    assert_eq!(shape_body(b"not json"), Ok(None));
}

#[test]
fn shared_system_block_gets_its_own_breakpoint() {
    let body = json!({
        "system": [
            {"type": "text", "text": "You are Macro."},
            {"type": "text", "text": "<session_instructions>Task A</session_instructions>", "cache_control": {"type": "ephemeral"}},
        ],
        "messages": [{"role": "user", "content": [{"type": "text", "text": "hi"}]}],
        "cache_control": {"type": "ephemeral"},
        "macro_prompt_layout": {"cache_shared_system": true, "tool_references": []},
    });
    assert_eq!(
        shaped(body),
        Ok(Some(json!({
            "system": [
                {"type": "text", "text": "You are Macro.", "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": "<session_instructions>Task A</session_instructions>", "cache_control": {"type": "ephemeral"}},
            ],
            "messages": [{"role": "user", "content": [{"type": "text", "text": "hi"}]}],
            "cache_control": {"type": "ephemeral"},
        })))
    );
}

#[test]
fn shared_system_needs_exactly_two_blocks_the_first_unmarked() {
    let layout = json!({"cache_shared_system": true, "tool_references": []});
    for system in [
        json!([{"type": "text", "text": "You are Macro."}]),
        json!([
            {"type": "text", "text": "You are Macro.", "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": "Task A"},
        ]),
        json!([
            {"type": "text", "text": "You are Macro."},
            {"type": "text", "text": "Task A"},
            {"type": "text", "text": "Memory"},
        ]),
    ] {
        let body = json!({"system": system, "messages": [], "macro_prompt_layout": layout});
        assert_eq!(shaped(body), Err(PromptLayoutError::SharedSystem));
    }
}

#[test]
fn a_loading_result_references_its_tools_and_keeps_its_text_after_the_results() {
    let body = json!({
        "tools": [
            {"name": "LoadTools", "description": "Load tools.", "input_schema": {"type": "object"}, "cache_control": {"type": "ephemeral"}},
            {"name": "EditPresentation", "description": "Edit a deck.", "input_schema": {"type": "object"}, "defer_loading": true},
            {"name": "ReadPresentation", "description": "Read a deck.", "input_schema": {"type": "object"}, "defer_loading": true},
        ],
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": "edit my deck"}]},
            {"role": "assistant", "content": [
                {"type": "tool_use", "id": "toolu_load", "name": "LoadTools", "input": {"names": ["EditPresentation", "ReadPresentation"]}},
                {"type": "tool_use", "id": "toolu_other", "name": "Search", "input": {}},
            ]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "toolu_load", "content": [{"type": "text", "text": "{\"loaded\":2}"}]},
                {"type": "tool_result", "tool_use_id": "toolu_other", "content": "found nothing"},
            ]},
        ],
        "macro_prompt_layout": {
            "cache_shared_system": false,
            "tool_references": [{"tool_use_id": "toolu_load", "tool_names": ["EditPresentation", "ReadPresentation"]}],
        },
    });
    let shaped = shaped(body).unwrap().unwrap();
    assert_eq!(
        shaped["messages"][2],
        json!({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_load", "content": [
                {"type": "tool_reference", "tool_name": "EditPresentation"},
                {"type": "tool_reference", "tool_name": "ReadPresentation"},
            ]},
            {"type": "tool_result", "tool_use_id": "toolu_other", "content": "found nothing"},
            {"type": "text", "text": "<tool_result_text tool_use_id=\"toolu_load\">{\"loaded\":2}</tool_result_text>"},
        ]})
    );
    assert_eq!(shaped.get("macro_prompt_layout"), None);
}

#[test]
fn moved_texts_follow_the_order_their_results_were_referenced_in() {
    let body = json!({
        "tools": [
            {"name": "A", "input_schema": {"type": "object"}, "defer_loading": true},
            {"name": "B", "input_schema": {"type": "object"}, "defer_loading": true},
        ],
        "messages": [{"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_1", "content": "one"},
            {"type": "tool_result", "tool_use_id": "toolu_2", "content": "two"},
        ]}],
        "macro_prompt_layout": {
            "cache_shared_system": false,
            "tool_references": [
                {"tool_use_id": "toolu_1", "tool_names": ["A"]},
                {"tool_use_id": "toolu_2", "tool_names": ["B"]},
            ],
        },
    });
    assert_eq!(
        shaped(body).unwrap().unwrap()["messages"][0]["content"],
        json!([
            {"type": "tool_result", "tool_use_id": "toolu_1", "content": [{"type": "tool_reference", "tool_name": "A"}]},
            {"type": "tool_result", "tool_use_id": "toolu_2", "content": [{"type": "tool_reference", "tool_name": "B"}]},
            {"type": "text", "text": "<tool_result_text tool_use_id=\"toolu_1\">one</tool_result_text>"},
            {"type": "text", "text": "<tool_result_text tool_use_id=\"toolu_2\">two</tool_result_text>"},
        ])
    );
}

#[test]
fn a_reference_must_name_a_deferred_tool() {
    let body = json!({
        "tools": [{"name": "EditPresentation", "input_schema": {"type": "object"}}],
        "messages": [{"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_load", "content": "loaded"},
        ]}],
        "macro_prompt_layout": {
            "cache_shared_system": false,
            "tool_references": [{"tool_use_id": "toolu_load", "tool_names": ["EditPresentation"]}],
        },
    });
    assert_eq!(
        shaped(body),
        Err(PromptLayoutError::NotDeferred(
            "EditPresentation".to_owned()
        ))
    );
}

#[test]
fn a_reference_must_land_in_exactly_one_text_result() {
    let tools = json!([{"name": "EditPresentation", "input_schema": {"type": "object"}, "defer_loading": true}]);
    let layout = json!({
        "cache_shared_system": false,
        "tool_references": [{"tool_use_id": "toolu_load", "tool_names": ["EditPresentation"]}],
    });
    let missing = json!({"tools": tools, "messages": [], "macro_prompt_layout": layout});
    assert_eq!(
        shaped(missing),
        Err(PromptLayoutError::ToolResult("toolu_load".to_owned(), 0))
    );
    let image = json!({
        "tools": tools,
        "messages": [{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_load", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AA=="}},
        ]}]}],
        "macro_prompt_layout": layout,
    });
    assert_eq!(
        shaped(image),
        Err(PromptLayoutError::ToolResultContent(
            "toolu_load".to_owned()
        ))
    );
}

#[test]
fn a_layout_cannot_exceed_four_breakpoints() {
    let body = json!({
        "tools": [
            {"name": "A", "input_schema": {"type": "object"}, "cache_control": {"type": "ephemeral"}},
            {"name": "B", "input_schema": {"type": "object", "properties": {"cache_control": {"type": "string"}}}, "cache_control": {"type": "ephemeral"}},
        ],
        "system": [
            {"type": "text", "text": "You are Macro."},
            {"type": "text", "text": "Task A", "cache_control": {"type": "ephemeral"}},
        ],
        "messages": [],
        "cache_control": {"type": "ephemeral"},
        "macro_prompt_layout": {"cache_shared_system": true, "tool_references": []},
    });
    assert_eq!(shaped(body), Err(PromptLayoutError::Breakpoints(5)));
}

#[test]
fn a_malformed_layout_fails() {
    let body = json!({"messages": [], "macro_prompt_layout": {"cache_shared_system": "yes"}});
    assert!(matches!(shaped(body), Err(PromptLayoutError::Malformed(_))));
}

/// Records what reaches the transport under the layout adapter.
#[derive(Clone, Debug, Default)]
struct Recording(Arc<Mutex<Vec<(Option<String>, Bytes)>>>);

impl HttpClientExt for Recording {
    fn send<T, U>(
        &self,
        request: Request<T>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + Send,
        U: From<Bytes> + Send + 'static,
    {
        let length = request
            .headers()
            .get("content-length")
            .map(|length| length.to_str().unwrap().to_owned());
        self.0
            .lock()
            .unwrap()
            .push((length, request.into_body().into()));
        std::future::ready(Err(http_client::Error::StreamEnded))
    }

    fn send_multipart<U>(
        &self,
        _: Request<MultipartForm>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        U: From<Bytes> + Send + 'static,
    {
        std::future::ready(Err(http_client::Error::StreamEnded))
    }

    async fn send_streaming<T>(&self, request: Request<T>) -> http_client::Result<StreamingResponse>
    where
        T: Into<Bytes> + Send,
    {
        let _ = self.send::<T, Bytes>(request).await;
        Err(http_client::Error::StreamEnded)
    }
}

#[tokio::test]
async fn the_adapter_forwards_plain_bodies_byte_for_byte_and_fails_bad_layouts() {
    let recording = Recording::default();
    let layout = AnthropicPromptLayout::new(recording.clone());
    // Key order and spacing a re-serialization would not keep.
    let plain = Bytes::from_static(br#"{"model":"claude-opus-4-8",  "messages":[]}"#);
    let request = Request::builder()
        .header("content-length", plain.len())
        .body(plain.clone())
        .unwrap();
    let _ = layout.send_streaming(request).await;
    assert_eq!(
        recording.0.lock().unwrap()[0],
        (Some(plain.len().to_string()), plain)
    );

    let shaped = Bytes::from(
        json!({
            "system": [{"type": "text", "text": "Shared"}, {"type": "text", "text": "Rest"}],
            "messages": [],
            "macro_prompt_layout": {"cache_shared_system": true, "tool_references": []},
        })
        .to_string(),
    );
    let request = Request::builder()
        .header("content-length", shaped.len())
        .body(shaped)
        .unwrap();
    let _ = layout.send_streaming(request).await;
    let (length, body) = recording.0.lock().unwrap()[1].clone();
    assert_eq!(length, None, "the transport recomputes the changed length");
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!({
            "system": [
                {"type": "text", "text": "Shared", "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": "Rest"},
            ],
            "messages": [],
        })
    );

    let bad = Bytes::from(
        json!({"messages": [], "macro_prompt_layout": {"cache_shared_system": true, "tool_references": []}})
            .to_string(),
    );
    let Err(error) = layout
        .send_streaming(Request::builder().body(bad).unwrap())
        .await
    else {
        panic!("a layout that cannot be applied must fail the request");
    };
    assert_eq!(
        error.to_string(),
        http_client::Error::Instance(PromptLayoutError::SharedSystem.into()).to_string()
    );
    assert_eq!(
        recording.0.lock().unwrap().len(),
        2,
        "a bad layout is never sent"
    );
}
