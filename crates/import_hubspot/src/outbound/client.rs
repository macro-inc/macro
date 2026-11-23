//! HubSpot CRM v3/v4 reads through the user's connected HubSpot API.

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
    Company, CompanyLink, Contact, CustomProperties, Deal, DealPipeline, HubspotConnections,
    HubspotError, Inventory, ObjectType, Owner, PipelineKey, Portal, ReadProgress, RecordId, Scope,
    Stage,
};

mod wire;
use wire::*;

#[cfg(test)]
mod test;

/// HubSpot's catalog app.
const HUBSPOT_APP: &str = "hubspot";
/// HubSpot's API host. Only this host is ever called.
const API: &str = "https://api.hubapi.com";
/// Largest page the v3 list endpoints serve.
const PAGE: &str = "100";
/// Largest page of one record's v4 associations.
const ASSOCIATION_PAGE: &str = "500";
/// Longest provider explanation kept in an error.
const MESSAGE_CHARS: usize = 200;
/// Spacing between requests on one account. HubSpot gives an OAuth app 110
/// requests per 10 seconds per account; this leaves room for retries and for
/// the user's other HubSpot apps.
const INTERVAL: Duration = Duration::from_millis(150);

/// Properties read per object type. Nothing else is requested.
fn properties(object: ObjectType) -> &'static str {
    match object {
        ObjectType::Company => "name,domain,website,hs_additional_domains,hubspot_owner_id",
        ObjectType::Contact => "firstname,lastname,email,hs_additional_emails,hubspot_owner_id",
        ObjectType::Deal => {
            "dealname,amount,deal_currency_code,dealstage,pipeline,closedate,hubspot_owner_id"
        }
    }
}

/// Every request an import may issue. Paths are fixed; callers supply only a
/// paging cursor and, for associations, a record id already read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HubspotRead {
    /// The portal's id, currency and app host.
    AccountDetails,
    /// Owners, active or deactivated.
    Owners {
        /// Deactivated owners.
        archived: bool,
    },
    /// Deal pipelines with their stages.
    DealPipelines,
    /// One object type's records, with companies inline for contacts and deals.
    Objects(ObjectType),
    /// One object type's property definitions.
    Properties(ObjectType),
    /// The rest of one record's company associations, past the inline page.
    CompanyLinks {
        /// Contact or deal.
        from: ObjectType,
        /// The record.
        id: RecordId,
    },
}

impl HubspotRead {
    /// Every read is a GET.
    pub fn method(&self) -> Method {
        Method::GET
    }

    /// The scope HubSpot checks for this read.
    pub fn scope(&self) -> Scope {
        match self {
            Self::AccountDetails => Scope::Account,
            Self::Owners { .. } => Scope::Owners,
            Self::DealPipelines => Scope::Deals,
            Self::Objects(object)
            | Self::Properties(object)
            | Self::CompanyLinks { from: object, .. } => match object {
                ObjectType::Company => Scope::Companies,
                ObjectType::Contact => Scope::Contacts,
                ObjectType::Deal => Scope::Deals,
            },
        }
    }

    /// The request URL, with `after` as an encoded query value.
    pub fn url(&self, after: Option<&str>) -> Result<String, HubspotError> {
        let invalid = |_| HubspotError::Decode("invalid HubSpot URL".into());
        let mut url = url::Url::parse(API).map_err(invalid)?;
        let mut query: Vec<(&str, &str)> = Vec::new();
        match self {
            Self::AccountDetails => url.set_path("/account-info/v3/details"),
            Self::Owners { archived } => {
                url.set_path("/crm/v3/owners");
                query.push(("limit", PAGE));
                if *archived {
                    query.push(("archived", "true"));
                }
            }
            Self::DealPipelines => url.set_path("/crm/v3/pipelines/deals"),
            Self::Objects(object) => {
                url.set_path(&format!("/crm/v3/objects/{}", object.plural()));
                query.push(("limit", PAGE));
                query.push(("properties", properties(*object)));
                if *object != ObjectType::Company {
                    query.push(("associations", "companies"));
                }
            }
            Self::Properties(object) => {
                url.set_path(&format!("/crm/v3/properties/{}", object.plural()));
            }
            Self::CompanyLinks { from, id } => {
                url.set_path(&format!(
                    "/crm/v4/objects/{}/{}/associations/companies",
                    from.plural(),
                    id.as_str()
                ));
                query.push(("limit", ASSOCIATION_PAGE));
            }
        }
        if let Some(after) = after {
            query.push(("after", after));
        }
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query);
        }
        Ok(url.into())
    }
}

/// Map the shared transport's failure for one read.
fn map_error(read: HubspotRead, error: TrackerError) -> HubspotError {
    match error {
        TrackerError::NotConnected | TrackerError::Forbidden { status: 401, .. } => {
            HubspotError::NotConnected
        }
        // HubSpot names a missing scope with this category; any other 403 is
        // a refusal the scope list cannot explain.
        TrackerError::Forbidden { message, .. } if message.contains("MISSING_SCOPES") => {
            HubspotError::MissingScope(read.scope())
        }
        TrackerError::Forbidden { status, message } => HubspotError::Upstream {
            status,
            message: message.chars().take(MESSAGE_CHARS).collect(),
        },
        TrackerError::Upstream { status, .. }
            if status == StatusCode::TOO_MANY_REQUESTS.as_u16() || status >= 500 =>
        {
            HubspotError::Unavailable
        }
        TrackerError::Upstream { status, message } => HubspotError::Upstream {
            status,
            message: message.chars().take(MESSAGE_CHARS).collect(),
        },
        TrackerError::Decode(message) => HubspotError::Decode(message),
        TrackerError::Transport(report) => HubspotError::Transport(report),
    }
}

/// Opens HubSpot inventories through users' HubSpot connections that give
/// API access.
pub struct HubspotApi<S>(Connections<S>);

impl<S: ApiConnectionsService> HubspotApi<S> {
    /// One request budget per user is shared by concurrent imports.
    pub fn new(service: Arc<S>) -> Self {
        Self::with_interval(service, INTERVAL)
    }

    fn with_interval(service: Arc<S>, interval: Duration) -> Self {
        Self(Connections::new(service, HUBSPOT_APP, interval))
    }
}

#[async_trait]
impl<S: ApiConnectionsService> HubspotConnections for HubspotApi<S> {
    #[tracing::instrument(
        name = "import.hubspot.read",
        skip_all,
        fields(companies, contacts, deals, owners, pipelines, warnings),
        err
    )]
    async fn inventory(
        &self,
        user: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(ReadProgress) + Send + Sync),
    ) -> Result<Inventory, HubspotError> {
        let session = self
            .0
            .open(user)
            .await
            .map_err(|error| map_error(HubspotRead::AccountDetails, error))?;
        let client = Client {
            session,
            warnings: Mutex::default(),
        };
        let account: WireAccount = client
            .get(&HubspotRead::AccountDetails, None)
            .instrument(tracing::info_span!("import.hubspot.read.account"))
            .await?;
        let portal = Portal {
            id: account.portal_id,
            currency: text(account.company_currency),
            ui_domain: text(account.ui_domain),
        };
        let owners = client
            .owners()
            .instrument(tracing::info_span!("import.hubspot.read.owners"))
            .await?;
        let pipelines = client
            .pipelines()
            .instrument(tracing::info_span!("import.hubspot.read.pipelines"))
            .await?;

        let mut counts = ReadProgress::default();
        let companies = client
            .records(ObjectType::Company, |count| {
                counts.companies = count;
                progress(counts);
            })
            .instrument(tracing::info_span!("import.hubspot.read.companies"))
            .await?
            .into_iter()
            .map(company)
            .collect::<Vec<_>>();
        let contacts = client
            .linked_records(ObjectType::Contact, |count| {
                counts.contacts = count;
                progress(counts);
            })
            .instrument(tracing::info_span!("import.hubspot.read.contacts"))
            .await?
            .into_iter()
            .map(|(record, companies)| contact(record, companies))
            .collect::<Vec<_>>();
        let deals = client
            .linked_records(ObjectType::Deal, |count| {
                counts.deals = count;
                progress(counts);
            })
            .instrument(tracing::info_span!("import.hubspot.read.deals"))
            .await?
            .into_iter()
            .map(|(record, companies)| client.deal(record, companies))
            .collect::<Vec<_>>();
        let custom_properties = client
            .custom_properties()
            .instrument(tracing::info_span!("import.hubspot.read.properties"))
            .await?;

        let warnings = client
            .warnings
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner);
        let span = tracing::Span::current();
        span.record("companies", companies.len());
        span.record("contacts", contacts.len());
        span.record("deals", deals.len());
        span.record("owners", owners.len());
        span.record("pipelines", pipelines.len());
        span.record("warnings", warnings.len());
        Ok(Inventory {
            portal,
            owners,
            pipelines,
            companies,
            contacts,
            deals,
            custom_properties,
            warnings,
        })
    }
}

/// A record as read: its id and trimmed, non-empty properties.
struct Record {
    id: RecordId,
    properties: std::collections::HashMap<String, String>,
}

impl Record {
    fn take(&mut self, name: &str) -> Option<String> {
        self.properties.remove(name)
    }

    fn owner(&mut self) -> Option<RecordId> {
        self.take("hubspot_owner_id")
            .and_then(|owner| RecordId::try_from(owner).ok())
    }
}

/// A non-empty, trimmed value.
fn text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// HubSpot's `;`-separated multi-value text.
fn list(value: Option<String>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(';')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_owned)
        .collect()
}

fn company(mut record: Record) -> Company {
    Company {
        name: record.take("name"),
        domain: record.take("domain"),
        website: record.take("website"),
        additional_domains: list(record.take("hs_additional_domains")),
        owner: record.owner(),
        id: record.id,
    }
}

fn contact(mut record: Record, companies: Vec<CompanyLink>) -> Contact {
    Contact {
        first_name: record.take("firstname"),
        last_name: record.take("lastname"),
        email: record.take("email"),
        additional_emails: list(record.take("hs_additional_emails")),
        owner: record.owner(),
        companies,
        id: record.id,
    }
}

/// Merge links to one company, keeping first-seen order; a company is primary
/// when any of its links is.
fn add_link(links: &mut Vec<CompanyLink>, company: RecordId, primary: bool) {
    match links.iter_mut().find(|link| link.company == company) {
        Some(link) => link.primary |= primary,
        None => links.push(CompanyLink { company, primary }),
    }
}

/// HubSpot-defined primary association type ids to companies.
fn primary_type_id(from: ObjectType) -> Option<u32> {
    match from {
        ObjectType::Contact => Some(1),
        ObjectType::Deal => Some(5),
        ObjectType::Company => None,
    }
}

impl<S: ApiConnectionsService> Client<S> {
    async fn owners(&self) -> Result<Vec<Owner>, HubspotError> {
        let mut owners = Vec::new();
        for archived in [false, true] {
            self.pages(&HubspotRead::Owners { archived }, |page| {
                for value in page {
                    match serde_json::from_value::<WireOwner>(value)
                        .map_err(|error| error.to_string())
                        .and_then(|owner| {
                            Ok(Owner {
                                id: RecordId::try_from(owner.id).map_err(|e| e.to_string())?,
                                email: text(owner.email).map(|email| email.to_lowercase()),
                                archived: owner.archived || archived,
                            })
                        }) {
                        Ok(owner) => owners.push(owner),
                        Err(error) => {
                            self.warn(format!("Skipped an unreadable HubSpot owner: {error}"))
                        }
                    }
                }
            })
            .await?;
        }
        Ok(owners)
    }

    async fn pipelines(&self) -> Result<Vec<DealPipeline>, HubspotError> {
        let page: Page<WirePipeline> = self.get(&HubspotRead::DealPipelines, None).await?;
        let mut pipelines: Vec<_> = page
            .results
            .into_iter()
            .filter(|pipeline| !pipeline.archived)
            .collect();
        pipelines.sort_by(|a, b| (a.display_order, &a.label).cmp(&(b.display_order, &b.label)));
        pipelines
            .into_iter()
            .map(|pipeline| {
                let mut stages: Vec<_> = pipeline
                    .stages
                    .into_iter()
                    .filter(|stage| !stage.archived)
                    .collect();
                stages
                    .sort_by(|a, b| (a.display_order, &a.label).cmp(&(b.display_order, &b.label)));
                Ok(DealPipeline {
                    id: PipelineKey::try_from(pipeline.id)?,
                    label: pipeline.label,
                    stages: stages
                        .into_iter()
                        .map(|stage| {
                            Ok(Stage {
                                closed: stage.metadata.get("isClosed").is_some_and(|v| v == "true"),
                                probability: stage
                                    .metadata
                                    .get("probability")
                                    .and_then(|v| v.parse().ok()),
                                id: PipelineKey::try_from(stage.id)?,
                                label: stage.label,
                            })
                        })
                        .collect::<Result<_, HubspotError>>()?,
                })
            })
            .collect()
    }

    /// Every record of one type, skipping (and reporting) unreadable ones.
    async fn records(
        &self,
        object: ObjectType,
        mut progress: impl FnMut(usize),
    ) -> Result<Vec<Record>, HubspotError> {
        Ok(self
            .linked_records(object, &mut progress)
            .await?
            .into_iter()
            .map(|(record, _)| record)
            .collect())
    }

    /// Every record of one type with its company links, following a record's
    /// associations past the inline page.
    async fn linked_records(
        &self,
        object: ObjectType,
        mut progress: impl FnMut(usize),
    ) -> Result<Vec<(Record, Vec<CompanyLink>)>, HubspotError> {
        let mut records = Vec::new();
        let mut more = Vec::new();
        self.pages(&HubspotRead::Objects(object), |page| {
            for value in page {
                let wire = match serde_json::from_value::<WireObject>(value) {
                    Ok(wire) => wire,
                    Err(_) => {
                        self.warn(format!("Skipped an unreadable HubSpot {object}."));
                        continue;
                    }
                };
                let Ok(id) = RecordId::try_from(wire.id) else {
                    self.warn(format!("Skipped a HubSpot {object} with a malformed id."));
                    continue;
                };
                let mut links = Vec::new();
                if let Some(inline) = wire.associations.get("companies") {
                    let primary = format!("{object}_to_company");
                    for link in &inline.results {
                        if let Ok(company) = RecordId::try_from(link.id.clone()) {
                            add_link(&mut links, company, link.kind == primary);
                        }
                    }
                    // The inline page's cursor belongs to the v3 list, not to
                    // v4's association endpoint: read v4 from its start.
                    if inline
                        .paging
                        .as_ref()
                        .and_then(|p| p.next.as_ref())
                        .is_some()
                    {
                        more.push(records.len());
                    }
                }
                let properties = wire
                    .properties
                    .into_iter()
                    .filter_map(|(name, value)| Some((name, text(value)?)))
                    .collect();
                records.push((Record { id, properties }, links));
            }
            progress(records.len());
        })
        .await?;
        for index in more {
            let Some((record, links)) = records.get_mut(index) else {
                continue;
            };
            let read = HubspotRead::CompanyLinks {
                from: object,
                id: record.id.clone(),
            };
            let mut after: Option<String> = None;
            let mut seen = HashSet::new();
            loop {
                let page: Page<WireLink> = self.get(&read, after.as_deref()).await?;
                for link in page.results {
                    let primary = link.association_types.iter().any(|kind| {
                        kind.category == "HUBSPOT_DEFINED"
                            && Some(kind.type_id) == primary_type_id(object)
                    });
                    if let Ok(company) = RecordId::try_from(link.to_object_id) {
                        add_link(links, company, primary);
                    }
                }
                let Some(next) = page.paging.and_then(|p| p.next) else {
                    break;
                };
                if next.after.is_empty() || !seen.insert(next.after.clone()) {
                    return Err(HubspotError::Decode(
                        "HubSpot paging cursor repeated".into(),
                    ));
                }
                after = Some(next.after);
            }
        }
        Ok(records)
    }

    fn deal(&self, mut record: Record, companies: Vec<CompanyLink>) -> Deal {
        let amount = record
            .take("amount")
            .and_then(|amount| match amount.parse::<f64>() {
                Ok(amount) if amount.is_finite() => Some(amount),
                _ => {
                    self.warn(format!(
                        "HubSpot deal {} has an amount that is not a number; it is left empty.",
                        record.id
                    ));
                    None
                }
            });
        Deal {
            name: record.take("dealname"),
            pipeline: record
                .take("pipeline")
                .and_then(|key| PipelineKey::try_from(key).ok()),
            stage: record
                .take("dealstage")
                .and_then(|key| PipelineKey::try_from(key).ok()),
            amount,
            currency: record
                .take("deal_currency_code")
                .map(|code| code.to_uppercase()),
            close_date: record.take("closedate"),
            owner: record.owner(),
            companies,
            id: record.id,
        }
    }

    /// Portal-defined property names per type. A grant that may not read
    /// schemas only loses this list.
    async fn custom_properties(&self) -> Result<Vec<CustomProperties>, HubspotError> {
        let mut found = Vec::new();
        for object in [ObjectType::Company, ObjectType::Contact, ObjectType::Deal] {
            let page: Page<WireProperty> = match self
                .get(&HubspotRead::Properties(object), None)
                .await
            {
                Ok(page) => page,
                Err(HubspotError::MissingScope(_) | HubspotError::Upstream { status: 403, .. }) => {
                    self.warn(format!(
                            "HubSpot did not allow reading {} property definitions, so custom properties are not listed.",
                            object.plural()
                        ));
                    continue;
                }
                Err(error) => return Err(error),
            };
            let mut names: Vec<String> = page
                .results
                .into_iter()
                .filter(|property| !property.hubspot_defined)
                .map(|property| property.name)
                .collect();
            if names.is_empty() {
                continue;
            }
            names.sort();
            found.push(CustomProperties { object, names });
        }
        Ok(found)
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

    async fn get<T: DeserializeOwned>(
        &self,
        read: &HubspotRead,
        after: Option<&str>,
    ) -> Result<T, HubspotError> {
        let value = self
            .session
            .read(read.method(), &read.url(after)?, None)
            .await
            .map_err(|error| map_error(read.clone(), error))?;
        serde_json::from_value(value).map_err(|error| HubspotError::Decode(error.to_string()))
    }

    /// Every page of a paged read, refusing a cursor that repeats.
    async fn pages(
        &self,
        read: &HubspotRead,
        mut each: impl FnMut(Vec<serde_json::Value>),
    ) -> Result<(), HubspotError> {
        let mut after: Option<String> = None;
        let mut seen = HashSet::new();
        loop {
            let page: Page<serde_json::Value> = self.get(read, after.as_deref()).await?;
            each(page.results);
            let Some(next) = page.paging.and_then(|paging| paging.next) else {
                return Ok(());
            };
            if next.after.is_empty() || !seen.insert(next.after.clone()) {
                return Err(HubspotError::Decode(
                    "HubSpot paging cursor repeated".into(),
                ));
            }
            after = Some(next.after);
        }
    }
}
