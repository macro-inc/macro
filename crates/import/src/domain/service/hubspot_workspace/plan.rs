//! Turn a HubSpot inventory into decided plan rows: what each object becomes
//! in Macro CRM, what it links to, and what it loses.

use std::collections::{HashMap, HashSet};

use import_hubspot::domain::{CompanyLink, Deal, Inventory, ObjectType, RecordId};

use super::{DealPlan, HubspotMeta, HubspotObject, PlanSummary};
use crate::domain::models::{
    HubspotLoss, ImportEntity, ImportKind, ImportStatus, NotionAlreadyImported, NotionDecision,
    NotionPlanItem,
};
use crate::domain::ports::{CrmImportWriter, CrmTeam, DealOutcome, PlanRow, Result};

/// Said once per plan: what a HubSpot import never reads.
const NOT_IMPORTED: &str = "Notes, emails, calls, meetings, tasks, tickets, line items, custom objects, attachments and custom property values stay in HubSpot.";
/// The host HubSpot serves most portals from, when the portal names none.
const DEFAULT_UI_DOMAIN: &str = "app.hubspot.com";
/// Longest title kept for a row: CRM display names are capped at 200 characters.
const TITLE_CHARS: usize = 200;

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

fn title(value: &str) -> String {
    value.trim().chars().take(TITLE_CHARS).collect()
}

/// The company a contact or deal is filed under: its primary, else its first
/// link, among companies the plan holds; and whether it had others.
fn company_of<'a>(
    links: &'a [CompanyLink],
    planned: &HashSet<&RecordId>,
) -> (Option<&'a RecordId>, bool) {
    let known: Vec<&CompanyLink> = links
        .iter()
        .filter(|link| planned.contains(&link.company))
        .collect();
    let chosen = known
        .iter()
        .find(|link| link.primary)
        .or(known.first())
        .map(|link| &link.company);
    (chosen, known.len() > 1)
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

fn plan_item(decision: NotionDecision, reason: Option<&str>) -> NotionPlanItem {
    NotionPlanItem {
        decision: Some(decision),
        reason: reason.map(str::to_owned),
        path: Vec::new(),
        rows: None,
        sample_titles: Vec::new(),
        task_fields: None,
        // CRM records belong to the team: every member with CRM access sees them.
        shared: true,
        shared_reason: None,
        shareable: false,
        already_imported: None,
    }
}

fn row(
    kind: ImportKind,
    foreign_id: String,
    parent: Option<String>,
    meta: HubspotMeta,
) -> Result<PlanRow> {
    Ok(PlanRow {
        kind,
        foreign_id,
        parent_foreign_id: parent,
        metadata: serde_json::to_value(meta)?,
    })
}

fn stage_outcome(closed: bool, probability: Option<f64>) -> DealOutcome {
    match (closed, probability) {
        (false, _) => DealOutcome::Open,
        (true, Some(probability)) if probability >= 1.0 => DealOutcome::Won,
        (true, _) => DealOutcome::Lost,
    }
}

/// `YYYY-MM-DD` from HubSpot's ISO timestamp.
fn date(value: &str) -> Option<String> {
    let day = value.get(..10)?;
    let bytes = day.as_bytes();
    (bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && day
            .bytes()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit()))
    .then(|| day.to_owned())
}

/// Every planned row, parents first: pipelines, companies, contacts, deals.
pub(in crate::domain::service) fn rows(
    inventory: &Inventory,
    team: &CrmTeam,
    crm: &dyn CrmImportWriter,
) -> Result<Vec<PlanRow>> {
    let portal = inventory.portal.id;
    let members: HashMap<&str, &str> = team
        .members
        .iter()
        .map(|member| (member.email.as_str(), member.user_id.as_str()))
        .collect();
    let owners: HashMap<&RecordId, Option<&str>> = inventory
        .owners
        .iter()
        .map(|owner| (&owner.id, owner.email.as_deref()))
        .collect();
    let member_of = |owner: &RecordId| -> Option<String> {
        owners
            .get(owner)
            .copied()
            .flatten()
            .map(str::to_lowercase)
            .and_then(|email| members.get(email.as_str()).map(|id| (*id).to_owned()))
    };
    let mut named_owners: HashSet<&RecordId> = HashSet::new();
    let mut rows = Vec::new();

    let mut stages_of: HashMap<&str, HashMap<&str, (String, DealOutcome)>> = HashMap::new();
    for pipeline in &inventory.pipelines {
        let mut labels: Vec<String> = Vec::new();
        let mut by_id = HashMap::new();
        for stage in &pipeline.stages {
            // Stage labels name options, so a repeated label gets a suffix.
            let mut label = title(&stage.label);
            if label.is_empty() {
                label = format!("Stage {}", labels.len() + 1);
            }
            let mut unique = label.clone();
            let mut n = 2;
            while labels.contains(&unique) {
                unique = format!("{label} ({n})");
                n += 1;
            }
            by_id.insert(
                stage.id.as_str(),
                (
                    unique.clone(),
                    stage_outcome(stage.closed, stage.probability),
                ),
            );
            labels.push(unique);
        }
        stages_of.insert(pipeline.id.as_str(), by_id);
        rows.push(row(
            ImportKind::HubspotPipeline,
            key(portal, "pipeline", pipeline.id.as_str()),
            None,
            HubspotMeta {
                warnings: Vec::new(),
                title: title(&pipeline.label),
                url: None,
                plan: plan_item(NotionDecision::Copy, None),
                object: HubspotObject::Pipeline { stages: labels },
                losses: Vec::new(),
                summary: None,
            },
        )?);
    }

    let planned: HashSet<&RecordId> = inventory.companies.iter().map(|c| &c.id).collect();
    let mut domains: HashSet<String> = HashSet::new();
    for company in &inventory.companies {
        let mut losses = Vec::new();
        let raw = company
            .domain
            .as_deref()
            .or(company.website.as_deref().and_then(website_host));
        let domain = raw.and_then(|raw| crm.company_domain(raw));
        // Counted the way CRM matches domains: trimmed, without a trailing
        // dot, case-insensitively.
        if let Some(domain) = &domain
            && !domains.insert(domain.trim().trim_end_matches('.').to_ascii_lowercase())
        {
            losses.push(HubspotLoss::MergedCompany);
        }
        if raw.is_some() && domain.is_none() {
            losses.push(HubspotLoss::DomainRejected);
        }
        if !company.additional_domains.is_empty() {
            losses.push(HubspotLoss::AdditionalDomains);
        }
        if let Some(owner) = &company.owner {
            named_owners.insert(owner);
            losses.push(HubspotLoss::CompanyOwner);
        }
        let name = company
            .name
            .as_deref()
            .map(title)
            .filter(|name| !name.is_empty())
            .or_else(|| domain.clone())
            .unwrap_or_else(|| format!("Company {}", company.id));
        rows.push(row(
            ImportKind::HubspotCompany,
            record_key(portal, ObjectType::Company, &company.id),
            None,
            HubspotMeta {
                warnings: Vec::new(),
                title: name,
                url: Some(record_url(inventory, ObjectType::Company, &company.id)),
                plan: plan_item(NotionDecision::Copy, None),
                object: HubspotObject::Company { domain },
                losses,
                summary: None,
            },
        )?);
    }

    let mut primaries: HashSet<String> = HashSet::new();
    for contact in &inventory.contacts {
        let mut losses = Vec::new();
        let mut emails: Vec<String> = Vec::new();
        for email in contact.email.iter().chain(&contact.additional_emails) {
            let email = email.trim().to_lowercase();
            if email.contains('@') && !emails.contains(&email) {
                emails.push(email);
            }
        }
        if let Some(primary) = emails.first()
            && !primaries.insert(primary.clone())
        {
            losses.push(HubspotLoss::MergedContact);
        }
        let (company, extra) = company_of(&contact.companies, &planned);
        if extra {
            losses.push(HubspotLoss::ExtraCompanyLinks);
        }
        let company = company.map(|id| record_key(portal, ObjectType::Company, id));
        let full_name = [contact.first_name.as_deref(), contact.last_name.as_deref()]
            .into_iter()
            .flatten()
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        let name = Some(title(&full_name))
            .filter(|name| !name.is_empty())
            .or_else(|| emails.first().cloned())
            .unwrap_or_else(|| format!("Contact {}", contact.id));
        rows.push(row(
            ImportKind::HubspotContact,
            record_key(portal, ObjectType::Contact, &contact.id),
            company.clone(),
            HubspotMeta {
                warnings: Vec::new(),
                title: name,
                url: Some(record_url(inventory, ObjectType::Contact, &contact.id)),
                plan: plan_item(NotionDecision::Copy, None),
                object: HubspotObject::Contact { emails, company },
                losses,
                summary: None,
            },
        )?);
    }

    for deal in &inventory.deals {
        rows.push(deal_row(
            inventory,
            deal,
            &stages_of,
            &planned,
            crm,
            &member_of,
            &mut named_owners,
        )?);
    }

    let summary = PlanSummary {
        owners: u32::try_from(named_owners.len()).unwrap_or(u32::MAX),
        owners_matched: u32::try_from(
            named_owners
                .iter()
                .filter(|owner| member_of(owner).is_some())
                .count(),
        )
        .unwrap_or(u32::MAX),
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
    };
    if let Some(first) = rows.first_mut() {
        let mut meta: HubspotMeta = serde_json::from_value(first.metadata.clone())?;
        meta.summary = Some(summary);
        meta.warnings = inventory
            .warnings
            .iter()
            .cloned()
            .chain([NOT_IMPORTED.to_owned()])
            .collect();
        first.metadata = serde_json::to_value(meta)?;
    }
    Ok(rows)
}

fn deal_row<'a>(
    inventory: &'a Inventory,
    deal: &'a Deal,
    stages_of: &HashMap<&str, HashMap<&str, (String, DealOutcome)>>,
    planned: &HashSet<&RecordId>,
    crm: &dyn CrmImportWriter,
    member_of: &impl Fn(&RecordId) -> Option<String>,
    named_owners: &mut HashSet<&'a RecordId>,
) -> Result<PlanRow> {
    let portal = inventory.portal.id;
    let mut losses = Vec::new();
    let pipeline = deal
        .pipeline
        .as_ref()
        .filter(|id| stages_of.contains_key(id.as_str()));
    let (company, extra) = company_of(&deal.companies, planned);
    if extra {
        losses.push(HubspotLoss::ExtraCompanyLinks);
    }
    let owner = deal.owner.as_ref().and_then(|owner| {
        named_owners.insert(owner);
        let member = member_of(owner);
        if member.is_none() {
            losses.push(HubspotLoss::OwnerNotMember);
        }
        member
    });
    let (stage, outcome) = pipeline
        .and_then(|pipeline| {
            stages_of
                .get(pipeline.as_str())?
                .get(deal.stage.as_ref()?.as_str())
                .cloned()
        })
        .map_or((None, DealOutcome::Open), |(label, outcome)| {
            (Some(label), outcome)
        });
    let currency = deal
        .currency
        .clone()
        .or_else(|| inventory.portal.currency.clone())
        .map(|code| code.to_uppercase());
    let supported = currency
        .as_deref()
        .is_some_and(|code| crm.supports_currency(code));
    if deal.amount.is_some() && !supported {
        losses.push(HubspotLoss::UnsupportedCurrency);
    }
    let pipeline_key = pipeline.map(|id| key(portal, "pipeline", id.as_str()));
    let company_key = company.map(|id| record_key(portal, ObjectType::Company, id));
    let decision = match (&pipeline_key, &company_key) {
        (None, _) => {
            losses.push(HubspotLoss::DealWithoutPipeline);
            (
                NotionDecision::Skip,
                Some("Its pipeline is archived or missing."),
            )
        }
        (_, None) => {
            losses.push(HubspotLoss::DealWithoutCompany);
            (
                NotionDecision::Skip,
                Some("It has no company, and Macro pipelines track companies."),
            )
        }
        _ => (NotionDecision::Copy, None),
    };
    let name = deal
        .name
        .as_deref()
        .map(title)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| format!("Deal {}", deal.id));
    row(
        ImportKind::HubspotDeal,
        record_key(portal, ObjectType::Deal, &deal.id),
        pipeline_key.clone(),
        HubspotMeta {
            warnings: Vec::new(),
            title: name,
            url: Some(record_url(inventory, ObjectType::Deal, &deal.id)),
            plan: plan_item(decision.0, decision.1),
            object: HubspotObject::Deal(Box::new(DealPlan {
                pipeline: pipeline_key.unwrap_or_default(),
                company: company_key.unwrap_or_default(),
                stage,
                outcome,
                amount: deal.amount.filter(|_| supported),
                currency: currency.filter(|_| supported),
                close_date: deal.close_date.as_deref().and_then(date),
                owner,
            })),
            losses,
            summary: None,
        },
    )
}

/// Point rows a teammate already imported for the team at that copy.
pub(in crate::domain::service) fn link_existing(
    rows: &mut [PlanRow],
    copies: &[ImportEntity],
) -> Result<()> {
    for row in rows {
        let Some(copy) = copies.iter().find(|copy| {
            copy.foreign_id == row.foreign_id && copy.status == ImportStatus::Imported
        }) else {
            continue;
        };
        let (Some(entity_id), Some(entity_type)) = (&copy.entity_id, &copy.entity_type) else {
            continue;
        };
        let mut meta: HubspotMeta = serde_json::from_value(row.metadata.clone())?;
        meta.plan.already_imported = Some(NotionAlreadyImported {
            by: copy.user_id.clone(),
            entity_id: entity_id.clone(),
            entity_type: entity_type.clone(),
        });
        meta.plan.decision = Some(NotionDecision::Copy);
        row.metadata = serde_json::to_value(meta)?;
    }
    Ok(())
}
