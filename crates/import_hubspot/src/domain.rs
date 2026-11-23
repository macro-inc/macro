//! A HubSpot portal's CRM objects, read once for a reviewed import.

use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// A HubSpot record id (company, contact, deal or owner): decimal digits.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RecordId(String);

impl RecordId {
    /// The id as HubSpot writes it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for RecordId {
    type Error = HubspotError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if !value.is_empty() && value.len() <= 20 && value.bytes().all(|b| b.is_ascii_digit()) {
            Ok(Self(value))
        } else {
            Err(HubspotError::Decode(
                "a HubSpot record id is not numeric".into(),
            ))
        }
    }
}

impl From<RecordId> for String {
    fn from(value: RecordId) -> Self {
        value.0
    }
}

impl std::fmt::Display for RecordId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// A deal pipeline or stage id. HubSpot's built-in ones are words
/// (`default`, `closedwon`); ones a portal adds are numeric.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct PipelineKey(String);

impl PipelineKey {
    /// The id as HubSpot writes it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for PipelineKey {
    type Error = HubspotError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if !value.is_empty()
            && value.len() <= 64
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            Ok(Self(value))
        } else {
            Err(HubspotError::Decode(
                "a HubSpot pipeline id is malformed".into(),
            ))
        }
    }
}

impl From<PipelineKey> for String {
    fn from(value: PipelineKey) -> Self {
        value.0
    }
}

/// The CRM object types an import reads.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::AsRefStr,
    strum::Display,
    strum::EnumIter,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ObjectType {
    /// Companies.
    Company,
    /// Contacts.
    Contact,
    /// Deals.
    Deal,
}

impl ObjectType {
    /// HubSpot's plural path segment (`/crm/v3/objects/{plural}`).
    pub fn plural(self) -> &'static str {
        match self {
            Self::Company => "companies",
            Self::Contact => "contacts",
            Self::Deal => "deals",
        }
    }

    /// HubSpot's object type id, as record URLs carry it.
    pub fn type_id(self) -> &'static str {
        match self {
            Self::Company => "0-2",
            Self::Contact => "0-1",
            Self::Deal => "0-3",
        }
    }
}

/// The portal (HubSpot account) the connection reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Portal {
    /// HubSpot's account id; part of every ledger key, so two portals never collide.
    pub id: u64,
    /// The portal's company currency, used for deals that name none.
    pub currency: Option<String>,
    /// The host serving the portal's app (`app.hubspot.com`, `app-eu1.hubspot.com`).
    pub ui_domain: Option<String>,
}

/// A HubSpot user who can own records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Owner {
    /// Owner id, as records' `hubspot_owner_id` names it.
    pub id: RecordId,
    /// Login email, matched only against the importing team's members.
    pub email: Option<String>,
    /// Deactivated in HubSpot.
    pub archived: bool,
}

/// One stage of a deal pipeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stage {
    /// Stage id, as deals' `dealstage` names it.
    pub id: PipelineKey,
    /// Display label.
    pub label: String,
    /// A closed stage ends the deal.
    pub closed: bool,
    /// Win probability, 0.0 to 1.0.
    pub probability: Option<f64>,
}

/// A deal pipeline with its live stages in display order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DealPipeline {
    /// Pipeline id, as deals' `pipeline` names it.
    pub id: PipelineKey,
    /// Display label.
    pub label: String,
    /// Stages in display order; archived stages are left out.
    pub stages: Vec<Stage>,
}

/// A link from a contact or deal to a company.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompanyLink {
    /// The company.
    pub company: RecordId,
    /// HubSpot's primary association (one per record at most).
    pub primary: bool,
}

/// A company record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Company {
    /// Record id.
    pub id: RecordId,
    /// Company name.
    pub name: Option<String>,
    /// Primary domain.
    pub domain: Option<String>,
    /// Website URL, a domain source when `domain` is empty.
    pub website: Option<String>,
    /// Further domains (`hs_additional_domains`).
    pub additional_domains: Vec<String>,
    /// Owner.
    pub owner: Option<RecordId>,
}

/// A contact record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Contact {
    /// Record id.
    pub id: RecordId,
    /// First name.
    pub first_name: Option<String>,
    /// Last name.
    pub last_name: Option<String>,
    /// Primary email.
    pub email: Option<String>,
    /// Further emails (`hs_additional_emails`).
    pub additional_emails: Vec<String>,
    /// Associated companies.
    pub companies: Vec<CompanyLink>,
    /// Owner.
    pub owner: Option<RecordId>,
}

/// A deal record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Deal {
    /// Record id.
    pub id: RecordId,
    /// Deal name.
    pub name: Option<String>,
    /// Its pipeline.
    pub pipeline: Option<PipelineKey>,
    /// Its stage in that pipeline.
    pub stage: Option<PipelineKey>,
    /// Amount; HubSpot stores a decimal string.
    pub amount: Option<f64>,
    /// ISO 4217 code (`deal_currency_code`).
    pub currency: Option<String>,
    /// Expected or actual close, as HubSpot sends it (ISO 8601).
    pub close_date: Option<String>,
    /// Associated companies.
    pub companies: Vec<CompanyLink>,
    /// Owner.
    pub owner: Option<RecordId>,
}

/// Properties a portal defined itself on one object type. Their values are not imported.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomProperties {
    /// The object type.
    pub object: ObjectType,
    /// Internal property names, sorted.
    pub names: Vec<String>,
}

/// Every readable, non-archived object an import plans from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Inventory {
    /// The portal.
    pub portal: Portal,
    /// Owners, including deactivated ones.
    pub owners: Vec<Owner>,
    /// Deal pipelines in display order.
    pub pipelines: Vec<DealPipeline>,
    /// Companies.
    pub companies: Vec<Company>,
    /// Contacts.
    pub contacts: Vec<Contact>,
    /// Deals.
    pub deals: Vec<Deal>,
    /// Portal-defined properties per object type, when the grant may read schemas.
    pub custom_properties: Vec<CustomProperties>,
    /// Objects or features skipped, with a reason.
    pub warnings: Vec<String>,
}

/// Objects read so far, for planning progress.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ReadProgress {
    /// Companies read.
    pub companies: usize,
    /// Contacts read.
    pub contacts: usize,
    /// Deals read.
    pub deals: usize,
}

/// The HubSpot scope a read needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr, strum::Display)]
pub enum Scope {
    /// `crm.objects.companies.read`
    #[strum(serialize = "crm.objects.companies.read")]
    Companies,
    /// `crm.objects.contacts.read`
    #[strum(serialize = "crm.objects.contacts.read")]
    Contacts,
    /// `crm.objects.deals.read`
    #[strum(serialize = "crm.objects.deals.read")]
    Deals,
    /// `crm.objects.owners.read`
    #[strum(serialize = "crm.objects.owners.read")]
    Owners,
    /// The connection itself (`oauth`), for account details.
    #[strum(serialize = "oauth")]
    Account,
}

/// Reading a portal failed. Nothing partial is returned.
#[derive(Debug, thiserror::Error)]
pub enum HubspotError {
    /// The user has no enabled HubSpot connection, or it needs reconnecting.
    #[error("HubSpot is not connected")]
    NotConnected,
    /// HubSpot refused a read the connection's grant does not cover.
    #[error("The HubSpot connection is missing the {0} scope")]
    MissingScope(Scope),
    /// HubSpot kept answering 429 or 5xx after every retry.
    #[error("HubSpot is unavailable or rate limited; try again later")]
    Unavailable,
    /// HubSpot rejected a fixed read.
    #[error("HubSpot request failed ({status}): {message}")]
    Upstream {
        /// HTTP status.
        status: u16,
        /// Bounded provider explanation.
        message: String,
    },
    /// A malformed response or a repeating cursor.
    #[error("Invalid HubSpot response: {0}")]
    Decode(String),
    /// The connection lookup or the call through it failed.
    #[error("HubSpot transport failed: {0}")]
    Transport(rootcause::Report),
}

/// Reads a user's connected HubSpot portal. Object-safe so the durable import
/// engine can hold it without a type parameter.
#[async_trait]
pub trait HubspotConnections: Send + Sync + 'static {
    /// Read every non-archived company, contact and deal, with owners and
    /// pipelines, reporting counts as pages arrive.
    async fn inventory(
        &self,
        user: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(ReadProgress) + Send + Sync),
    ) -> Result<Inventory, HubspotError>;
}
