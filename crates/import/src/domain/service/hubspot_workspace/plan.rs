//! A HubSpot portal as the shared CRM inventory: ledger keys, record URLs,
//! domains from websites, and what only HubSpot records can lose.

use import_hubspot::domain::{CompanyLink, Inventory, ObjectType, RecordId, Stage};

use crate::domain::models::CrmLoss;
use crate::domain::ports::DealOutcome;
use crate::domain::service::crm_workspace::plan::{
    CrmCompany, CrmCompanyLink, CrmContact, CrmDeal, CrmInventory, CrmPipeline, CrmStage,
};

/// Said once per plan: what a HubSpot import never reads.
const NOT_IMPORTED: &str = "Notes, emails, calls, meetings, tasks, tickets, line items, custom objects, attachments and custom property values stay in HubSpot.";
/// The host HubSpot serves most portals from, when the portal names none.
const DEFAULT_UI_DOMAIN: &str = "app.hubspot.com";

/// The ledger key of a HubSpot object, unique across portals.
pub(in crate::domain::service) fn key(portal: u64, kind: &str, id: &str) -> String {
    format!("{portal}:{kind}:{id}")
}

fn record_key(portal: u64, object: ObjectType, id: &RecordId) -> String {
    key(portal, object.as_ref(), id.as_str())
}

/// The record's page in HubSpot.
fn record_url(inventory: &Inventory, object: ObjectType, id: &RecordId) -> String {
    let host = inventory
        .portal
        .ui_domain
        .as_deref()
        .filter(|host| {
            host.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        })
        .unwrap_or(DEFAULT_UI_DOMAIN);
    format!(
        "https://{host}/contacts/{}/record/{}/{}",
        inventory.portal.id,
        object.type_id(),
        id.as_str()
    )
}

/// The host of a website URL, as a domain candidate.
fn website_host(website: &str) -> Option<&str> {
    let rest = website.split_once("://").map_or(website, |(_, rest)| rest);
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit_once('@').map_or(host, |(_, host)| host);
    let host = host.split(':').next()?;
    let host = host.strip_prefix("www.").unwrap_or(host);
    (!host.is_empty()).then_some(host)
}

fn stage_outcome(stage: &Stage) -> DealOutcome {
    match (stage.closed, stage.probability) {
        (false, _) => DealOutcome::Open,
        (true, Some(probability)) if probability >= 1.0 => DealOutcome::Won,
        (true, _) => DealOutcome::Lost,
    }
}

fn links(portal: u64, links: &[CompanyLink]) -> Vec<CrmCompanyLink> {
    links
        .iter()
        .map(|link| CrmCompanyLink {
            company: record_key(portal, ObjectType::Company, &link.company),
            primary: link.primary,
        })
        .collect()
}

/// The portal in the shared CRM inventory's terms.
pub(in crate::domain::service) fn inventory(inventory: &Inventory) -> CrmInventory {
    let portal = inventory.portal.id;
    CrmInventory {
        pipelines: inventory
            .pipelines
            .iter()
            .map(|pipeline| CrmPipeline {
                key: key(portal, "pipeline", pipeline.id.as_str()),
                label: pipeline.label.clone(),
                stages: pipeline
                    .stages
                    .iter()
                    .map(|stage| CrmStage {
                        id: stage.id.as_str().to_owned(),
                        label: stage.label.clone(),
                        outcome: stage_outcome(stage),
                    })
                    .collect(),
            })
            .collect(),
        companies: inventory
            .companies
            .iter()
            .map(|company| CrmCompany {
                key: record_key(portal, ObjectType::Company, &company.id),
                fallback: format!("Company {}", company.id),
                url: Some(record_url(inventory, ObjectType::Company, &company.id)),
                name: company.name.clone(),
                domain: company
                    .domain
                    .as_deref()
                    .or(company.website.as_deref().and_then(website_host))
                    .map(str::to_owned),
                owner: company.owner.as_ref().map(ToString::to_string),
                losses: if company.additional_domains.is_empty() {
                    Vec::new()
                } else {
                    vec![CrmLoss::AdditionalDomains]
                },
            })
            .collect(),
        contacts: inventory
            .contacts
            .iter()
            .map(|contact| CrmContact {
                key: record_key(portal, ObjectType::Contact, &contact.id),
                fallback: format!("Contact {}", contact.id),
                url: Some(record_url(inventory, ObjectType::Contact, &contact.id)),
                name: Some(
                    [contact.first_name.as_deref(), contact.last_name.as_deref()]
                        .into_iter()
                        .flatten()
                        .map(str::trim)
                        .filter(|part| !part.is_empty())
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
                emails: contact
                    .email
                    .iter()
                    .chain(&contact.additional_emails)
                    .cloned()
                    .collect(),
                companies: links(portal, &contact.companies),
            })
            .collect(),
        deals: inventory
            .deals
            .iter()
            .map(|deal| CrmDeal {
                key: record_key(portal, ObjectType::Deal, &deal.id),
                fallback: format!("Deal {}", deal.id),
                url: Some(record_url(inventory, ObjectType::Deal, &deal.id)),
                name: deal.name.clone(),
                pipeline: deal
                    .pipeline
                    .as_ref()
                    .map(|id| key(portal, "pipeline", id.as_str())),
                stage: deal.stage.as_ref().map(|id| id.as_str().to_owned()),
                amount: deal.amount,
                currency: deal.currency.clone(),
                close_date: deal.close_date.clone(),
                companies: links(portal, &deal.companies),
                owner: deal.owner.as_ref().map(ToString::to_string),
                losses: Vec::new(),
            })
            .collect(),
        owners: inventory
            .owners
            .iter()
            .map(|owner| (owner.id.to_string(), owner.email.clone()))
            .collect(),
        default_currency: inventory.portal.currency.clone(),
        custom_properties: inventory
            .custom_properties
            .iter()
            .flat_map(|custom| {
                custom
                    .names
                    .iter()
                    .map(move |name| format!("{}.{name}", custom.object.plural()))
            })
            .collect(),
        warnings: inventory.warnings.clone(),
        not_imported: NOT_IMPORTED,
    }
}

/// Every planned row of a HubSpot portal.
#[cfg(test)]
pub(in crate::domain::service) fn rows(
    portal: &Inventory,
    team: &crate::domain::ports::CrmTeam,
    crm: &dyn crate::domain::ports::CrmImportWriter,
) -> crate::domain::ports::Result<Vec<crate::domain::ports::PlanRow>> {
    crate::domain::service::crm_workspace::plan::rows(
        &inventory(portal),
        crate::domain::service::crm_workspace::CrmKinds::HUBSPOT,
        team,
        crm,
    )
}

#[cfg(test)]
pub(in crate::domain::service) use crate::domain::service::crm_workspace::plan::link_existing;
