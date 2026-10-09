//! The two Anthropic prompt-cache shapes rig 0.41 cannot express, applied to
//! the serialized request just before it leaves for the API.
//!
//! - A cache breakpoint on the *first* of two system blocks, so the part of the
//!   system prompt every session of an agent shares is cached apart from the
//!   per-session rest. Rig only marks the last system block.
//! - `tool_reference` blocks in a tool result, which load a deferred tool's
//!   schema without touching `tools` (the front of the cache prefix). Rig's
//!   tool results carry only text and images.
//!
//! The request planner ([`super::anthropic::LaidOutModel`]) declares what to
//! do in a [`PromptLayout`] under [`PROMPT_LAYOUT_KEY`]. This adapter applies
//! it and strips it. A body without the key is sent byte for byte. A body
//! whose shape does not match its layout fails the request: a layout that
//! cannot be applied is a bug, not a request to send as it is.

use bytes::Bytes;
use rig_core::http_client::{
    self, HttpClientExt, LazyBody, MultipartForm, Request, Response, StreamingResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

#[cfg(test)]
mod test;

/// Where the request planner puts its [`PromptLayout`] in the request body.
pub(crate) const PROMPT_LAYOUT_KEY: &str = "macro_prompt_layout";

/// Anthropic's limit on `cache_control` markers per request, the top-level
/// automatic one included.
const MAX_CACHE_BREAKPOINTS: usize = 4;

/// What to change in one request body.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct PromptLayout {
    /// Mark the first of exactly two system blocks as a cache breakpoint.
    pub(crate) cache_shared_system: bool,
    /// Tool results that load deferred tools, in conversation order.
    pub(crate) tool_references: Vec<ToolReferences>,
}

/// The deferred tools one tool result loads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ToolReferences {
    /// The `tool_use_id` of the result that loads them.
    pub(crate) tool_use_id: String,
    /// Names of tools declared with `defer_loading`.
    pub(crate) tool_names: Vec<String>,
}

/// Why a declared layout could not be applied.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub(crate) enum PromptLayoutError {
    #[error("prompt layout is malformed: {0}")]
    Malformed(String),
    #[error("expected exactly two system blocks, the first without a breakpoint")]
    SharedSystem,
    #[error("tool `{0}` is referenced but not declared with defer_loading")]
    NotDeferred(String),
    #[error("expected exactly one tool result `{0}`, found {1}")]
    ToolResult(String, usize),
    #[error("tool result `{0}` holds something other than text")]
    ToolResultContent(String),
    #[error("{0} cache breakpoints exceed Anthropic's limit of {MAX_CACHE_BREAKPOINTS}")]
    Breakpoints(usize),
}

/// Applies the [`PromptLayout`] a body declares, then forwards it to `inner`.
#[derive(Debug, Clone, Default)]
pub struct AnthropicPromptLayout<H> {
    inner: H,
}

impl<H> AnthropicPromptLayout<H> {
    /// Shape requests on their way to `inner`.
    pub fn new(inner: H) -> Self {
        Self { inner }
    }
}

impl<H: HttpClientExt + Clone + 'static> HttpClientExt for AnthropicPromptLayout<H> {
    fn send<T, U>(
        &self,
        request: Request<T>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + Send,
        U: From<Bytes> + Send + 'static,
    {
        let shaped = shape_request(request.map(Into::into));
        let inner = self.inner.clone();
        async move { inner.send(shaped?).await }
    }

    fn send_multipart<U>(
        &self,
        request: Request<MultipartForm>,
    ) -> impl Future<Output = http_client::Result<Response<LazyBody<U>>>> + Send + 'static
    where
        U: From<Bytes> + Send + 'static,
    {
        self.inner.send_multipart(request)
    }

    async fn send_streaming<T>(&self, request: Request<T>) -> http_client::Result<StreamingResponse>
    where
        T: Into<Bytes> + Send,
    {
        self.inner
            .send_streaming(shape_request(request.map(Into::into))?)
            .await
    }
}

fn shape_request(request: Request<Bytes>) -> http_client::Result<Request<Bytes>> {
    let (mut parts, body) = request.into_parts();
    let Some(shaped) =
        shape_body(&body).map_err(|error| http_client::Error::Instance(error.into()))?
    else {
        return Ok(Request::from_parts(parts, body));
    };
    // The body changed length; let the transport compute it.
    parts.headers.remove("content-length");
    Ok(Request::from_parts(parts, shaped))
}

/// The body with its layout applied, or `None` when it declares none.
fn shape_body(body: &[u8]) -> Result<Option<Bytes>, PromptLayoutError> {
    let Ok(Value::Object(mut body)) = serde_json::from_slice::<Value>(body) else {
        return Ok(None);
    };
    let Some(layout) = body.remove(PROMPT_LAYOUT_KEY) else {
        return Ok(None);
    };
    let layout: PromptLayout = serde_json::from_value(layout)
        .map_err(|error| PromptLayoutError::Malformed(error.to_string()))?;
    apply(&mut body, &layout)?;
    let body = serde_json::to_vec(&body)
        .map_err(|error| PromptLayoutError::Malformed(error.to_string()))?;
    Ok(Some(Bytes::from(body)))
}

fn apply(body: &mut Map<String, Value>, layout: &PromptLayout) -> Result<(), PromptLayoutError> {
    if layout.cache_shared_system {
        cache_shared_system(body)?;
    }
    for references in &layout.tool_references {
        for name in &references.tool_names {
            if !is_deferred(body, name) {
                return Err(PromptLayoutError::NotDeferred(name.clone()));
            }
        }
        reference_tools(body, references)?;
    }
    let breakpoints = count_breakpoints(body);
    if breakpoints > MAX_CACHE_BREAKPOINTS {
        return Err(PromptLayoutError::Breakpoints(breakpoints));
    }
    Ok(())
}

fn cache_shared_system(body: &mut Map<String, Value>) -> Result<(), PromptLayoutError> {
    let Some(Value::Array(system)) = body.get_mut("system") else {
        return Err(PromptLayoutError::SharedSystem);
    };
    let [Value::Object(shared), Value::Object(_)] = system.as_mut_slice() else {
        return Err(PromptLayoutError::SharedSystem);
    };
    if shared.get("type") != Some(&json!("text")) || shared.contains_key("cache_control") {
        return Err(PromptLayoutError::SharedSystem);
    }
    shared.insert("cache_control".to_owned(), json!({"type": "ephemeral"}));
    Ok(())
}

fn is_deferred(body: &Map<String, Value>, name: &str) -> bool {
    body.get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| {
            tools.iter().any(|tool| {
                tool.get("name") == Some(&json!(name))
                    && tool.get("defer_loading") == Some(&json!(true))
            })
        })
}

/// Replace the result's content with `tool_reference` blocks, which cannot
/// share a result with anything else, and keep what the tool said in a text
/// block after the message's tool results.
fn reference_tools(
    body: &mut Map<String, Value>,
    references: &ToolReferences,
) -> Result<(), PromptLayoutError> {
    let id = &references.tool_use_id;
    let mut found = Vec::new();
    if let Some(Value::Array(messages)) = body.get("messages") {
        for (message_index, message) in messages.iter().enumerate() {
            let Some(Value::Array(content)) = message.get("content") else {
                continue;
            };
            for (block_index, block) in content.iter().enumerate() {
                if block.get("type") == Some(&json!("tool_result"))
                    && block.get("tool_use_id") == Some(&json!(id))
                {
                    found.push((message_index, block_index));
                }
            }
        }
    }
    let [(message_index, block_index)] = found[..] else {
        return Err(PromptLayoutError::ToolResult(id.clone(), found.len()));
    };
    let content = body["messages"][message_index]["content"]
        .as_array_mut()
        .expect("located above");
    let said = result_text(&content[block_index])
        .ok_or_else(|| PromptLayoutError::ToolResultContent(id.clone()))?;
    content[block_index]["content"] = Value::Array(
        references
            .tool_names
            .iter()
            .map(|name| json!({"type": "tool_reference", "tool_name": name}))
            .collect(),
    );
    let after_results = content
        .iter()
        .rposition(|block| block.get("type") == Some(&json!("tool_result")))
        .expect("the referenced result is one")
        + 1;
    // After earlier results' moved text, so the order follows the results.
    let position = content[after_results..]
        .iter()
        .take_while(|block| is_moved_result_text(block))
        .count()
        + after_results;
    content.insert(
        position,
        json!({
            "type": "text",
            "text": format!("<tool_result_text tool_use_id=\"{id}\">{said}</tool_result_text>"),
        }),
    );
    Ok(())
}

/// The text a tool result holds, as a string or text blocks.
fn result_text(result: &Value) -> Option<String> {
    match result.get("content")? {
        Value::String(text) => Some(text.clone()),
        Value::Array(blocks) => blocks
            .iter()
            .map(|block| {
                (block.get("type") == Some(&json!("text")))
                    .then(|| block.get("text")?.as_str().map(str::to_owned))
                    .flatten()
            })
            .collect::<Option<Vec<_>>>()
            .map(|texts| texts.concat()),
        _ => None,
    }
}

fn is_moved_result_text(block: &Value) -> bool {
    block
        .get("text")
        .and_then(Value::as_str)
        .is_some_and(|text| text.starts_with("<tool_result_text tool_use_id="))
}

/// Markers where Anthropic reads them: top level, tools, system blocks and
/// message content blocks.
fn count_breakpoints(body: &Map<String, Value>) -> usize {
    let marked = |value: &Value| {
        value
            .get("cache_control")
            .is_some_and(|marker| !marker.is_null())
    };
    let blocks = |key: &str| {
        body.get(key).and_then(Value::as_array).map_or(0, |blocks| {
            blocks.iter().filter(|block| marked(block)).count()
        })
    };
    let message_blocks = body
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|message| message.get("content")?.as_array())
        .flatten()
        .filter(|block| marked(block))
        .count();
    usize::from(marked(&Value::Object(body.clone())))
        + blocks("tools")
        + blocks("system")
        + message_blocks
}
