//! The event types `events/list` offers, and parsing a subscription's
//! `name` and `arguments` into what it selects.

use super::EventsError;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::sync::LazyLock;
use strum::IntoEnumIterator as _;
use webhook::domain::mcp::catalog::event_description;
use webhook::domain::mcp::filter::{
    MAX_VALUE_LEN, MAX_VALUES, McpEventFilter, McpFieldCondition, McpFilterClause, McpFilterField,
    McpFilterValue,
};
use webhook::domain::mcp::models::SUBSCRIBER_PLACEHOLDER;
use webhook::domain::models::WEBHOOK_EVENT_NAMES;

/// The type that takes a request in words.
pub(crate) const QUERY_EVENT: &str = "macro.events";
/// Longest request in words, in characters.
pub(crate) const MAX_QUERY_CHARS: usize = 500;
/// The delivery modes every type offers.
const DELIVERY: [&str; 2] = ["push", "webhook"];
/// The one delivery mode ChatGPT takes.
const CHATGPT_DELIVERY: [&str; 1] = ["webhook"];
/// The argument selecting parent ids.
const IDS_ARGUMENT: &str = "ids";

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
    /// One webhook event name, optionally only for these parent ids and
    /// only where these payload fields hold these values.
    Event {
        name: &'static str,
        ids: Option<Vec<String>>,
        conditions: Vec<McpFieldCondition>,
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
            Self::Event {
                ids, conditions, ..
            } => {
                let mut arguments = Map::new();
                if let Some(ids) = ids {
                    arguments.insert(IDS_ARGUMENT.to_owned(), json!(ids));
                }
                for condition in conditions {
                    if let [value] = condition.one_of.as_slice() {
                        arguments.insert(condition.field.to_string(), argument_value(value));
                    }
                }
                Value::Object(arguments)
            }
        }
    }
}

/// The filter a named type's selection delivers by: the event, its parent
/// ids and its conditions, in one clause.
pub(crate) fn event_filter(
    name: &str,
    ids: Option<&[String]>,
    conditions: &[McpFieldCondition],
) -> McpEventFilter {
    McpEventFilter {
        any_of: vec![McpFilterClause {
            events: vec![name.to_owned()],
            ids: ids.map(<[String]>::to_vec),
            all_of: conditions.to_vec(),
        }],
    }
}

/// An argument's value as written back: `me` or the literal text.
fn argument_value(value: &McpFilterValue) -> Value {
    match value {
        McpFilterValue::Me => SUBSCRIBER_PLACEHOLDER.into(),
        McpFilterValue::Literal { value } => value.as_str().into(),
    }
}

/// The payload fields a named type's subscription can also narrow by, each
/// an argument named after it: every filter field that applies to the event
/// but the parent id, which `ids` selects already.
fn argument_fields(event: &str) -> impl Iterator<Item = McpFilterField> + '_ {
    McpFilterField::iter()
        .filter(move |field| *field != McpFilterField::ParentId && field.applies_to(event))
}

/// What an argument for `field` means, for its input schema.
fn argument_description(field: McpFilterField) -> &'static str {
    match field {
        McpFilterField::ParentType => {
            "Only messages in this kind of place: channel, document, initiative, crm_company, \
             crm_contact or call."
        }
        McpFilterField::ParentId => "Only messages in this channel, document or other entity.",
        McpFilterField::Actor => {
            "Only messages posted, edited, deleted or attached by this person: \"me\" for you, \
             or the person's id as Macro's tools give it."
        }
        McpFilterField::MentionedType => {
            "Only mentions of this kind of thing: user, bot, document, channel, …"
        }
        McpFilterField::MentionedId => {
            "Only mentions of this: \"me\" for you, or the id of the person or item as \
             Macro's tools give it."
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
    let Some(arguments) = arguments.as_object() else {
        return Err(EventsError::InvalidParams(
            "arguments must be an object".to_owned(),
        ));
    };
    if let Some(key) = arguments.keys().find(|key| {
        *key != IDS_ARGUMENT && !argument_fields(name).any(|field| field.to_string() == **key)
    }) {
        return Err(EventsError::InvalidParams(format!(
            "arguments.{key} is not an argument of {name}"
        )));
    }
    // `null` is no ids, as before.
    let ids = arguments
        .get(IDS_ARGUMENT)
        .filter(|ids| !ids.is_null())
        .map(|ids| serde_json::from_value::<Vec<String>>(ids.clone()))
        .transpose()
        .map_err(|error| EventsError::InvalidParams(format!("arguments.ids: {error}")))?;
    // In the fields' own order, whatever order the arguments came in.
    let mut conditions = Vec::new();
    for field in argument_fields(name) {
        let key = field.to_string();
        let Some(value) = arguments.get(&key) else {
            continue;
        };
        let value = value
            .as_str()
            .filter(|value| {
                !value.is_empty() && value.len() <= MAX_VALUE_LEN && !value.contains('\0')
            })
            .ok_or_else(|| {
                EventsError::InvalidParams(format!(
                    "arguments.{key} must be text of 1 to {MAX_VALUE_LEN} bytes, with no NUL \
                     character"
                ))
            })?;
        let value = if value == SUBSCRIBER_PLACEHOLDER {
            McpFilterValue::Me
        } else {
            McpFilterValue::Literal {
                value: value.to_owned(),
            }
        };
        conditions.push(McpFieldCondition {
            field,
            one_of: vec![value],
        });
    }
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
    Ok(Selection::Event {
        name,
        ids,
        conditions,
    })
}

/// The `events/list` entries, built once.
pub(crate) static EVENT_TYPES: LazyLock<Vec<Value>> = LazyLock::new(|| {
    let mut types = vec![query_event_type()];
    types.extend(
        WEBHOOK_EVENT_NAMES
            .iter()
            .map(|name| named_event_type(name, &DELIVERY, payload_schema())),
    );
    types
});

/// The `events/list` entries ChatGPT is offered: every named type, webhook
/// delivery only. `macro.events` is left out: its first step answers with an
/// error to read, which ChatGPT takes as a failed subscribe; ChatGPT maps
/// the user's words to a type and its arguments itself.
pub(crate) static CHATGPT_EVENT_TYPES: LazyLock<Vec<Value>> = LazyLock::new(|| {
    WEBHOOK_EVENT_NAMES
        .iter()
        .map(|name| named_event_type(name, &CHATGPT_DELIVERY, chatgpt_payload_schema()))
        .collect()
});

/// The entry of one webhook event name.
fn named_event_type(name: &str, delivery: &[&str], payload_schema: Value) -> Value {
    let mut properties = Map::new();
    properties.insert(
        IDS_ARGUMENT.to_owned(),
        json!({
            "type": "array",
            "items": {"type": "string", "minLength": 1, "maxLength": MAX_VALUE_LEN},
            "minItems": 1,
            "maxItems": MAX_VALUES,
            "description": "Only events for these ids (see the description); \
                absent means every one you can see."
        }),
    );
    for field in argument_fields(name) {
        properties.insert(
            field.to_string(),
            json!({
                "type": "string",
                "minLength": 1,
                "maxLength": MAX_VALUE_LEN,
                "description": argument_description(field),
            }),
        );
    }
    json!({
        "name": name,
        "description": event_description(name).unwrap_or_default(),
        "delivery": delivery,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "additionalProperties": false
        },
        "payloadSchema": payload_schema,
    })
}

/// The `macro.events` entry.
fn query_event_type() -> Value {
    json!({
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
    })
}

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

/// The envelope as ChatGPT receives it: no person named by id or email.
fn chatgpt_payload_schema() -> Value {
    let mut schema = payload_schema();
    if let Some(metadata) = schema.pointer_mut("/properties/metadata") {
        metadata["description"] = "The event's fields, as Macro webhooks deliver them, except \
            that people are never named: you appear as \"me\" and anyone else as \"someone\". \
            Read the item with Macro's tools for who else took part."
            .into();
    }
    schema
}
