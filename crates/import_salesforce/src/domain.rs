//! A Salesforce org's CRM records, read once for a reviewed import.

use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// A Salesforce record id (org, user, account, contact or opportunity):
/// 15 or 18 ASCII letters and digits, kept as Salesforce sent it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RecordId(String);

impl RecordId {
    /// The id as Salesforce writes it.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for RecordId {
    type Error = SalesforceError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let valid_length = value.len() == 15 || value.len() == 18;
        if valid_length && value.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
            Ok(Self(value))
        } else {
            Err(SalesforceError::Decode(
                "a Salesforce record id is malformed".into(),
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

/// The org (Salesforce company) the connection reads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Org {
    /// The org id; part of every ledger key, so two orgs never collide.
    pub id: RecordId,
    /// The org's origin (`https://acme.my.salesforce.com`, no trailing
    /// slash), for record links. Unknown when userinfo names none.
    pub instance_url: Option<String>,
    /// The org's default currency, used for opportunities that name none.
    pub currency: Option<String>,
}

/// A Salesforce user who can own records.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Owner {
    /// User id, as records' `OwnerId` names it.
    pub id: RecordId,
    /// Login email, lowercased, matched only against the importing team's members.
    pub email: Option<String>,
    /// Not deactivated.
    pub active: bool,
}

/// One active opportunity stage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stage {
    /// API name, as opportunities' `StageName` names it.
    pub api_name: String,
    /// Display label.
    pub label: String,
    /// Display position.
    pub sort_order: i32,
    /// A closed stage ends the opportunity.
    pub closed: bool,
    /// A won stage closes it as won.
    pub won: bool,
    /// Default win probability, 0.0 to 1.0.
    pub probability: Option<f64>,
}

/// An account record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    /// Record id.
    pub id: RecordId,
    /// Account name.
    pub name: Option<String>,
    /// Website URL, the account's domain source.
    pub website: Option<String>,
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
    /// Email.
    pub email: Option<String>,
    /// The contact's account.
    pub account: Option<RecordId>,
    /// Owner.
    pub owner: Option<RecordId>,
}

/// An opportunity record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Opportunity {
    /// Record id.
    pub id: RecordId,
    /// Opportunity name.
    pub name: Option<String>,
    /// Its stage's API name (`StageName`).
    pub stage: Option<String>,
    /// Amount.
    pub amount: Option<f64>,
    /// ISO 4217 code (`CurrencyIsoCode`); only multi-currency orgs have one.
    pub currency: Option<String>,
    /// Expected or actual close, `YYYY-MM-DD`.
    pub close_date: Option<String>,
    /// The opportunity's account.
    pub account: Option<RecordId>,
    /// Owner.
    pub owner: Option<RecordId>,
    /// Closed.
    pub closed: bool,
    /// Closed as won.
    pub won: bool,
}

/// Every readable record an import plans from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Inventory {
    /// The org.
    pub org: Org,
    /// Users, including deactivated ones.
    pub owners: Vec<Owner>,
    /// Active opportunity stages in display order.
    pub stages: Vec<Stage>,
    /// Accounts.
    pub accounts: Vec<Account>,
    /// Contacts.
    pub contacts: Vec<Contact>,
    /// Opportunities.
    pub opportunities: Vec<Opportunity>,
    /// Records skipped, with a reason.
    pub warnings: Vec<String>,
}

/// Records read so far, for planning progress.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ReadProgress {
    /// Accounts read.
    pub accounts: usize,
    /// Contacts read.
    pub contacts: usize,
    /// Opportunities read.
    pub opportunities: usize,
}

/// Reading an org failed. Nothing partial is returned.
#[derive(Debug, thiserror::Error)]
pub enum SalesforceError {
    /// The user has no enabled Salesforce connection, or it needs reconnecting.
    #[error("Salesforce is not connected")]
    NotConnected,
    /// Salesforce kept answering 429 or 5xx after every retry.
    #[error("Salesforce is unavailable or rate limited; try again later")]
    Unavailable,
    /// Salesforce rejected a fixed read.
    #[error("Salesforce request failed ({status}): {message}")]
    Upstream {
        /// HTTP status.
        status: u16,
        /// A fixed explanation; Salesforce's own text is never kept, since it
        /// can name people.
        message: String,
    },
    /// A malformed response or a repeating page locator.
    #[error("Invalid Salesforce response: {0}")]
    Decode(String),
    /// The connection lookup or the call through it failed.
    #[error("Salesforce transport failed: {0}")]
    Transport(rootcause::Report),
}

/// Reads a user's connected Salesforce org. Object-safe so the durable import
/// engine can hold it without a type parameter.
#[async_trait]
pub trait SalesforceConnections: Send + Sync + 'static {
    /// Whether the user has a Salesforce connection to read through. Reads
    /// nothing from Salesforce.
    async fn connected(&self, user: &MacroUserIdStr<'static>) -> Result<bool, SalesforceError>;
    /// Read every account, contact and opportunity, with owners and stages,
    /// reporting counts as pages arrive.
    async fn inventory(
        &self,
        user: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(ReadProgress) + Send + Sync),
    ) -> Result<Inventory, SalesforceError>;
}
