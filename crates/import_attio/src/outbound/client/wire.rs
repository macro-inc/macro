//! Attio's MCP answers, kept to the fields an import reads, and their
//! decoding into the domain's records.
//!
//! **Every shape here is ASSUMED** pending a real capture. Attio does not
//! document its MCP tools' output, so this module assumes each tool answers
//! `structuredContent`, or else JSON text, in Attio REST v2's shapes
//! (`/v2/self`, `/v2/objects`, `/v2/workspace_members`,
//! `/v2/objects/{object}/attributes`, `/v2/objects/{object}/records/query`).
//! One capture settles it: `tools/list` plus one `list-records` each for
//! companies, people and deals on a free-plan workspace with synthetic
//! records. Only this file and the `ASSUMED_*` fixtures should change then.
//!
//! Errors never quote an answer: serde's messages can carry the content.

use std::collections::HashMap;

use mcp_toolset::CallToolResultExt;
use rmcp::model::CallToolResult;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use uuid::Uuid;

use crate::domain::{
    AttioError, Company, Deal, Member, MemberId, Money, Object, Person, RecordId, Stage, StageId,
    Workspace,
};

/// Longest provider explanation kept in an error.
const MESSAGE_CHARS: usize = 200;
/// The deals attribute whose status options are the pipeline's stages.
pub(super) const STAGE_ATTRIBUTE: &str = "stage";
/// The attribute type of a status attribute.
const STATUS_TYPE: &str = "status";
/// The actor type of a workspace member in an actor reference.
const MEMBER_ACTOR: &str = "workspace-member";

/// What one tool call answered.
pub(super) enum Answer {
    /// The answer's JSON.
    Json(serde_json::Value),
    /// Attio refused the call for its rate limit; pace and try again.
    RateLimited,
}

/// Read one tool result. A result the tool marked as an error fails with its
/// bounded explanation, unless it reads as a rate limit.
pub(super) fn answer(tool: &'static str, result: CallToolResult) -> Result<Answer, AttioError> {
    if result.is_error == Some(true) {
        let message = result.error_description();
        if rate_limited(&message) {
            return Ok(Answer::RateLimited);
        }

        return Err(AttioError::Tool {
            tool,
            message: message.chars().take(MESSAGE_CHARS).collect(),
        });
    }

    let value = match result.into_value() {
        serde_json::Value::String(text) => serde_json::from_str(&text).map_err(|_| {
            AttioError::Decode(format!(
                "Attio's {tool} tool answered with text that is not JSON"
            ))
        })?,
        value => value,
    };
    Ok(Answer::Json(value))
}

/// ASSUMED: how a rate limit shows through MCP is unknown. Attio's REST API
/// answers 429 with "Too many requests"; a tool error quoting either is taken
/// as one.
fn rate_limited(message: &str) -> bool {
    let message = message.to_lowercase();
    message.contains("429")
        || message.contains("rate limit")
        || message.contains("too many requests")
}

/// Decode one answer into its expected shape.
pub(super) fn decode<T: DeserializeOwned>(
    tool: &'static str,
    value: serde_json::Value,
) -> Result<T, AttioError> {
    serde_json::from_value(value)
        .map_err(|_| AttioError::Decode(format!("Attio's {tool} answer has an unexpected shape")))
}

/// REST's list envelope. `data` is required: an answer without it is not an
/// empty list.
#[derive(Debug, Deserialize)]
pub(super) struct List<T> {
    pub data: Vec<T>,
}

/// `whoami`, as REST's `/v2/self`.
#[derive(Debug, Deserialize)]
pub(super) struct WireSelf {
    workspace_id: Uuid,
    workspace_slug: Option<String>,
}

impl From<WireSelf> for Workspace {
    fn from(wire: WireSelf) -> Self {
        Self {
            id: wire.workspace_id,
            slug: text(wire.workspace_slug),
        }
    }
}

/// One `list-objects` entry. ASSUMED: an object is listed only once the
/// workspace has turned it on, as REST lists only active objects. The slug
/// is required: an entry without one is a shape this importer does not know,
/// never an object that is off.
#[derive(Debug, Deserialize)]
pub(super) struct WireObject {
    pub api_slug: String,
}

/// One `list-workspace-members` entry.
#[derive(Debug, Deserialize)]
pub(super) struct WireMember {
    id: WireMemberId,
    email_address: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WireMemberId {
    workspace_member_id: Uuid,
}

impl From<WireMember> for Member {
    fn from(wire: WireMember) -> Self {
        Self {
            id: MemberId(wire.id.workspace_member_id),
            email: text(wire.email_address).map(|email| email.to_lowercase()),
        }
    }
}

/// One `list-attribute-definitions` entry. ASSUMED: a status attribute
/// carries its options inline ("including valid options"); REST lists them
/// apart, so a status attribute without them fails the read rather than
/// importing deals without stages. Other attributes' options are not read.
#[derive(Debug, Deserialize)]
pub(super) struct WireAttribute {
    pub api_slug: String,
    #[serde(rename = "type")]
    kind: String,
    pub is_system_attribute: bool,
    options: Option<Vec<serde_json::Value>>,
}

/// A status option. Every flag is required: a missing one would read as
/// `false` and silently lose won or archived stages.
#[derive(Debug, Deserialize)]
struct WireStatus {
    id: WireStatusId,
    title: String,
    celebration_enabled: bool,
    is_archived: bool,
}

#[derive(Debug, Deserialize)]
struct WireStatusId {
    status_id: Uuid,
}

impl WireAttribute {
    /// The deals `stage` attribute, whose options are the stages.
    pub fn is_stage(&self) -> bool {
        self.api_slug == STAGE_ATTRIBUTE && self.kind == STATUS_TYPE
    }

    /// Its status options in Attio's order.
    pub fn stages(self, tool: &'static str) -> Result<Vec<Stage>, AttioError> {
        // No options at all is no more a pipeline than missing ones: deals
        // would import with stages that resolve to nothing.
        let options = self
            .options
            .filter(|options| !options.is_empty())
            .ok_or_else(|| {
                AttioError::Decode(format!(
                    "Attio's {tool} answer lists the deals {STAGE_ATTRIBUTE} without its options"
                ))
            })?;
        options
            .into_iter()
            .map(|option| {
                let status: WireStatus = decode(tool, option)?;
                Ok(Stage {
                    id: StageId(status.id.status_id),
                    title: status.title,
                    celebration_enabled: status.celebration_enabled,
                    archived: status.is_archived,
                })
            })
            .collect()
    }
}

/// One `list-records` entry: the record's id and its values by attribute
/// slug, each a list of value objects (only active ones, as REST answers by
/// default). `values` is required: a record without it is a shape this
/// importer does not know, never a record with nothing set.
#[derive(Debug, Deserialize)]
pub(super) struct WireRecord {
    id: WireRecordId,
    values: HashMap<String, Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
struct WireRecordId {
    record_id: Uuid,
}

impl WireRecord {
    pub fn id(&self) -> RecordId {
        RecordId(self.id.record_id)
    }
}

/// The attributes an object's records are read from. REST answers every
/// attribute, set or not (an empty list), so a page where no record carries
/// one is a shape this importer does not know: the read fails rather than
/// import records with only an id.
fn needed(object: Object) -> &'static [&'static str] {
    match object {
        Object::Companies => &["name", "domains"],
        Object::People => &["name", "email_addresses", "company"],
        Object::Deals => &[
            "name",
            STAGE_ATTRIBUTE,
            "value",
            "owner",
            "associated_company",
            "associated_people",
        ],
    }
}

/// Fail a page none of whose records carries an attribute the object is
/// read from.
pub(super) fn check_page(
    tool: &'static str,
    object: Object,
    page: &[WireRecord],
) -> Result<(), AttioError> {
    if page.is_empty() {
        return Ok(());
    }
    match needed(object)
        .iter()
        .find(|slug| !page.iter().any(|record| record.values.contains_key(**slug)))
    {
        Some(slug) => Err(AttioError::Decode(format!(
            "Attio's {tool} answer for {object} holds no {slug} values"
        ))),
        None => Ok(()),
    }
}

#[derive(Debug, Deserialize)]
struct TextValue {
    value: String,
}

#[derive(Debug, Deserialize)]
struct DomainValue {
    domain: String,
}

#[derive(Debug, Deserialize)]
struct PersonNameValue {
    first_name: Option<String>,
    last_name: Option<String>,
    full_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EmailValue {
    email_address: String,
}

#[derive(Debug, Deserialize)]
struct RecordReference {
    target_object: String,
    target_record_id: Uuid,
}

#[derive(Debug, Deserialize)]
struct StatusValue {
    status: WireStatusReference,
}

#[derive(Debug, Deserialize)]
struct WireStatusReference {
    id: WireStatusId,
}

#[derive(Debug, Deserialize)]
struct CurrencyValue {
    currency_value: f64,
    currency_code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ActorReference {
    referenced_actor_type: String,
    referenced_actor_id: Option<Uuid>,
}

/// A record's values being read, warning (by record id and slug only) about
/// a value that cannot be read instead of failing the record.
struct Values<'a> {
    object: Object,
    id: RecordId,
    values: HashMap<String, Vec<serde_json::Value>>,
    warnings: &'a mut Vec<String>,
}

impl<'a> Values<'a> {
    fn new(object: Object, record: WireRecord, warnings: &'a mut Vec<String>) -> Self {
        Self {
            object,
            id: record.id(),
            values: record.values,
            warnings,
        }
    }

    /// Every readable value of `slug`.
    fn all<T: DeserializeOwned>(&mut self, slug: &str) -> Vec<T> {
        let values = self.values.remove(slug).unwrap_or_default();
        let mut read = Vec::with_capacity(values.len());
        let mut unreadable = false;
        for value in values {
            match serde_json::from_value(value) {
                Ok(value) => read.push(value),
                Err(_) => unreadable = true,
            }
        }

        if unreadable {
            self.warn(slug);
        }
        read
    }

    /// The first (active) value of `slug`.
    fn first<T: DeserializeOwned>(&mut self, slug: &str) -> Option<T> {
        let value = self.values.remove(slug)?.into_iter().next()?;
        match serde_json::from_value(value) {
            Ok(value) => Some(value),
            Err(_) => {
                self.warn(slug);
                None
            }
        }
    }

    fn warn(&mut self, slug: &str) {
        self.warnings.push(format!(
            "Attio {} {}: its {slug} value could not be read, so it is left empty.",
            self.object.singular(),
            self.id
        ));
    }
}

/// The first reference to a company record.
fn company_reference(references: Vec<RecordReference>) -> Option<RecordId> {
    references
        .into_iter()
        .find(|reference| reference.target_object == Object::Companies.slug())
        .map(|reference| RecordId(reference.target_record_id))
}

pub(super) fn company(record: WireRecord, warnings: &mut Vec<String>) -> Company {
    let mut values = Values::new(Object::Companies, record, warnings);
    Company {
        name: values
            .first::<TextValue>("name")
            .and_then(|name| text(Some(name.value))),
        domains: values
            .all::<DomainValue>("domains")
            .into_iter()
            .filter_map(|domain| text(Some(domain.domain)))
            .collect(),
        id: values.id,
    }
}

pub(super) fn person(record: WireRecord, warnings: &mut Vec<String>) -> Person {
    let mut values = Values::new(Object::People, record, warnings);
    let name = values.first::<PersonNameValue>("name");
    let (full_name, first_name, last_name) = match name {
        Some(name) => (
            text(name.full_name),
            text(name.first_name),
            text(name.last_name),
        ),
        None => (None, None, None),
    };

    Person {
        full_name,
        first_name,
        last_name,
        emails: values
            .all::<EmailValue>("email_addresses")
            .into_iter()
            .filter_map(|email| text(Some(email.email_address)))
            .collect(),
        company: company_reference(values.all("company")),
        id: values.id,
    }
}

pub(super) fn deal(record: WireRecord, warnings: &mut Vec<String>) -> Deal {
    let mut values = Values::new(Object::Deals, record, warnings);
    let value = values.first::<CurrencyValue>("value").and_then(|value| {
        if !value.currency_value.is_finite() {
            values.warn("value");
            return None;
        }
        Some(Money {
            amount: value.currency_value,
            currency: text(value.currency_code).map(|code| code.to_uppercase()),
        })
    });
    let owner = values
        .first::<ActorReference>("owner")
        .filter(|actor| actor.referenced_actor_type == MEMBER_ACTOR)
        .and_then(|actor| actor.referenced_actor_id)
        .map(MemberId);

    Deal {
        name: values
            .first::<TextValue>("name")
            .and_then(|name| text(Some(name.value))),
        stage: values
            .first::<StatusValue>(STAGE_ATTRIBUTE)
            .map(|stage| StageId(stage.status.id.status_id)),
        value,
        owner,
        company: company_reference(values.all("associated_company")),
        people: values
            .all::<RecordReference>("associated_people")
            .into_iter()
            .filter(|reference| reference.target_object == Object::People.slug())
            .map(|reference| RecordId(reference.target_record_id))
            .collect(),
        id: values.id,
    }
}

/// A non-empty, trimmed value.
fn text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}
