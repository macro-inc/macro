//! Salesforce REST reads through the user's connected Salesforce API.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use async_trait::async_trait;
use connectors::ApiConnectionsService;
use http::{Method, StatusCode};
use import_tracker::domain::model::TrackerError;
use import_tracker::outbound::connection::{Connections, Session};
use macro_user_id::user_id::MacroUserIdStr;
use serde::de::DeserializeOwned;
use tracing::Instrument;

use crate::domain::{
    Account, Contact, Inventory, Opportunity, Org, Owner, ReadProgress, RecordId,
    SalesforceConnections, SalesforceError, Stage,
};

mod wire;
use wire::*;

#[cfg(test)]
mod test;

/// Salesforce's catalog app. Its proxy target is the org's own instance, so
/// every request URL is a path on it.
const SALESFORCE_APP: &str = "salesforce_rest_api";
/// The REST API version every query names.
const API_VERSION: &str = "v62.0";
/// Longest query locator accepted from `nextRecordsUrl`.
const LOCATOR_CHARS: usize = 64;
/// Spacing between requests on one account. Salesforce limits requests per
/// day, not per second; queries return up to 2,000 records a page.
const INTERVAL: Duration = Duration::from_millis(100);

/// The SOQL queries an import runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Query {
    /// The org's default currency.
    OrgCurrency,
    /// Users, active or not.
    Users,
    /// Active opportunity stages.
    Stages,
    /// Accounts.
    Accounts,
    /// Contacts.
    Contacts,
    /// Opportunities.
    Opportunities {
        /// Read `CurrencyIsoCode`, which only multi-currency orgs have.
        currency: bool,
    },
}

impl Query {
    /// The fixed SOQL text. Nothing else is ever queried.
    pub fn soql(self) -> &'static str {
        match self {
            Self::OrgCurrency => "SELECT DefaultCurrencyIsoCode FROM Organization",
            Self::Users => "SELECT Id, Email, IsActive FROM User",
            Self::Stages => {
                "SELECT ApiName, MasterLabel, SortOrder, IsClosed, IsWon, DefaultProbability \
                 FROM OpportunityStage WHERE IsActive = true ORDER BY SortOrder"
            }
            Self::Accounts => "SELECT Id, Name, Website, OwnerId FROM Account ORDER BY Id",
            Self::Contacts => {
                "SELECT Id, FirstName, LastName, Email, AccountId, OwnerId FROM Contact ORDER BY Id"
            }
            Self::Opportunities { currency: true } => {
                "SELECT Id, Name, StageName, Amount, CloseDate, AccountId, OwnerId, IsClosed, \
                 IsWon, CurrencyIsoCode FROM Opportunity ORDER BY Id"
            }
            Self::Opportunities { currency: false } => {
                "SELECT Id, Name, StageName, Amount, CloseDate, AccountId, OwnerId, IsClosed, \
                 IsWon FROM Opportunity ORDER BY Id"
            }
        }
    }
}

/// The rest of a query's results, as Salesforce's `nextRecordsUrl` names it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct QueryLocator(String);

impl QueryLocator {
    /// The locator in a `nextRecordsUrl` for this API version. Anything else
    /// (another host, version or path) is refused rather than followed.
    pub fn parse(next_records_url: &str) -> Result<Self, SalesforceError> {
        let prefix = format!("/services/data/{API_VERSION}/query/");
        next_records_url
            .strip_prefix(prefix.as_str())
            .filter(|locator| {
                !locator.is_empty()
                    && locator.len() <= LOCATOR_CHARS
                    && locator
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            })
            .map(|locator| Self(locator.to_owned()))
            .ok_or_else(|| SalesforceError::Decode("a Salesforce next page is malformed".into()))
    }
}

/// Every request an import may issue. Paths are fixed and relative to the
/// org's instance, which the connection fills in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SalesforceRead {
    /// The connected user's org and its origin.
    UserInfo,
    /// A query's first page.
    Query(Query),
    /// A query's next page.
    QueryMore(QueryLocator),
}

impl SalesforceRead {
    /// Every read is a GET.
    pub fn method(&self) -> Method {
        Method::GET
    }

    /// The request path, relative to the org's instance.
    pub fn url(&self) -> String {
        match self {
            Self::UserInfo => "/services/oauth2/userinfo".to_owned(),
            Self::Query(query) => {
                let soql: String =
                    url::form_urlencoded::byte_serialize(query.soql().as_bytes()).collect();
                format!("/services/data/{API_VERSION}/query?q={soql}")
            }
            Self::QueryMore(QueryLocator(locator)) => {
                format!("/services/data/{API_VERSION}/query/{locator}")
            }
        }
    }
}

/// Map the shared transport's failure. Salesforce's text is never kept: it
/// can name people and records.
fn map_error(error: TrackerError) -> SalesforceError {
    match error {
        TrackerError::NotConnected | TrackerError::Forbidden { status: 401, .. } => {
            SalesforceError::NotConnected
        }
        TrackerError::Forbidden { status, .. } => SalesforceError::Upstream {
            status,
            message: "Salesforce refused this read.".into(),
        },
        TrackerError::Upstream { status, .. }
            if status == StatusCode::TOO_MANY_REQUESTS.as_u16() || status >= 500 =>
        {
            SalesforceError::Unavailable
        }
        TrackerError::Upstream { status, .. } => SalesforceError::Upstream {
            status,
            message: "Salesforce rejected this read.".into(),
        },
        TrackerError::Decode(message) => SalesforceError::Decode(message),
        TrackerError::Transport(report) => SalesforceError::Transport(report),
    }
}

/// Salesforce answered a query with `INVALID_FIELD`: the org lacks a field
/// the query names. Only the error code is looked at; the text is dropped.
fn invalid_field(error: &TrackerError) -> bool {
    matches!(
        error,
        TrackerError::Upstream { status: 400, message } if message.contains("INVALID_FIELD")
    )
}

/// The org's origin for record links: its My Domain, else the host serving
/// its REST API or profile pages. Only https origins count.
fn instance_origin(urls: WireUrls) -> Option<String> {
    [urls.custom_domain, urls.rest, urls.profile]
        .into_iter()
        .flatten()
        .find_map(|value| {
            let url = url::Url::parse(&value).ok()?;
            let https = url.scheme() == "https" && url.host_str().is_some();
            https.then(|| url.origin().ascii_serialization())
        })
}

/// A non-empty, trimmed value.
fn text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// A reference to another record; a malformed one is left empty.
fn reference(value: Option<String>) -> Option<RecordId> {
    text(value).and_then(|id| RecordId::try_from(id).ok())
}

/// Opens Salesforce inventories through users' Salesforce connections that
/// give API access.
pub struct SalesforceApi<S>(Connections<S>);

impl<S: ApiConnectionsService> SalesforceApi<S> {
    /// One request budget per user is shared by concurrent imports.
    pub fn new(service: Arc<S>) -> Self {
        Self::with_interval(service, INTERVAL)
    }

    fn with_interval(service: Arc<S>, interval: Duration) -> Self {
        Self(Connections::new(service, SALESFORCE_APP, interval))
    }
}

#[async_trait]
impl<S: ApiConnectionsService> SalesforceConnections for SalesforceApi<S> {
    #[tracing::instrument(name = "import.salesforce.connected", skip_all, err)]
    async fn connected(&self, user: &MacroUserIdStr<'static>) -> Result<bool, SalesforceError> {
        match self.0.open(user).await {
            Ok(_) => Ok(true),
            Err(TrackerError::NotConnected) => Ok(false),
            Err(error) => Err(map_error(error)),
        }
    }

    #[tracing::instrument(
        name = "import.salesforce.read",
        skip_all,
        fields(accounts, contacts, opportunities, owners, stages, warnings),
        err
    )]
    async fn inventory(
        &self,
        user: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(ReadProgress) + Send + Sync),
    ) -> Result<Inventory, SalesforceError> {
        let session = self.0.open(user).await.map_err(map_error)?;
        let client = Client {
            session,
            warnings: Mutex::default(),
        };

        let user_info: WireUserInfo = client
            .get(&SalesforceRead::UserInfo)
            .instrument(tracing::info_span!("import.salesforce.read.userinfo"))
            .await?;
        let currency = client
            .org_currency()
            .instrument(tracing::info_span!(
                "import.salesforce.read.organization",
                total = tracing::field::Empty
            ))
            .await?;
        let org = Org {
            id: RecordId::try_from(user_info.organization_id)?,
            instance_url: instance_origin(user_info.urls),
            currency,
        };
        let owners = client
            .owners()
            .instrument(tracing::info_span!(
                "import.salesforce.read.owners",
                total = tracing::field::Empty
            ))
            .await?;
        let stages = client
            .stages()
            .instrument(tracing::info_span!(
                "import.salesforce.read.stages",
                total = tracing::field::Empty
            ))
            .await?;

        let mut counts = ReadProgress::default();
        let accounts = client
            .accounts(|count| {
                counts.accounts = count;
                progress(counts);
            })
            .instrument(tracing::info_span!(
                "import.salesforce.read.accounts",
                total = tracing::field::Empty
            ))
            .await?;
        let contacts = client
            .contacts(|count| {
                counts.contacts = count;
                progress(counts);
            })
            .instrument(tracing::info_span!(
                "import.salesforce.read.contacts",
                total = tracing::field::Empty
            ))
            .await?;
        let opportunities = client
            .opportunities(|count| {
                counts.opportunities = count;
                progress(counts);
            })
            .instrument(tracing::info_span!(
                "import.salesforce.read.opportunities",
                total = tracing::field::Empty
            ))
            .await?;

        let warnings = client
            .warnings
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner);
        let span = tracing::Span::current();
        span.record("accounts", accounts.len());
        span.record("contacts", contacts.len());
        span.record("opportunities", opportunities.len());
        span.record("owners", owners.len());
        span.record("stages", stages.len());
        span.record("warnings", warnings.len());
        Ok(Inventory {
            org,
            owners,
            stages,
            accounts,
            contacts,
            opportunities,
            warnings,
        })
    }
}

struct Client<S> {
    session: Session<S>,
    warnings: Mutex<Vec<String>>,
}

impl<S: ApiConnectionsService> Client<S> {
    fn warn(&self, warning: String) {
        self.warnings
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(warning);
    }

    /// One fixed read, with the transport's failure as it gave it.
    async fn send(&self, read: &SalesforceRead) -> Result<serde_json::Value, TrackerError> {
        self.session.read(read.method(), &read.url(), None).await
    }

    async fn get<T: DeserializeOwned>(&self, read: &SalesforceRead) -> Result<T, SalesforceError> {
        let value = self.send(read).await.map_err(map_error)?;
        // serde's message can quote the value it rejected, so it is not kept.
        serde_json::from_value(value)
            .map_err(|_| SalesforceError::Decode("a Salesforce answer is malformed".into()))
    }

    /// Every page of a query, starting from its first page.
    async fn pages(
        &self,
        first: serde_json::Value,
        mut each: impl FnMut(Vec<serde_json::Value>),
    ) -> Result<(), SalesforceError> {
        let malformed = |_| SalesforceError::Decode("a Salesforce query page is malformed".into());
        let mut page: QueryPage = serde_json::from_value(first).map_err(malformed)?;
        tracing::Span::current().record("total", page.total_size);
        let mut seen = HashSet::new();
        loop {
            each(page.records);
            if page.done {
                return Ok(());
            }

            // An unfinished query must name its next page, and never one
            // already read: either would silently truncate the import.
            let next = page.next_records_url.ok_or_else(|| {
                SalesforceError::Decode("an unfinished Salesforce query names no next page".into())
            })?;
            let locator = QueryLocator::parse(&next)?;
            if !seen.insert(locator.clone()) {
                return Err(SalesforceError::Decode(
                    "a Salesforce query page repeated".into(),
                ));
            }
            let value = self
                .send(&SalesforceRead::QueryMore(locator))
                .await
                .map_err(map_error)?;
            page = serde_json::from_value(value).map_err(malformed)?;
        }
    }

    /// Every page of a fixed query.
    async fn query(
        &self,
        query: Query,
        each: impl FnMut(Vec<serde_json::Value>),
    ) -> Result<(), SalesforceError> {
        let first = self
            .send(&SalesforceRead::Query(query))
            .await
            .map_err(map_error)?;
        self.pages(first, each).await
    }

    /// One record, or a warning naming only its type.
    fn record<T: DeserializeOwned>(&self, value: serde_json::Value, object: &str) -> Option<T> {
        match serde_json::from_value(value) {
            Ok(record) => Some(record),
            Err(_) => {
                self.warn(format!("Skipped an unreadable Salesforce {object}."));
                None
            }
        }
    }

    /// A record's own id, or a warning naming only its type.
    fn id(&self, id: String, object: &str) -> Option<RecordId> {
        match RecordId::try_from(id) {
            Ok(id) => Some(id),
            Err(_) => {
                self.warn(format!(
                    "Skipped a Salesforce {object} with a malformed id."
                ));
                None
            }
        }
    }

    /// The org's default currency. An org without the field has none.
    async fn org_currency(&self) -> Result<Option<String>, SalesforceError> {
        let first = match self.send(&SalesforceRead::Query(Query::OrgCurrency)).await {
            Err(error) if invalid_field(&error) => return Ok(None),
            result => result.map_err(map_error)?,
        };
        let mut rows = Vec::new();
        self.pages(first, |page| rows.extend(page)).await?;
        let Some(row) = rows.into_iter().next() else {
            return Ok(None);
        };
        let organization: WireOrganization = serde_json::from_value(row).map_err(|_| {
            SalesforceError::Decode("the Salesforce organization is malformed".into())
        })?;
        Ok(text(organization.default_currency_iso_code))
    }

    async fn owners(&self) -> Result<Vec<Owner>, SalesforceError> {
        let mut owners = Vec::new();
        self.query(Query::Users, |page| {
            for value in page {
                let Some(user) = self.record::<WireUser>(value, "user") else {
                    continue;
                };
                let Some(id) = self.id(user.id, "user") else {
                    continue;
                };
                owners.push(Owner {
                    id,
                    email: text(user.email).map(|email| email.to_lowercase()),
                    active: user.is_active,
                });
            }
        })
        .await?;
        Ok(owners)
    }

    async fn stages(&self) -> Result<Vec<Stage>, SalesforceError> {
        let mut stages = Vec::new();
        self.query(Query::Stages, |page| {
            for value in page {
                let Some(stage) = self.record::<WireStage>(value, "opportunity stage") else {
                    continue;
                };
                stages.push(Stage {
                    api_name: stage.api_name,
                    label: stage.master_label,
                    sort_order: stage.sort_order.unwrap_or_default(),
                    closed: stage.is_closed,
                    won: stage.is_won,
                    probability: stage.default_probability.map(|percent| percent / 100.0),
                });
            }
        })
        .await?;
        Ok(stages)
    }

    async fn accounts(
        &self,
        mut progress: impl FnMut(usize),
    ) -> Result<Vec<Account>, SalesforceError> {
        let mut accounts = Vec::new();
        self.query(Query::Accounts, |page| {
            for value in page {
                let Some(account) = self.record::<WireAccount>(value, "account") else {
                    continue;
                };
                let Some(id) = self.id(account.id, "account") else {
                    continue;
                };
                accounts.push(Account {
                    id,
                    name: text(account.name),
                    website: text(account.website),
                    owner: reference(account.owner_id),
                });
            }
            progress(accounts.len());
        })
        .await?;
        Ok(accounts)
    }

    async fn contacts(
        &self,
        mut progress: impl FnMut(usize),
    ) -> Result<Vec<Contact>, SalesforceError> {
        let mut contacts = Vec::new();
        self.query(Query::Contacts, |page| {
            for value in page {
                let Some(contact) = self.record::<WireContact>(value, "contact") else {
                    continue;
                };
                let Some(id) = self.id(contact.id, "contact") else {
                    continue;
                };
                contacts.push(Contact {
                    id,
                    first_name: text(contact.first_name),
                    last_name: text(contact.last_name),
                    email: text(contact.email),
                    account: reference(contact.account_id),
                    owner: reference(contact.owner_id),
                });
            }
            progress(contacts.len());
        })
        .await?;
        Ok(contacts)
    }

    /// Opportunities with their currency. A single-currency org has no
    /// `CurrencyIsoCode`, so an `INVALID_FIELD` answer re-runs the query once
    /// without it.
    async fn opportunities(
        &self,
        mut progress: impl FnMut(usize),
    ) -> Result<Vec<Opportunity>, SalesforceError> {
        let with_currency = SalesforceRead::Query(Query::Opportunities { currency: true });
        let without_currency = SalesforceRead::Query(Query::Opportunities { currency: false });
        let first = match self.send(&with_currency).await {
            Err(error) if invalid_field(&error) => {
                self.send(&without_currency).await.map_err(map_error)?
            }
            result => result.map_err(map_error)?,
        };

        let mut opportunities = Vec::new();
        self.pages(first, |page| {
            for value in page {
                let Some(opportunity) = self.record::<WireOpportunity>(value, "opportunity") else {
                    continue;
                };
                let Some(id) = self.id(opportunity.id, "opportunity") else {
                    continue;
                };
                opportunities.push(Opportunity {
                    id,
                    name: text(opportunity.name),
                    stage: text(opportunity.stage_name),
                    amount: opportunity.amount,
                    currency: text(opportunity.currency_iso_code),
                    close_date: text(opportunity.close_date),
                    account: reference(opportunity.account_id),
                    owner: reference(opportunity.owner_id),
                    closed: opportunity.is_closed,
                    won: opportunity.is_won,
                });
            }
            progress(opportunities.len());
        })
        .await?;
        Ok(opportunities)
    }
}
