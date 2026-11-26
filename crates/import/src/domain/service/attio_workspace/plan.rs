//! An Attio workspace as the shared CRM inventory: ledger keys
//! `{workspace_id}:{object}:{record_id}`, record URLs, one "Attio deals"
//! pipeline from the deal stages, and what only Attio records can lose.

use std::collections::HashSet;

use import_attio::domain::{Inventory, Object, RecordId, Stage, StageId};

use crate::domain::models::CrmLoss;
use crate::domain::ports::DealOutcome;
use crate::domain::service::crm_workspace::plan::{
    CrmCompany, CrmCompanyLink, CrmContact, CrmDeal, CrmInventory, CrmPipeline, CrmStage,
};

/// Said once per plan: what an Attio import never reads.
const NOT_IMPORTED: &str = "Notes, tasks, comments, lists, emails, calls, meetings, custom objects and custom attribute values stay in Attio.";
/// The one pipeline Attio's deal stages become.
const PIPELINE: &str = "Attio deals";
/// The stage titles, as lowercase words, that end a deal lost: Attio's
/// default "Lost", and the "Closed lost" many CRMs name it.
const LOST_STAGES: [&[&str]; 2] = [&["lost"], &["closed", "lost"]];
/// Attio's app host, which record pages are served from.
const APP: &str = "https://app.attio.com";

/// The ledger key of an Attio object, unique across workspaces.
pub(in crate::domain::service) fn key(workspace: uuid::Uuid, object: &str, id: &str) -> String {
    format!("{workspace}:{object}:{id}")
}

fn record_key(inventory: &Inventory, object: Object, id: &RecordId) -> String {
    key(inventory.workspace.id, object.slug(), &id.to_string())
}

fn pipeline_key(inventory: &Inventory) -> String {
    key(inventory.workspace.id, "pipeline", Object::Deals.slug())
}

/// The record's page in Attio, when the workspace's slug is known.
fn record_url(inventory: &Inventory, object: Object, id: &RecordId) -> Option<String> {
    let slug = inventory.workspace.slug.as_deref().filter(|slug| {
        !slug.is_empty()
            && slug
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    })?;
    Some(format!("{APP}/{slug}/{}/{id}", object.singular()))
}

fn stage_outcome(stage: &Stage) -> DealOutcome {
    if stage.celebration_enabled {
        DealOutcome::Won
    } else if is_lost(&stage.title) {
        DealOutcome::Lost
    } else {
        DealOutcome::Open
    }
}

/// Whether a stage's title says the deal is lost, ignoring case, spacing
/// and symbols such as emoji ("lost", "Closed Lost", "Lost 💀").
fn is_lost(title: &str) -> bool {
    let lowered = title.to_lowercase();
    let words: Vec<&str> = lowered
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    LOST_STAGES.iter().any(|lost| words == *lost)
}

fn company_link(inventory: &Inventory, company: Option<&RecordId>) -> Vec<CrmCompanyLink> {
    company
        .map(|company| CrmCompanyLink {
            company: record_key(inventory, Object::Companies, company),
            primary: true,
        })
        .into_iter()
        .collect()
}

/// The workspace in the shared CRM inventory's terms.
pub(in crate::domain::service) fn inventory(inventory: &Inventory) -> CrmInventory {
    let archived: HashSet<&StageId> = inventory
        .stages
        .iter()
        .filter(|stage| stage.archived)
        .map(|stage| &stage.id)
        .collect();
    // Deals off in the workspace: no stages and no deals, so no pipeline.
    let pipelines = (!inventory.stages.is_empty() || !inventory.deals.is_empty())
        .then(|| CrmPipeline {
            key: pipeline_key(inventory),
            label: PIPELINE.to_owned(),
            stages: inventory
                .stages
                .iter()
                .filter(|stage| !stage.archived)
                .map(|stage| CrmStage {
                    id: stage.id.0.to_string(),
                    label: stage.title.clone(),
                    outcome: stage_outcome(stage),
                })
                .collect(),
        })
        .into_iter()
        .collect();
    CrmInventory {
        pipelines,
        companies: inventory
            .companies
            .iter()
            .map(|company| CrmCompany {
                key: record_key(inventory, Object::Companies, &company.id),
                fallback: format!("Company {}", company.id),
                url: record_url(inventory, Object::Companies, &company.id),
                name: company.name.clone(),
                domain: company.domains.first().cloned(),
                owner: None,
                losses: if company.domains.len() > 1 {
                    vec![CrmLoss::AdditionalDomains]
                } else {
                    Vec::new()
                },
            })
            .collect(),
        contacts: inventory
            .people
            .iter()
            .map(|person| CrmContact {
                key: record_key(inventory, Object::People, &person.id),
                fallback: format!("Person {}", person.id),
                url: record_url(inventory, Object::People, &person.id),
                name: person
                    .full_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_owned)
                    .or_else(|| {
                        Some(
                            [person.first_name.as_deref(), person.last_name.as_deref()]
                                .into_iter()
                                .flatten()
                                .map(str::trim)
                                .filter(|part| !part.is_empty())
                                .collect::<Vec<_>>()
                                .join(" "),
                        )
                    }),
                emails: person.emails.clone(),
                companies: company_link(inventory, person.company.as_ref()),
            })
            .collect(),
        deals: inventory
            .deals
            .iter()
            .map(|deal| {
                let mut losses = Vec::new();
                if !deal.people.is_empty() {
                    losses.push(CrmLoss::DealPeople);
                }
                if deal
                    .stage
                    .as_ref()
                    .is_some_and(|stage| archived.contains(stage))
                {
                    losses.push(CrmLoss::ArchivedStage);
                }
                CrmDeal {
                    key: record_key(inventory, Object::Deals, &deal.id),
                    fallback: format!("Deal {}", deal.id),
                    url: record_url(inventory, Object::Deals, &deal.id),
                    name: deal.name.clone(),
                    pipeline: Some(pipeline_key(inventory)),
                    stage: deal.stage.map(|stage| stage.0.to_string()),
                    amount: deal.value.as_ref().map(|value| value.amount),
                    currency: deal.value.as_ref().and_then(|value| value.currency.clone()),
                    close_date: None,
                    companies: company_link(inventory, deal.company.as_ref()),
                    owner: deal.owner.map(|owner| owner.0.to_string()),
                    losses,
                }
            })
            .collect(),
        owners: inventory
            .members
            .iter()
            .map(|member| (member.id.0.to_string(), member.email.clone()))
            .collect(),
        default_currency: None,
        custom_properties: inventory
            .custom_attributes
            .iter()
            .flat_map(|custom| {
                custom
                    .slugs
                    .iter()
                    .map(move |slug| format!("{}.{slug}", custom.object.slug()))
            })
            .collect(),
        warnings: inventory.warnings.clone(),
        not_imported: NOT_IMPORTED,
    }
}
