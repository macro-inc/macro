//! Finishing a user tool inside the turn: the user reviews the call the model
//! made, then the host executes or rejects it.
//!
//! A user tool (`ai_toolset::UserTool`, registered with `add_user_tool`)
//! answers `"PendingUserExecution"` and does nothing. The host finishes it
//! with the pieces `ai_toolset` exposes for exactly that: `is_valid_tool` to
//! check edited arguments and `try_user_tool_call` to run the wrapped tool.
//! Chat does so after the turn, over HTTP, from its composer. A host that can
//! reach its user *during* the turn - Macro's in-process agent, whose ACP
//! client renders elicitations - does it here, through the
//! [`UserToolReviewer`] port, before the model reads the result.
//!
//! The port speaks in the restricted form vocabulary elicitation shares
//! across ACP and MCP (flat primitives with defaults), stated in this crate's
//! own types so neither protocol leaks in. A [`ReviewForm`] is projected from
//! the tool's input schema and the call's arguments, so every user tool is
//! reviewable without per-tool code; the whole edited draft can come back in
//! one `Json` field for a client that has a composer of its own.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use agent::{FinishedUserTool, PendingUserTool, UserToolFinisher};
use ai_toolset::tool_object::UserToolResponse;
use ai_toolset::{AsyncToolCollection, RequestContext};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Map, Value};
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

/// The name of the form field that carries the whole edited draft as JSON.
/// A client with its own composer for the tool fills this in; a client that
/// renders the form generically leaves it out and edits the flat fields.
pub const DRAFT_FIELD: &str = "draft";

/// A user tool's call, put to the user for review.
#[derive(Debug, Clone, PartialEq)]
pub struct ReviewRequest {
    /// The tool's name as the toolset knows it.
    pub tool_name: String,
    /// The call's id as the transcript shows it.
    pub tool_call_id: String,
    /// What the user is asked, in one line: "Create calendar event?".
    pub message: String,
    /// The arguments the model called the tool with, whole.
    pub draft: Value,
    /// The flat form a client renders to edit the draft.
    pub form: ReviewForm,
}

/// A flat form: the restricted schema elicitation allows, in neutral terms.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ReviewForm {
    /// The tool's human title, for the form's heading.
    pub title: Option<String>,
    /// The fields, in the schema's order.
    pub fields: Vec<ReviewField>,
    /// Names of the fields an answer must fill.
    pub required: Vec<String>,
}

/// One form field.
#[derive(Debug, Clone, PartialEq)]
pub struct ReviewField {
    /// The key the answer is sent back under; the argument it edits.
    pub name: String,
    /// The argument's description from the tool's schema, when it has one.
    pub description: Option<String>,
    /// The field's type and pre-filled value.
    pub kind: ReviewFieldKind,
}

/// A field's type, with the value the draft holds as its default.
#[derive(Debug, Clone, PartialEq)]
pub enum ReviewFieldKind {
    /// Free text; `format` is the schema's (`date-time`, `email`, ...) when given.
    Text {
        /// The draft's value.
        default: Option<String>,
        /// The schema's format hint.
        format: Option<String>,
    },
    /// A yes/no.
    Boolean {
        /// The draft's value.
        default: Option<bool>,
    },
    /// A number.
    Number {
        /// The draft's value.
        default: Option<f64>,
    },
    /// A whole number.
    Integer {
        /// The draft's value.
        default: Option<i64>,
    },
    /// One of a fixed set of strings.
    Choice {
        /// The allowed values.
        options: Vec<String>,
        /// The draft's value.
        default: Option<String>,
    },
    /// The whole edited draft as a JSON string - see [`DRAFT_FIELD`].
    Json,
}

/// What the user decided.
#[derive(Debug, Clone, PartialEq)]
pub enum ReviewOutcome {
    /// The user confirmed, with the form's values as submitted. Absent
    /// fields keep the draft's values.
    Accepted(BTreeMap<String, Value>),
    /// The user said no.
    Declined,
    /// The question was dismissed, or the turn stopped.
    Cancelled,
}

/// Why a review could not happen.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReviewError {
    /// The user cannot be asked right now: the client has no way to show the
    /// form, or is already holding another question.
    #[error("the user cannot be asked to review this call right now: {0}")]
    Unavailable(String),
    /// Asking failed on the way.
    #[error("asking the user to review this call failed: {0}")]
    Failed(String),
}

/// A host's way of putting a call to its user and waiting for the answer.
#[async_trait]
pub trait UserToolReviewer: Send + Sync {
    /// Ask the user to review `request` and wait for their decision.
    async fn review(&self, request: ReviewRequest) -> Result<ReviewOutcome, ReviewError>;
}

/// A [`UserToolFinisher`] for `tools`: puts each pending user tool to
/// `reviewer`, and on acceptance runs the tool with the reviewed arguments
/// as `user`, against `context`.
///
/// The tool's answer is a `UserToolResponse` as JSON, the same shape chat
/// writes when its composer finishes the call: the user's action with the
/// tool's result, or `"Rejected"`. A tool this toolset does not know as a
/// user tool is left alone (`None`) for the host to finish some other way.
pub fn user_tool_finisher<Context>(
    tools: Arc<AsyncToolCollection<Context>>,
    context: Context,
    user: MacroUserIdStr<'static>,
    reviewer: Arc<dyn UserToolReviewer>,
    cancel: CancellationToken,
) -> UserToolFinisher
where
    Context: Clone + Send + Sync + 'static,
{
    Arc::new(move |call: PendingUserTool| {
        let tools = Arc::clone(&tools);
        let context = context.clone();
        let user = user.clone();
        let reviewer = Arc::clone(&reviewer);
        let cancel = cancel.clone();
        Box::pin(async move { finish(&tools, context, user, &*reviewer, cancel, call).await })
            as Pin<Box<dyn Future<Output = Option<FinishedUserTool>> + Send>>
    })
}

async fn finish<Context>(
    tools: &AsyncToolCollection<Context>,
    context: Context,
    user: MacroUserIdStr<'static>,
    reviewer: &dyn UserToolReviewer,
    cancel: CancellationToken,
    call: PendingUserTool,
) -> Option<FinishedUserTool>
where
    Context: Clone + Send + Sync + 'static,
{
    let tool = tools.user_tools.get(&call.tool_name)?;
    let request = ReviewRequest {
        tool_name: call.tool_name.clone(),
        tool_call_id: call.tool_call_id.clone(),
        message: format!("{}?", tool.annotations.title),
        draft: call.args.clone(),
        form: project_form(
            Some(tool.annotations.title.to_owned()),
            &tool.input_schema,
            &call.args,
        ),
    };

    let outcome = match reviewer.review(request).await {
        Ok(outcome) => outcome,
        Err(error) => return Some(FinishedUserTool::Error(error.to_string())),
    };
    let content = match outcome {
        ReviewOutcome::Accepted(content) => content,
        ReviewOutcome::Declined => {
            return Some(FinishedUserTool::Result(rejected()));
        }
        ReviewOutcome::Cancelled => {
            return Some(FinishedUserTool::Error(
                "the user cancelled the review; the call was not made".to_owned(),
            ));
        }
    };

    let args = apply_review(&call.args, &content);
    if !tools.is_valid_tool(&call.tool_name, &args) {
        return Some(FinishedUserTool::Error(format!(
            "the reviewed arguments are not valid for {}; nothing was done",
            call.tool_name
        )));
    }
    let mut request_context = RequestContext::new(user);
    request_context.cancel = cancel;
    match tools
        .try_user_tool_call(context, request_context, &call.tool_name, &args)
        .await
    {
        Ok(Ok(response)) => Some(match serde_json::to_value(response) {
            Ok(json) => FinishedUserTool::Result(json),
            Err(error) => {
                FinishedUserTool::Error(format!("the result could not be encoded: {error}"))
            }
        }),
        Ok(Err(error)) => Some(FinishedUserTool::Error(error.description)),
        Err(error) => Some(FinishedUserTool::Error(error.to_string())),
    }
}

/// `UserToolResponse::Rejected` as the JSON chat writes for it.
fn rejected() -> Value {
    serde_json::to_value(UserToolResponse::<Value>::Rejected).unwrap_or(Value::Null)
}

/// The arguments to run with: the draft, overwritten by what the user
/// submitted. A whole draft under [`DRAFT_FIELD`] (a JSON string, or the
/// object itself) replaces everything; otherwise each flat field replaces
/// the argument of the same name.
pub fn apply_review(draft: &Value, content: &BTreeMap<String, Value>) -> Value {
    if let Some(whole) = content.get(DRAFT_FIELD) {
        let parsed = match whole {
            Value::String(text) => serde_json::from_str::<Value>(text).ok(),
            Value::Object(_) => Some(whole.clone()),
            _ => None,
        };
        if let Some(object @ Value::Object(_)) = parsed {
            return object;
        }
    }
    let mut args = match draft {
        Value::Object(map) => map.clone(),
        _ => Map::new(),
    };
    for (name, value) in content {
        if name != DRAFT_FIELD {
            args.insert(name.clone(), value.clone());
        }
    }
    Value::Object(args)
}

/// The flat form for a tool: one field per top-level primitive argument in
/// `schema`, pre-filled from `args`, plus the [`DRAFT_FIELD`]. Arguments the
/// restricted form cannot show - objects, arrays, unions - are left to the
/// draft field.
pub fn project_form(
    title: Option<String>,
    schema: &Map<String, Value>,
    args: &Value,
) -> ReviewForm {
    let properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let schema_required: Vec<&str> = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|names| names.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();

    let mut fields = Vec::new();
    let mut required = Vec::new();
    for (name, property) in &properties {
        let Some(kind) = field_kind(property, args.get(name)) else {
            continue;
        };
        if schema_required.contains(&name.as_str()) {
            required.push(name.clone());
        }
        fields.push(ReviewField {
            name: name.clone(),
            description: property
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_owned),
            kind,
        });
    }
    fields.push(ReviewField {
        name: DRAFT_FIELD.to_owned(),
        description: Some(
            "The complete edited arguments as JSON, for a client with its own editor. \
             When present it replaces every other field."
                .to_owned(),
        ),
        kind: ReviewFieldKind::Json,
    });
    ReviewForm {
        title,
        fields,
        required,
    }
}

/// The field a property renders as, or `None` when the restricted form has
/// no shape for it.
fn field_kind(property: &Value, current: Option<&Value>) -> Option<ReviewFieldKind> {
    // `Option<T>` fields come out as `{"type": ["string", "null"]}` or
    // `anyOf: [T, null]`; read through to the one non-null type.
    let property = non_null(property);
    if let Some(options) = choice_options(property) {
        return Some(ReviewFieldKind::Choice {
            options,
            default: current.and_then(Value::as_str).map(str::to_owned),
        });
    }
    match json_type(property)? {
        "string" => Some(ReviewFieldKind::Text {
            default: current.and_then(Value::as_str).map(str::to_owned),
            format: property
                .get("format")
                .and_then(Value::as_str)
                .map(str::to_owned),
        }),
        "boolean" => Some(ReviewFieldKind::Boolean {
            default: current.and_then(Value::as_bool),
        }),
        "integer" => Some(ReviewFieldKind::Integer {
            default: current.and_then(Value::as_i64),
        }),
        "number" => Some(ReviewFieldKind::Number {
            default: current.and_then(Value::as_f64),
        }),
        _ => None,
    }
}

/// The string values a property allows, when it is a choice among fixed
/// strings: a plain `enum`, or - how a documented Rust enum comes out - an
/// `anyOf`/`oneOf` whose every real variant is one `const` string (or a
/// one-value `enum`).
fn choice_options(property: &Value) -> Option<Vec<String>> {
    if let Some(options) = property.get("enum").and_then(Value::as_array) {
        let options: Vec<String> = options
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        return (!options.is_empty()).then_some(options);
    }
    let variants = ["anyOf", "oneOf"]
        .into_iter()
        .find_map(|key| property.get(key).and_then(Value::as_array))?;
    let mut options = Vec::new();
    for variant in variants {
        if json_type(variant) == Some("null") {
            continue;
        }
        let value = variant.get("const").and_then(Value::as_str).or_else(|| {
            match variant.get("enum").and_then(Value::as_array)?.as_slice() {
                [only] => only.as_str(),
                _ => None,
            }
        })?;
        options.push(value.to_owned());
    }
    (!options.is_empty()).then_some(options)
}

/// The property with a nullable wrapper removed: `anyOf`/`oneOf` of one real
/// schema and `null` reads as that schema.
fn non_null(property: &Value) -> &Value {
    for key in ["anyOf", "oneOf"] {
        if let Some(variants) = property.get(key).and_then(Value::as_array) {
            let real: Vec<&Value> = variants
                .iter()
                .filter(|variant| json_type(variant) != Some("null"))
                .collect();
            if let [only] = real[..] {
                return only;
            }
        }
    }
    property
}

/// The one JSON type a property declares, reading `["string", "null"]` as
/// `string`. `None` for a property with several real types or none.
fn json_type(property: &Value) -> Option<&str> {
    match property.get("type")? {
        Value::String(name) => Some(name.as_str()),
        Value::Array(names) => {
            let real: Vec<&str> = names
                .iter()
                .filter_map(Value::as_str)
                .filter(|name| *name != "null")
                .collect();
            match real[..] {
                [only] => Some(only),
                _ => None,
            }
        }
        _ => None,
    }
}
