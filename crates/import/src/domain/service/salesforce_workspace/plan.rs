//! Convert a Salesforce org into the shared CRM inventory: ledger keys,
//! record links and what only Salesforce loses. The shared CRM planner
//! decides the rest.

use std::collections::HashSet;

use import_salesforce::domain::{Inventory, RecordId, Stage};

use crate::domain::models::CrmLoss;
use crate::domain::ports::DealOutcome;
use crate::domain::service::crm_workspace::plan::{
    CrmCompany, CrmCompanyLink, CrmContact, CrmDeal, CrmInventory, CrmPipeline, CrmStage,
    website_host,
};

/// Said once per plan: what a Salesforce import never reads.
const NOT_IMPORTED: &str = "Leads, activities, tasks, events, notes, cases, campaigns, products, quotes, files and custom fields stay in Salesforce.";
/// The pipeline an org's opportunity stages become.
const PIPELINE_TITLE: &str = "Salesforce opportunities";
/// The one pipeline's id within its org.
const PIPELINE_ID: &str = "opportunities";

/// The ledger key of a Salesforce object, unique across orgs.
fn key(org: &RecordId, kind: &str, id: &str) -> String {
    format!("{org}:{kind}:{id}")
}

/// The record's page in Salesforce, when the org's instance is known.
fn record_url(inventory: &Inventory, object: &str, id: &RecordId) -> Option<String> {
    let origin = inventory.org.instance_url.as_deref()?;
    Some(format!("{origin}/lightning/r/{object}/{id}/view"))
}

fn stage_outcome(stage: &Stage) -> DealOutcome {
    match (stage.closed, stage.won) {
        (false, _) => DealOutcome::Open,
        (true, true) => DealOutcome::Won,
        (true, false) => DealOutcome::Lost,
    }
}

/// An account link, as the account's ledger key.
fn account_link(org: &RecordId, account: Option<&RecordId>) -> Vec<CrmCompanyLink> {
    account
        .map(|account| CrmCompanyLink {
            company: key(org, "company", account.as_str()),
            primary: true,
        })
        .into_iter()
        .collect()
}

/// The org in the shared CRM terms: its active stages as one pipeline,
/// accounts as companies keyed by their website, contacts with their one
/// account, and opportunities as deals that keep how they closed.
pub(in crate::domain::service) fn inventory(inventory: &Inventory) -> CrmInventory {
    let org = &inventory.org.id;
    let pipeline = key(org, "pipeline", PIPELINE_ID);
    let active: HashSet<&str> = inventory
        .stages
        .iter()
        .map(|stage| stage.api_name.as_str())
        .collect();
    CrmInventory {
        pipelines: vec![CrmPipeline {
            key: pipeline.clone(),
            label: PIPELINE_TITLE.to_owned(),
            stages: inventory
                .stages
                .iter()
                .map(|stage| CrmStage {
                    id: stage.api_name.clone(),
                    label: stage.label.clone(),
                    outcome: stage_outcome(stage),
                })
                .collect(),
        }],
        companies: inventory
            .accounts
            .iter()
            .map(|account| CrmCompany {
                key: key(org, "company", account.id.as_str()),
                fallback: format!("Account {}", account.id),
                url: record_url(inventory, "Account", &account.id),
                name: account.name.clone(),
                domain: account
                    .website
                    .as_deref()
                    .and_then(website_host)
                    .map(str::to_owned),
                owner: account.owner.as_ref().map(ToString::to_string),
                losses: Vec::new(),
            })
            .collect(),
        contacts: inventory
            .contacts
            .iter()
            .map(|contact| CrmContact {
                key: key(org, "contact", contact.id.as_str()),
                fallback: format!("Contact {}", contact.id),
                url: record_url(inventory, "Contact", &contact.id),
                name: Some(
                    [contact.first_name.as_deref(), contact.last_name.as_deref()]
                        .into_iter()
                        .flatten()
                        .map(str::trim)
                        .filter(|part| !part.is_empty())
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
                emails: contact.email.iter().cloned().collect(),
                companies: account_link(org, contact.account.as_ref()),
            })
            .collect(),
        deals: inventory
            .opportunities
            .iter()
            .map(|opportunity| {
                let stage = opportunity.stage.clone();
                // A stage the org no longer uses gives no entry stage.
                let retired = stage
                    .as_deref()
                    .is_some_and(|stage| !active.contains(stage));
                CrmDeal {
                    key: key(org, "deal", opportunity.id.as_str()),
                    fallback: format!("Opportunity {}", opportunity.id),
                    url: record_url(inventory, "Opportunity", &opportunity.id),
                    name: opportunity.name.clone(),
                    pipeline: Some(pipeline.clone()),
                    stage,
                    // Salesforce records how each opportunity closed.
                    outcome: Some(match (opportunity.closed, opportunity.won) {
                        (false, _) => DealOutcome::Open,
                        (true, true) => DealOutcome::Won,
                        (true, false) => DealOutcome::Lost,
                    }),
                    amount: opportunity.amount,
                    currency: opportunity.currency.clone(),
                    close_date: opportunity.close_date.clone(),
                    companies: account_link(org, opportunity.account.as_ref()),
                    owner: opportunity.owner.as_ref().map(ToString::to_string),
                    losses: if retired {
                        vec![CrmLoss::ArchivedStage]
                    } else {
                        Vec::new()
                    },
                }
            })
            .collect(),
        owners: inventory
            .owners
            .iter()
            .map(|owner| (owner.id.to_string(), owner.email.clone()))
            .collect(),
        default_currency: inventory.org.currency.clone(),
        custom_properties: Vec::new(),
        warnings: inventory.warnings.clone(),
        not_imported: NOT_IMPORTED,
    }
}
