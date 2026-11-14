//! Joins what a scenario recorded with the entry points: which rows of
//! `entrypoints.tsv` a scenario exercised, and with what request.

use std::collections::BTreeSet;

use serde_json::{Value, json};

use super::evidence::{Evidence, Http};
use super::graphql::Schema;
use crate::{Kind, Row, Sources};

/// The service whose routes are entry points.
const API: &str = "email_service";
/// The queue step that shows a worker carried a message out.
const HANDLED: &str = "handled";
/// The prefix the gateway puts before the API's routes; the router serves
/// them with and without it.
const GATEWAY_PREFIX: &str = "/email";
/// What the recorder writes for a path segment that is an id.
const ID_SEGMENT: &str = "{}";
/// The matcher that takes any message.
const ANY: &str = "*";

/// One time a scenario exercised an entry point, with what the request
/// showed.
#[derive(Clone, Debug, Default)]
pub(crate) struct Hit<'a> {
    /// The route's parameters and the segments given for them.
    pub(crate) params: Vec<(&'a str, &'a str)>,
    /// The shape of the body, the message or the GraphQL variables.
    pub(crate) body: Option<&'a Value>,
    /// The shape of the query string.
    pub(crate) query: &'a str,
    /// The text of a GraphQL query.
    pub(crate) text: &'a str,
}

/// A scenario's record, prepared for matching.
pub(crate) struct Scenario {
    pub(crate) evidence: Evidence,
    /// For each `evidence.http` request, the route that served it.
    routes: Vec<Option<String>>,
    /// For each `evidence.graphql` query, the fields it selected.
    fields: Vec<BTreeSet<String>>,
}

/// What reading the records needs besides the records.
pub(crate) struct Reader<'a> {
    pub(crate) rows: &'a [Row],
    pub(crate) sources: &'a Sources,
    pub(crate) schema: &'a Schema,
}

impl Scenario {
    pub(crate) fn new(evidence: Evidence, reader: &Reader<'_>) -> Self {
        let templates: Vec<&str> = reader
            .rows
            .iter()
            .filter(|row| row.kind == Kind::Http)
            .map(|row| row.key.as_str())
            .collect();
        let routes = evidence
            .http
            .iter()
            .map(|request| route_of(request, &templates))
            .collect();
        let fields = evidence
            .graphql
            .iter()
            .map(|asked| {
                if asked.answered {
                    reader.schema.coordinates(&asked.query).unwrap_or_default()
                } else {
                    BTreeSet::new()
                }
            })
            .collect();
        Self {
            evidence,
            routes,
            fields,
        }
    }

    /// The scenario as nextest names it.
    pub(crate) fn name(&self) -> String {
        self.evidence.scenario()
    }

    /// Whether the scenario linked an inbox of `provider`. A scenario that
    /// linked none is of neither provider and counts for both.
    pub(crate) fn is_of(&self, provider: &str) -> bool {
        self.evidence.providers.is_empty()
            || self.evidence.providers.iter().any(|own| own == provider)
    }

    /// The requests the API served that are no route in the list.
    pub(crate) fn unlisted_requests(&self) -> Vec<String> {
        self.evidence
            .http
            .iter()
            .zip(&self.routes)
            .filter(|(request, route)| {
                request.service == API && route.is_none() && served(request.status)
            })
            .map(|(request, _)| format!("http {} {}", request.method, request.path))
            .collect()
    }

    /// Every time the scenario exercised `row`.
    pub(crate) fn hits<'a>(&'a self, row: &'a Row, sources: &Sources) -> Vec<Hit<'a>> {
        let evidence = &self.evidence;
        match row.kind {
            Kind::Http => evidence
                .http
                .iter()
                .zip(&self.routes)
                .filter(|(request, route)| {
                    served(request.status) && route.as_deref() == Some(row.key.as_str())
                })
                .map(|(request, _)| Hit {
                    params: params(&row.key, &request.path),
                    body: Some(&request.body),
                    query: &request.query,
                    text: "",
                })
                .collect(),
            Kind::Webhook => evidence
                .http
                .iter()
                .filter(|request| {
                    request.service == API
                        && served(request.status)
                        && webhook_case(request, sources).as_deref() == Some(row.key.as_str())
                })
                .map(|request| Hit {
                    body: Some(&request.body),
                    query: &request.query,
                    ..Hit::default()
                })
                .collect(),
            Kind::Graphql => evidence
                .graphql
                .iter()
                .zip(&self.fields)
                .filter(|(_, fields)| fields.contains(&row.key))
                .map(|(asked, _)| Hit {
                    body: Some(&asked.variables),
                    text: &asked.query,
                    ..Hit::default()
                })
                .collect(),
            Kind::Queue => {
                let queue = row.key.split(':').next().unwrap_or_default();
                let names: Vec<&str> = sources
                    .queue
                    .iter()
                    .filter(|source| source.name == queue)
                    .flat_map(|source| {
                        std::iter::once(source.name.as_str())
                            .chain(source.aliases.iter().map(String::as_str))
                    })
                    .collect();
                evidence
                    .queue
                    .iter()
                    .filter(|message| {
                        message.step == HANDLED
                            && names.contains(&message.queue.as_str())
                            && matches(&row.matcher, &message.body)
                    })
                    .map(|message| Hit {
                        body: Some(&message.body),
                        ..Hit::default()
                    })
                    .collect()
            }
            Kind::Kafka => {
                let topic = row.key.split(':').next().unwrap_or_default();
                evidence
                    .kafka
                    .iter()
                    .filter(|event| {
                        event.topic == topic
                            && matches(&row.matcher, &json!({ "event_type": event.event }))
                    })
                    .map(|_| Hit::default())
                    .collect()
            }
            Kind::Gateway => {
                let name = row.key.split(':').next().unwrap_or_default();
                evidence
                    .services
                    .iter()
                    .filter_map(|request| request.body.as_ref())
                    .filter(|body| {
                        body["message_type"] == name && matches(&row.matcher, &body["message"])
                    })
                    .map(|body| Hit {
                        body: Some(&body["message"]),
                        ..Hit::default()
                    })
                    .collect()
            }
            Kind::Tool => evidence
                .tools
                .iter()
                .filter(|call| call.succeeded && call.tool == row.key)
                .map(|_| Hit::default())
                .collect(),
            Kind::Lambda => evidence
                .lambda
                .iter()
                .filter(|run| run.succeeded && run.function == row.key)
                .map(|_| Hit::default())
                .collect(),
            Kind::Provider => evidence
                .provider
                .iter()
                .filter(|call| {
                    call.status < 400
                        && call.route.as_ref().is_some_and(|route| {
                            format!("{}:{route}", call.provider) == row.key
                        })
                })
                .map(|_| Hit::default())
                .collect(),
            // A loop serves no request that could be recorded.
            Kind::Loop => Vec::new(),
            Kind::Elsewhere => {
                let (service, route) = row.key.split_once(' ').unwrap_or_default();
                let (method, template) = route.split_once(' ').unwrap_or_default();
                evidence
                    .http
                    .iter()
                    .filter(|request| {
                        request.service == service
                            && request.method == method
                            && served(request.status)
                            && fits(template, &request.path).is_some()
                    })
                    .map(|request| Hit {
                        params: params(route, &request.path),
                        body: Some(&request.body),
                        query: &request.query,
                        text: "",
                    })
                    .collect()
            }
        }
    }
}

/// Whether the service carried the request out: not a refusal, not a miss.
fn served(status: u16) -> bool {
    (200..400).contains(&status)
}

/// The route of the API that served `request`: of the templates that fit
/// its path, the one with the most fixed segments, as the router picks.
fn route_of(request: &Http, templates: &[&str]) -> Option<String> {
    if request.service != API {
        return None;
    }
    let prefixed = format!("{GATEWAY_PREFIX}{}", request.path);
    templates
        .iter()
        .filter_map(|template| {
            let (method, path) = template.split_once(' ')?;
            if method != request.method {
                return None;
            }
            let fixed = fits(path, &request.path).or_else(|| fits(path, &prefixed))?;
            Some((fixed, *template))
        })
        .max_by_key(|(fixed, _)| *fixed)
        .map(|(_, template)| template.to_owned())
}

/// How many fixed segments of `template` the `path` has, when it fits.
fn fits(template: &str, path: &str) -> Option<usize> {
    let wanted: Vec<&str> = template.split('/').collect();
    let given: Vec<&str> = path.split('/').collect();
    if wanted.len() != given.len() {
        return None;
    }
    let mut fixed = 0;
    for (wanted, given) in wanted.iter().zip(&given) {
        if is_param(wanted) {
            continue;
        }
        if wanted != given || *given == ID_SEGMENT {
            return None;
        }
        fixed += 1;
    }
    Some(fixed)
}

fn is_param(segment: &str) -> bool {
    segment.starts_with('{') && segment.ends_with('}')
}

/// The parameters of the route `key` with the segments `path` gives them.
fn params<'a>(key: &'a str, path: &'a str) -> Vec<(&'a str, &'a str)> {
    let template = key.split_once(' ').map_or(key, |(_, template)| template);
    let wanted: Vec<&str> = template.split('/').collect();
    let given: Vec<&str> = path.split('/').collect();
    // A path without the gateway's prefix is one segment shorter: the two
    // are lined up from their ends.
    let skip = wanted.len().saturating_sub(given.len());
    wanted
        .into_iter()
        .skip(skip)
        .zip(given)
        .filter(|(wanted, _)| is_param(wanted))
        .map(|(wanted, given)| (wanted.trim_matches(['{', '}']), given))
        .collect()
}

/// The webhook case a request to a provider webhook is, as its handler
/// tells them apart: `outlook:validation`, `outlook:lifecycle:missed`, ….
fn webhook_case(request: &Http, sources: &Sources) -> Option<String> {
    let webhook = sources
        .webhook
        .iter()
        .find(|webhook| request.path.starts_with(&format!("/{}/webhook", webhook.prefix)))?;
    let prefix = &webhook.prefix;
    if request
        .query
        .split('&')
        .filter_map(|pair| pair.split('=').next())
        .any(|key| same_field(key, &webhook.validation_field))
    {
        return Some(format!("{prefix}:validation"));
    }
    let first = request.body.pointer("/value/0")?.as_object()?;
    let lifecycle = first
        .iter()
        .find(|(key, _)| same_field(key, &webhook.lifecycle_field))
        .and_then(|(_, event)| event.as_str());
    Some(match lifecycle {
        Some(event) => format!("{prefix}:lifecycle:{event}"),
        None => format!("{prefix}:change"),
    })
}

/// Whether a wire name and a Rust field name are the same field:
/// `validationToken` and `validation_token`.
fn same_field(wire: &str, field: &str) -> bool {
    let plain = |name: &str| name.replace('_', "").to_lowercase();
    plain(wire) == plain(field)
}

/// Whether `body` is the message a row's `match` column describes: `*` is
/// any, `<pointer>` needs the pointer to exist, `<pointer>=<text>` needs
/// that text at it.
pub(crate) fn matches(matcher: &str, body: &Value) -> bool {
    if matcher.is_empty() || matcher == ANY {
        return true;
    }
    match matcher.split_once('=') {
        Some((pointer, wanted)) => body
            .pointer(pointer)
            .is_some_and(|found| scalar(found) == wanted),
        None => body.pointer(matcher).is_some(),
    }
}

/// A JSON scalar as the text a condition compares it with.
pub(crate) fn scalar(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}
