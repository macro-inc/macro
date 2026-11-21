//! Local evaluation of chosen PostHog flags from their polled definitions.
//!
//! PostHog's remote `/flags` endpoint bills every load. This adapter instead
//! polls the definitions of the flags it was built for, with a project secret
//! key, and evaluates them in memory for each user. It supports the release
//! conditions a boolean rollout uses: person properties compared with `exact`,
//! `is_not`, `icontains`, `not_icontains`, `is_set` or `is_not_set`, and a
//! rollout percentage. Any other definition fails the load: it never guesses.

use crate::{FeatureFlags, FlagSnapshot, FlagValue};
use macro_env::Environment;
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::{Client, StatusCode, Url, header};
use rootcause::Report;
use serde::Deserialize;
use serde_json::Value;
use sha1::{Digest as _, Sha1};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::{sync::Mutex, time::Instant};

use super::posthog::{environment_value, parse_origin};

#[cfg(test)]
mod test;

/// How often the definitions are polled once read: a flag change reaches the
/// service within this. PostHog bills an unchanged poll as one flag request.
pub const POLL_INTERVAL: Duration = Duration::from_secs(5 * 60);
/// How soon a failed poll is tried again.
const RETRY_INTERVAL: Duration = Duration::from_secs(30);
/// How long definitions are used after the last successful poll. Past this,
/// loads fail rather than evaluate a rollout that may have been stepped back.
pub const MAX_STALENESS: Duration = Duration::from_secs(60 * 60);

/// Evaluates its flags locally from definitions polled at most once per
/// [`POLL_INTERVAL`].
///
/// Construct once per service and clone to share the definitions. A load
/// returns only the flags named at construction. It fails when the
/// definitions were never read or are older than [`MAX_STALENESS`], or when a
/// named flag's definition can't be evaluated locally. A named flag PostHog
/// doesn't have, or has deleted, is missing from the snapshot.
#[derive(Clone)]
pub struct PostHogLocalFeatureFlags {
    inner: Arc<Inner>,
}

struct Inner {
    client: Client,
    endpoint: Url,
    secret_key: String,
    keys: Vec<String>,
    environment: Environment,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    definitions: Option<Definitions>,
    /// When to poll next; `None` polls on the next load.
    next_poll: Option<Instant>,
}

struct Definitions {
    /// Each named flag PostHog has, as parsed: a definition this adapter can't
    /// read fails every load until it changes.
    flags: HashMap<String, Result<FlagDefinition, Unevaluable>>,
    etag: Option<String>,
    read_at: Instant,
}

impl PostHogLocalFeatureFlags {
    /// Validate configuration and create the shared client.
    ///
    /// `host` is the project's regional origin, as for
    /// [`PostHogFeatureFlags::new`](super::posthog::PostHogFeatureFlags::new).
    /// `project_key` is the project token; `secret_key` is a project secret
    /// API key with `feature_flag:read`, or the feature flags secure API key.
    /// `keys` names the flags to evaluate. `timeout` bounds each poll.
    ///
    /// Each load evaluates with the person properties `distinct_id` (the
    /// exact Macro user ID), `email` (the address in that ID, which the web
    /// client also sets) and `environment` (`prod`, `dev` or `local`). A
    /// condition on any other property can't be evaluated.
    pub fn new(
        host: &str,
        project_key: &str,
        secret_key: String,
        keys: &[&str],
        timeout: Duration,
        environment: Environment,
    ) -> Result<Self, Report> {
        let mut endpoint = parse_origin(host)?;
        for (name, key) in [("project key", project_key), ("secret key", &secret_key)] {
            if key.trim().is_empty() || key.trim() != key {
                return Err(rootcause::report!(
                    "PostHog {name} must be nonblank without surrounding whitespace"
                ));
            }
        }
        if keys.is_empty() || keys.iter().any(|key| key.is_empty()) {
            return Err(rootcause::report!("Name at least one nonblank flag key"));
        }
        if timeout.is_zero() || std::time::Instant::now().checked_add(timeout).is_none() {
            return Err(rootcause::report!(
                "PostHog timeout must be positive and finite"
            ));
        }
        endpoint.set_path("/flags/definitions");
        endpoint
            .query_pairs_mut()
            .append_pair("token", project_key)
            .append_pair("send_cohorts", "");
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(timeout)
            .build()
            .map_err(|error| PollError::Transport(error.without_url()))?;
        Ok(Self {
            inner: Arc::new(Inner {
                client,
                endpoint,
                secret_key,
                keys: keys.iter().map(|key| (*key).to_owned()).collect(),
                environment,
                state: Mutex::default(),
            }),
        })
    }
}

impl Inner {
    /// Poll when due, then evaluate every named flag for `user_id`.
    async fn load(&self, user_id: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        let mut state = self.state.lock().await;
        if state.next_poll.is_none_or(|due| Instant::now() >= due) {
            match self.poll(state.definitions.as_ref()).await {
                Ok(definitions) => {
                    state.definitions = Some(definitions);
                    state.next_poll = Some(Instant::now() + POLL_INTERVAL);
                }
                Err(error) => {
                    tracing::warn!(error = ?error, "PostHog flag definitions poll failed");
                    // A revoked key or a quota block: PostHog's SDKs drop their
                    // definitions too, so a step back made meanwhile isn't missed.
                    if matches!(error, PollError::HttpStatus(401 | 402)) {
                        state.definitions = None;
                    }
                    state.next_poll = Some(Instant::now() + RETRY_INTERVAL);
                }
            }
        }
        let definitions = state
            .definitions
            .as_ref()
            .filter(|definitions| definitions.read_at.elapsed() < MAX_STALENESS)
            .ok_or(LoadError::NoDefinitions)?;
        let person = Person::new(user_id, self.environment);
        let mut flags = Vec::with_capacity(self.keys.len());
        for key in &self.keys {
            let Some(definition) = definitions.flags.get(key) else {
                continue;
            };
            let enabled = definition
                .as_ref()
                .map_err(Clone::clone)
                .and_then(|definition| definition.evaluate(&person))
                .map_err(|reason| LoadError::Unevaluable {
                    key: key.clone(),
                    reason,
                })?;
            if let Some(enabled) = enabled {
                flags.push((key.clone(), FlagValue::Boolean(enabled)));
            }
        }
        Ok(FlagSnapshot::new(flags))
    }

    /// Read the definitions, or confirm the ones held are current.
    #[tracing::instrument(
        name = "feature_flags.definitions_poll",
        skip_all,
        fields(
            status = tracing::field::Empty,
            not_modified = tracing::field::Empty,
            flags_found = tracing::field::Empty,
        ),
        err
    )]
    async fn poll(&self, held: Option<&Definitions>) -> Result<Definitions, PollError> {
        let span = tracing::Span::current();
        let mut request = self
            .client
            .get(self.endpoint.clone())
            .bearer_auth(&self.secret_key);
        if let Some(etag) = held.and_then(|held| held.etag.as_ref()) {
            request = request.header(header::IF_NONE_MATCH, etag);
        }
        let response = request
            .send()
            .await
            .map_err(|error| PollError::Transport(error.without_url()))?;
        span.record("status", response.status().as_u16());
        let etag = response
            .headers()
            .get(header::ETAG)
            .and_then(|etag| etag.to_str().ok())
            .map(str::to_owned);
        let not_modified = response.status() == StatusCode::NOT_MODIFIED;
        span.record("not_modified", not_modified);
        if not_modified && let Some(held) = held {
            return Ok(Definitions {
                flags: held.flags.clone(),
                etag: etag.or_else(|| held.etag.clone()),
                read_at: Instant::now(),
            });
        }
        if response.status() != StatusCode::OK {
            return Err(PollError::HttpStatus(response.status().as_u16()));
        }
        // The client's timeout bounds the whole poll, the body included.
        let body = response
            .bytes()
            .await
            .map_err(|error| PollError::Transport(error.without_url()))?;
        // Never retain a decode error: it may quote the project's definitions.
        let response: DefinitionsResponse =
            serde_json::from_slice(&body).map_err(|_| PollError::MalformedResponse)?;
        let mut flags = HashMap::new();
        for flag in response.flags {
            let Some(key) = flag.get("key").and_then(Value::as_str) else {
                continue;
            };
            if !self.keys.iter().any(|wanted| wanted == key) {
                continue;
            }
            let key = key.to_owned();
            let definition =
                serde_json::from_value(flag).map_err(|_| Unevaluable::UnreadableDefinition);
            flags.insert(key, definition);
        }
        span.record("flags_found", flags.len());
        for key in &self.keys {
            if !flags.contains_key(key) {
                // Reads as off for everyone: say why.
                tracing::warn!(flag = %key, "named flag not in the PostHog definitions");
            }
        }
        Ok(Definitions {
            flags,
            etag,
            read_at: Instant::now(),
        })
    }
}

impl FeatureFlags for PostHogLocalFeatureFlags {
    async fn load(&self, user_id: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        self.inner.load(user_id).await
    }
}

/// The person properties a load evaluates with.
struct Person<'a> {
    distinct_id: &'a str,
    properties: [(&'static str, &'a str); 3],
}

impl<'a> Person<'a> {
    fn new(user_id: &'a MacroUserIdStr<'_>, environment: Environment) -> Self {
        Self {
            distinct_id: user_id.as_ref(),
            properties: [
                ("distinct_id", user_id.as_ref()),
                ("email", user_id.email_str()),
                ("environment", environment_value(environment)),
            ],
        }
    }

    fn property(&self, key: &str) -> Option<&'a str> {
        self.properties
            .iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| *value)
    }
}

/// Why a flag can't be evaluated locally.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
enum Unevaluable {
    #[error("it sets `{0}`, which this evaluator doesn't know")]
    UnknownField(String),
    #[error("its definition could not be read")]
    UnreadableDefinition,
    #[error("it uses {0}, which only PostHog evaluates")]
    Unsupported(&'static str),
    #[error("a condition reads a person property the service doesn't have")]
    MissingProperty,
}

#[derive(Clone, Deserialize)]
struct FlagDefinition {
    key: String,
    active: bool,
    #[serde(default)]
    deleted: bool,
    #[serde(default)]
    ensure_experience_continuity: Option<bool>,
    #[serde(default)]
    bucketing_identifier: Option<String>,
    #[serde(default)]
    filters: Option<Filters>,
}

#[derive(Clone, Deserialize)]
struct Filters {
    #[serde(default)]
    groups: Option<Vec<Condition>>,
    #[serde(default)]
    multivariate: Option<Value>,
    #[serde(default)]
    aggregation_group_type_index: Option<Value>,
    #[serde(default)]
    holdout: Option<Value>,
    #[serde(default)]
    feature_enrollment: Option<bool>,
    #[serde(default)]
    super_groups: Option<Vec<Value>>,
    #[serde(default)]
    bucketing_identifier: Option<String>,
    /// Fields this adapter doesn't know: any set one may change the result.
    #[serde(flatten)]
    other: serde_json::Map<String, Value>,
}

#[derive(Clone, Deserialize)]
struct Condition {
    #[serde(default)]
    properties: Option<Vec<PropertyFilter>>,
    #[serde(default)]
    rollout_percentage: Option<f64>,
    #[serde(default)]
    variant: Option<Value>,
    #[serde(default)]
    aggregation_group_type_index: Option<Value>,
    /// Fields this adapter doesn't know: any set one may change the result.
    #[serde(flatten)]
    other: serde_json::Map<String, Value>,
}

#[derive(Clone, Deserialize)]
struct PropertyFilter {
    key: String,
    #[serde(rename = "type", default)]
    kind: Option<String>,
    #[serde(default)]
    operator: Option<String>,
    #[serde(default)]
    value: Value,
}

#[derive(Deserialize)]
struct DefinitionsResponse {
    flags: Vec<Value>,
}

impl FlagDefinition {
    /// Whether the flag is on for `person`; `None` when it was deleted.
    fn evaluate(&self, person: &Person<'_>) -> Result<Option<bool>, Unevaluable> {
        if self.deleted {
            return Ok(None);
        }
        if !self.active {
            return Ok(Some(false));
        }
        let filters = self.filters.as_ref();
        if self.ensure_experience_continuity == Some(true) {
            return Err(Unevaluable::Unsupported("experience continuity"));
        }
        let bucketing = self
            .bucketing_identifier
            .as_deref()
            .or(filters.and_then(|filters| filters.bucketing_identifier.as_deref()));
        if bucketing.is_some_and(|bucketing| bucketing != "distinct_id") {
            return Err(Unevaluable::Unsupported("bucketing by device"));
        }
        let Some(filters) = filters else {
            return Ok(Some(false));
        };
        if filters
            .multivariate
            .as_ref()
            .is_some_and(|value| !value.is_null())
        {
            return Err(Unevaluable::Unsupported("variants"));
        }
        if filters
            .aggregation_group_type_index
            .as_ref()
            .is_some_and(|value| !value.is_null())
        {
            return Err(Unevaluable::Unsupported("groups"));
        }
        if filters
            .holdout
            .as_ref()
            .is_some_and(|value| !value.is_null())
        {
            return Err(Unevaluable::Unsupported("a holdout"));
        }
        unknown_field(&filters.other, &["payloads"])?;
        if filters.feature_enrollment == Some(true)
            || filters
                .super_groups
                .as_ref()
                .is_some_and(|groups| !groups.is_empty())
        {
            return Err(Unevaluable::Unsupported("early access enrollment"));
        }
        // The flag is on when any condition matches. A condition that can't
        // be evaluated fails the flag only if no other one matches.
        let mut unevaluable = None;
        for condition in filters.groups.iter().flatten() {
            match condition.matches(&self.key, person) {
                Ok(true) => return Ok(Some(true)),
                Ok(false) => {}
                Err(reason) => unevaluable = unevaluable.or(Some(reason)),
            }
        }
        unevaluable.map_or(Ok(Some(false)), Err)
    }
}

impl Condition {
    fn matches(&self, flag_key: &str, person: &Person<'_>) -> Result<bool, Unevaluable> {
        unknown_field(&self.other, &["description", "sort_key"])?;
        if self.variant.as_ref().is_some_and(|value| !value.is_null()) {
            return Err(Unevaluable::Unsupported("variants"));
        }
        if self
            .aggregation_group_type_index
            .as_ref()
            .is_some_and(|value| !value.is_null())
        {
            return Err(Unevaluable::Unsupported("groups"));
        }
        // Every property must match; one that doesn't decides, even past one
        // that can't be evaluated.
        let mut unevaluable = None;
        for filter in self.properties.iter().flatten() {
            match filter.matches(person) {
                Ok(true) => {}
                Ok(false) => return Ok(false),
                Err(reason) => unevaluable = unevaluable.or(Some(reason)),
            }
        }
        if let Some(reason) = unevaluable {
            return Err(reason);
        }
        Ok(self
            .rollout_percentage
            .is_none_or(|percentage| bucket(flag_key, person.distinct_id) <= percentage / 100.0))
    }
}

impl PropertyFilter {
    fn matches(&self, person: &Person<'_>) -> Result<bool, Unevaluable> {
        if self.kind.as_deref().is_some_and(|kind| kind != "person") {
            return Err(Unevaluable::Unsupported("cohort, group or flag conditions"));
        }
        let actual = person
            .property(&self.key)
            .ok_or(Unevaluable::MissingProperty)?;
        match self.operator.as_deref().unwrap_or("exact") {
            operator @ ("exact" | "is_not") => {
                let matched = exact_values(&self.value)?
                    .iter()
                    .any(|value| value.to_lowercase() == actual.to_lowercase());
                Ok(matched == (operator == "exact"))
            }
            operator @ ("icontains" | "not_icontains") => {
                let value = scalar(&self.value)
                    .ok_or(Unevaluable::Unsupported("a non-text icontains value"))?;
                let matched = actual
                    .to_ascii_lowercase()
                    .contains(&value.to_ascii_lowercase());
                Ok(matched == (operator == "icontains"))
            }
            "is_set" => Ok(true),
            "is_not_set" => Ok(false),
            _ => Err(Unevaluable::Unsupported("that property operator")),
        }
    }
}

/// Fail on a field outside the known ones and `harmless`, unless it is unset:
/// PostHog adds fields such as `early_exit` that change who matches.
fn unknown_field(
    fields: &serde_json::Map<String, Value>,
    harmless: &[&str],
) -> Result<(), Unevaluable> {
    let set = |value: &Value| match value {
        Value::Null | Value::Bool(false) => false,
        Value::Array(values) => !values.is_empty(),
        Value::Object(fields) => !fields.is_empty(),
        Value::String(text) => !text.is_empty(),
        Value::Bool(true) | Value::Number(_) => true,
    };
    match fields
        .iter()
        .find(|(name, value)| !harmless.contains(&name.as_str()) && set(value))
    {
        Some((name, _)) => Err(Unevaluable::UnknownField(name.clone())),
        None => Ok(()),
    }
}

/// The values an `exact` or `is_not` filter lists. Boolean-like values and
/// empty lists compare by truthiness in PostHog, which isn't supported here.
fn exact_values(value: &Value) -> Result<Vec<String>, Unevaluable> {
    const UNSUPPORTED: Unevaluable = Unevaluable::Unsupported("a boolean or empty exact value");
    let values = match value {
        Value::Array(values) if !values.is_empty() => values
            .iter()
            .map(|value| scalar(value).ok_or(UNSUPPORTED))
            .collect::<Result<Vec<_>, _>>()?,
        value => vec![scalar(value).ok_or(UNSUPPORTED)?],
    };
    if values
        .iter()
        .any(|value| value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false"))
    {
        return Err(UNSUPPORTED);
    }
    Ok(values)
}

/// A text or integer filter value as text.
fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) if number.is_i64() || number.is_u64() => Some(number.to_string()),
        _ => None,
    }
}

/// Where `distinct_id` falls in `flag_key`'s rollout, in [0, 1]: PostHog's
/// SHA-1 bucketing, the same the web client and `/flags` use.
fn bucket(flag_key: &str, distinct_id: &str) -> f64 {
    let digest = Sha1::digest(format!("{flag_key}.{distinct_id}").as_bytes());
    let mut high = [0; 8];
    high.copy_from_slice(&digest[..8]);
    // The first 15 hex digits: the top 60 bits.
    #[expect(
        clippy::cast_precision_loss,
        reason = "PostHog divides the same 60 bits as a float"
    )]
    let bucket = (u64::from_be_bytes(high) >> 4) as f64 / 0x0FFF_FFFF_FFFF_FFFF_u64 as f64;
    bucket
}

#[derive(Debug, thiserror::Error)]
enum PollError {
    #[error("PostHog transport failed")]
    Transport(#[source] reqwest::Error),
    #[error("PostHog returned HTTP status {0}")]
    HttpStatus(u16),
    #[error("PostHog returned malformed flag definitions")]
    MalformedResponse,
}

#[derive(Debug, thiserror::Error)]
enum LoadError {
    #[error("No PostHog flag definitions read successfully in the last hour")]
    NoDefinitions,
    #[error("PostHog flag {key} can't be evaluated locally: {reason}")]
    Unevaluable { key: String, reason: Unevaluable },
}
