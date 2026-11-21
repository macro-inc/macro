//! The event types `events/list` offers, and parsing a subscription's
//! `name` and `arguments` into what it selects.

use super::EventsError;
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::LazyLock;
use webhook::domain::mcp::catalog::event_description;
use webhook::domain::mcp::filter::{MAX_VALUE_LEN, MAX_VALUES, McpEventFilter};
use webhook::domain::models::WEBHOOK_EVENT_NAMES;

/// The type that takes a request in words.
pub(crate) const QUERY_EVENT: &str = "macro.events";
/// Longest request in words, in characters.
pub(crate) const MAX_QUERY_CHARS: usize = 500;
/// The delivery modes every type offers.
const DELIVERY: [&str; 2] = ["push", "webhook"];

/// What a subscription selects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Selection {
    /// `macro.events`: a request in words, and the filter its caller
    /// confirmed for it. Without one, the words are compiled and shown back
    /// for confirmation; nothing is delivered until a filter is sent.
    Query {
        query: String,
        filter: Option<McpEventFilter>,
    },
    /// One webhook event name, optionally only for these parent ids.
    Event {
        name: &'static str,
        ids: Option<Vec<String>>,
    },
}

impl Selection {
    /// The arguments as the subscription is keyed: the parsed values written
    /// back, so arguments that mean the same thing (an empty `allOf` given or
    /// left out, a query with surrounding spaces) name the same subscription.
    pub(crate) fn arguments(&self) -> Value {
        match self {
            Self::Query { query, filter } => match filter {
                Some(filter) => query_arguments(query, filter),
                None => json!({"query": query}),
            },
            Self::Event { ids: Some(ids), .. } => json!({"ids": ids}),
            Self::Event { ids: None, .. } => json!({}),
        }
    }
}

/// The `macro.events` arguments that confirm `filter` for `query`.
pub(crate) fn query_arguments(query: &str, filter: &McpEventFilter) -> Value {
    json!({"query": query, "filter": filter})
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QueryArguments {
    query: String,
    /// Absent when only the words are sent; `null` is not a filter.
    #[serde(default, deserialize_with = "present")]
    filter: Option<McpEventFilter>,
}

/// A field that, when present, must hold a value.
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EventArguments {
    #[serde(default)]
    ids: Option<Vec<String>>,
}

/// Parse `name` and `arguments` against the catalog: an unknown name is
/// `NotFound`, arguments outside the type's `inputSchema` `InvalidParams`.
pub(crate) fn selection(name: &str, arguments: &Value) -> Result<Selection, EventsError> {
    if name == QUERY_EVENT {
        let QueryArguments { query, filter } = serde_json::from_value(arguments.clone())
            .map_err(|error| EventsError::InvalidParams(format!("arguments: {error}")))?;
        let query = query.trim();
        // PostgreSQL cannot store a NUL character in the stored arguments.
        if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS || query.contains('\0') {
            return Err(EventsError::InvalidParams(format!(
                "arguments.query must be 1 to {MAX_QUERY_CHARS} characters, with no NUL character"
            )));
        }
        return Ok(Selection::Query {
            query: query.to_owned(),
            filter,
        });
    }
    let Some(name) = WEBHOOK_EVENT_NAMES
        .iter()
        .copied()
        .find(|known| *known == name)
    else {
        return Err(EventsError::UnknownEvent);
    };
    let EventArguments { ids } = serde_json::from_value(arguments.clone())
        .map_err(|error| EventsError::InvalidParams(format!("arguments: {error}")))?;
    if let Some(ids) = &ids
        && (ids.is_empty()
            || ids.len() > MAX_VALUES
            || ids
                .iter()
                .any(|id| id.is_empty() || id.len() > MAX_VALUE_LEN || id.contains('\0')))
    {
        return Err(EventsError::InvalidParams(format!(
            "arguments.ids holds 1 to {MAX_VALUES} ids of 1 to {MAX_VALUE_LEN} bytes, with no NUL character"
        )));
    }
    Ok(Selection::Event { name, ids })
}

/// The `events/list` entries, built once.
pub(crate) static EVENT_TYPES: LazyLock<Vec<Value>> = LazyLock::new(|| {
    let mut types = vec![json!({
        "name": QUERY_EVENT,
        "title": "Macro events you describe",
        "description": "Macro events chosen by a request in plain words, such as \"all @ mentions \
            of me in channels\" or \"new messages in channel 0193…\". Two steps: first send \
            only the query. Nothing is subscribed then: the answer is an InvalidParams error \
            whose data holds the exact filter the words compile to (over event names, parent \
            ids and a few message fields) as \"com.macro/filter\", a reading of it in words as \
            \"com.macro/interpretation\", and the arguments to confirm it with. If the reading \
            says what you meant, repeat the request with those arguments; delivery then \
            evaluates exactly that filter. Otherwise rephrase. A request the filter cannot \
            express exactly is refused, never approximated. You receive only events you can \
            see, as Macro webhooks deliver them; data.event_type names each event.",
        "delivery": DELIVERY,
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": MAX_QUERY_CHARS,
                    "description": "Which events you want, in plain words. Mentions mean \
                        mentions of you unless you name someone else."
                },
                "filter": FILTER_SCHEMA.0,
            },
            "required": ["query"],
            "additionalProperties": false,
            "$defs": FILTER_SCHEMA.1,
        },
        "payloadSchema": payload_schema(),
    })];
    types.extend(WEBHOOK_EVENT_NAMES.iter().map(|name| {
        json!({
            "name": name,
            "description": event_description(name).unwrap_or_default(),
            "delivery": DELIVERY,
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ids": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 1, "maxLength": MAX_VALUE_LEN},
                        "minItems": 1,
                        "maxItems": MAX_VALUES,
                        "description": "Only events for these ids (see the description); \
                            absent means every one you can see."
                    }
                },
                "additionalProperties": false
            },
            "payloadSchema": payload_schema(),
        })
    }));
    types
});

/// The filter's JSON schema for `macro.events`'s `filter` argument, and the
/// definitions it refers to, which go at the root of the input schema where
/// its `#/$defs/…` references resolve.
static FILTER_SCHEMA: LazyLock<(Value, Value)> = LazyLock::new(|| {
    let mut schema = schemars::schema_for!(McpEventFilter).to_value();
    let definitions = schema
        .as_object_mut()
        .and_then(|schema| {
            schema.remove("$schema");
            schema.remove("title");
            schema.remove("$defs")
        })
        .unwrap_or_else(|| json!({}));
    if let Some(schema) = schema.as_object_mut() {
        schema.insert(
            "description".to_owned(),
            "The filter you confirm for the query, exactly as the first step returned it. \
             Leave it out to see what the query compiles to."
                .into(),
        );
    }
    (schema, definitions)
});

/// The broker envelope Macro webhooks deliver.
fn payload_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "event_id": {"type": "string", "description": "The event's id (a UUIDv7)."},
            "schema_version": {"type": "integer"},
            "event_type": {"type": "string", "description": "The Macro event name, such as message.mentioned."},
            "metadata": {"type": "object", "description": "The event's fields, as Macro webhooks deliver them."}
        },
        "required": ["event_id", "event_type", "metadata"]
    })
}
