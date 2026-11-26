//! Turn a source-neutral CRM inventory into decided plan rows: what each
//! object becomes in Macro CRM, what it links to, and what it loses. Each
//! source converts its own read into a [`CrmInventory`] first, computing
//! ledger keys, record URLs and source-specific losses there.

use std::collections::{HashMap, HashSet};

use models_databases::MAX_OPTION_LABEL_LEN;

use super::{CrmKinds, CrmMeta, CrmObject, DealPlan, PlanSummary};
use crate::domain::models::{
    CrmLoss, ImportEntity, ImportKind, ImportStatus, NotionAlreadyImported, NotionDecision,
    NotionPlanItem,
};
use crate::domain::ports::{CrmImportWriter, CrmTeam, DealOutcome, PlanRow, Result};

/// Longest title kept for a row: CRM display names are capped at 200 characters.
const TITLE_CHARS: usize = 200;

/// Everything a CRM import plans from, in no source's terms.
#[derive(Debug, Clone, Default, PartialEq)]
pub(in crate::domain::service) struct CrmInventory {
    /// Deal pipelines in display order.
    pub pipelines: Vec<CrmPipeline>,
    /// Companies.
    pub companies: Vec<CrmCompany>,
    /// Contacts.
    pub contacts: Vec<CrmContact>,
    /// Deals.
    pub deals: Vec<CrmDeal>,
    /// Each source owner's login email, by owner id.
    pub owners: HashMap<String, Option<String>>,
    /// The currency of deals that name none.
    pub default_currency: Option<String>,
    /// Source-defined properties or attributes, as `object.name`.
    pub custom_properties: Vec<String>,
    /// What the read skipped, with a reason; ids only.
    pub warnings: Vec<String>,
    /// Said once per plan: what this source's import never reads.
    pub not_imported: &'static str,
}

/// A deal pipeline.
#[derive(Debug, Clone, PartialEq)]
pub(in crate::domain::service) struct CrmPipeline {
    /// Ledger key.
    pub key: String,
    /// Display label.
    pub label: String,
    /// Live stages in display order.
    pub stages: Vec<CrmStage>,
}

/// One stage of a pipeline.
#[derive(Debug, Clone, PartialEq)]
pub(in crate::domain::service) struct CrmStage {
    /// The source's stage id, as deals name it.
    pub id: String,
    /// Display label.
    pub label: String,
    /// What reaching it means for a deal.
    pub outcome: DealOutcome,
}

/// A link from a contact or deal to a company.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::domain::service) struct CrmCompanyLink {
    /// The company's ledger key.
    pub company: String,
    /// The source's primary link (one per record at most).
    pub primary: bool,
}

/// A company.
#[derive(Debug, Clone, PartialEq)]
pub(in crate::domain::service) struct CrmCompany {
    /// Ledger key.
    pub key: String,
    /// Title when it has neither name nor domain (`Company 123`).
    pub fallback: String,
    /// Its page in the source.
    pub url: Option<String>,
    /// Name.
    pub name: Option<String>,
    /// The domain to key it by, before CRM's rules.
    pub domain: Option<String>,
    /// Its owner in the source.
    pub owner: Option<String>,
    /// What the source conversion already found lost.
    pub losses: Vec<CrmLoss>,
}

/// A contact.
#[derive(Debug, Clone, PartialEq)]
pub(in crate::domain::service) struct CrmContact {
    /// Ledger key.
    pub key: String,
    /// Title when it has neither name nor address.
    pub fallback: String,
    /// Its page in the source.
    pub url: Option<String>,
    /// Full name.
    pub name: Option<String>,
    /// Addresses, primary first, as the source writes them.
    pub emails: Vec<String>,
    /// Companies it is linked to.
    pub companies: Vec<CrmCompanyLink>,
}

/// A deal.
#[derive(Debug, Clone, PartialEq)]
pub(in crate::domain::service) struct CrmDeal {
    /// Ledger key.
    pub key: String,
    /// Title when it has no name.
    pub fallback: String,
    /// Its page in the source.
    pub url: Option<String>,
    /// Name.
    pub name: Option<String>,
    /// Its pipeline's ledger key.
    pub pipeline: Option<String>,
    /// Its stage's id in that pipeline.
    pub stage: Option<String>,
    /// How it closed, when the source records that apart from its stage;
    /// otherwise its stage decides.
    pub outcome: Option<DealOutcome>,
    /// Amount.
    pub amount: Option<f64>,
    /// ISO 4217 code.
    pub currency: Option<String>,
    /// Expected or actual close, as the source sends it (ISO 8601).
    pub close_date: Option<String>,
    /// Companies it is linked to.
    pub companies: Vec<CrmCompanyLink>,
    /// Its owner in the source.
    pub owner: Option<String>,
    /// What the source conversion already found lost.
    pub losses: Vec<CrmLoss>,
}

/// The host of a website URL, as a domain candidate.
pub(in crate::domain::service) fn website_host(website: &str) -> Option<&str> {
    let rest = website.split_once("://").map_or(website, |(_, rest)| rest);
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit_once('@').map_or(host, |(_, host)| host);
    let host = host.split(':').next()?;
    let host = host.strip_prefix("www.").unwrap_or(host);
    (!host.is_empty()).then_some(host)
}

fn title(value: &str) -> String {
    value.trim().chars().take(TITLE_CHARS).collect()
}

/// `label` followed by `suffix`, shortened to fit a select option.
fn fit(label: &str, suffix: &str) -> String {
    let room = MAX_OPTION_LABEL_LEN - suffix.chars().count();
    let base: String = label.chars().take(room).collect();
    format!("{}{suffix}", base.trim_end())
}

/// The company a contact or deal is filed under: its primary, else its first
/// link, among companies the plan holds; and whether it linked to others,
/// counting companies outside the plan, whose link is lost too.
fn company_of<'a>(links: &'a [CrmCompanyLink], planned: &HashSet<&str>) -> (Option<&'a str>, bool) {
    let known: Vec<&CrmCompanyLink> = links
        .iter()
        .filter(|link| planned.contains(link.company.as_str()))
        .collect();
    let chosen = known
        .iter()
        .find(|link| link.primary)
        .or(known.first())
        .map(|link| link.company.as_str());
    let linked: HashSet<&str> = links.iter().map(|link| link.company.as_str()).collect();
    (chosen, linked.len() > 1)
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
        dependency_of: Vec::new(),
        inline_on: Vec::new(),
    }
}

fn row(
    kind: ImportKind,
    foreign_id: String,
    parent: Option<String>,
    meta: CrmMeta,
) -> Result<PlanRow> {
    Ok(PlanRow {
        kind,
        foreign_id,
        parent_foreign_id: parent,
        metadata: serde_json::to_value(meta)?,
    })
}

/// `YYYY-MM-DD` from an ISO timestamp.
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
    inventory: &CrmInventory,
    kinds: CrmKinds,
    team: &CrmTeam,
    crm: &dyn CrmImportWriter,
) -> Result<Vec<PlanRow>> {
    let members: HashMap<&str, &str> = team
        .members
        .iter()
        .map(|member| (member.email.as_str(), member.user_id.as_str()))
        .collect();
    let member_of = |owner: &str| -> Option<String> {
        inventory
            .owners
            .get(owner)
            .cloned()
            .flatten()
            .map(|email| email.to_lowercase())
            .and_then(|email| members.get(email.as_str()).map(|id| (*id).to_owned()))
    };
    let mut named_owners: HashSet<&str> = HashSet::new();
    let mut rows = Vec::new();

    let mut stages_of: HashMap<&str, HashMap<&str, (String, DealOutcome)>> = HashMap::new();
    for pipeline in &inventory.pipelines {
        let mut labels: Vec<String> = Vec::new();
        let mut by_id = HashMap::new();
        for stage in &pipeline.stages {
            // Stage labels name options, which differ without case and hold
            // at most MAX_OPTION_LABEL_LEN characters: a repeated label gets
            // a suffix, and the label is shortened to keep it within the limit.
            let mut label = title(&stage.label);
            if label.is_empty() {
                label = format!("Stage {}", labels.len() + 1);
            }
            let mut unique = fit(&label, "");
            let mut n = 2;
            while labels
                .iter()
                .any(|taken| taken.to_lowercase() == unique.to_lowercase())
            {
                unique = fit(&label, &format!(" ({n})"));
                n += 1;
            }
            by_id.insert(stage.id.as_str(), (unique.clone(), stage.outcome));
            labels.push(unique);
        }
        stages_of.insert(pipeline.key.as_str(), by_id);
        rows.push(row(
            kinds.pipeline,
            pipeline.key.clone(),
            None,
            CrmMeta {
                warnings: Vec::new(),
                title: title(&pipeline.label),
                url: None,
                plan: plan_item(NotionDecision::Copy, None),
                object: CrmObject::Pipeline { stages: labels },
                losses: Vec::new(),
                summary: None,
            },
        )?);
    }

    let planned: HashSet<&str> = inventory
        .companies
        .iter()
        .map(|company| company.key.as_str())
        .collect();
    let mut domains: HashSet<String> = HashSet::new();
    for company in &inventory.companies {
        let mut losses = Vec::new();
        let raw = company.domain.as_deref();
        let domain = raw.and_then(|raw| crm.company_domain(raw));
        // Counted the way CRM matches domains: trimmed, without a trailing
        // dot, case-insensitively.
        if let Some(domain) = &domain
            && !domains.insert(domain.trim().trim_end_matches('.').to_ascii_lowercase())
        {
            losses.push(CrmLoss::MergedCompany);
        }
        if raw.is_some() && domain.is_none() {
            losses.push(CrmLoss::DomainRejected);
        }
        losses.extend(company.losses.iter().copied());
        if let Some(owner) = &company.owner {
            named_owners.insert(owner);
            losses.push(CrmLoss::CompanyOwner);
        }
        let name = company
            .name
            .as_deref()
            .map(title)
            .filter(|name| !name.is_empty())
            .or_else(|| domain.clone())
            .unwrap_or_else(|| company.fallback.clone());
        rows.push(row(
            kinds.company,
            company.key.clone(),
            None,
            CrmMeta {
                warnings: Vec::new(),
                title: name,
                url: company.url.clone(),
                plan: plan_item(NotionDecision::Copy, None),
                object: CrmObject::Company { domain },
                losses,
                summary: None,
            },
        )?);
    }

    let mut primaries: HashSet<String> = HashSet::new();
    for contact in &inventory.contacts {
        let mut losses = Vec::new();
        let mut emails: Vec<String> = Vec::new();
        for email in &contact.emails {
            let email = email.trim().to_lowercase();
            if email.contains('@') && !emails.contains(&email) {
                emails.push(email);
            }
        }
        if let Some(primary) = emails.first()
            && !primaries.insert(primary.clone())
        {
            losses.push(CrmLoss::MergedContact);
        }
        let (company, extra) = company_of(&contact.companies, &planned);
        if extra {
            losses.push(CrmLoss::ExtraCompanyLinks);
        }
        let company = company.map(str::to_owned);
        let name = contact
            .name
            .as_deref()
            .map(title)
            .filter(|name| !name.is_empty())
            .or_else(|| emails.first().cloned())
            .unwrap_or_else(|| contact.fallback.clone());
        rows.push(row(
            kinds.contact,
            contact.key.clone(),
            company.clone(),
            CrmMeta {
                warnings: Vec::new(),
                title: name,
                url: contact.url.clone(),
                plan: plan_item(NotionDecision::Copy, None),
                object: CrmObject::Contact { emails, company },
                losses,
                summary: None,
            },
        )?);
    }

    for deal in &inventory.deals {
        rows.push(deal_row(
            inventory,
            kinds,
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
        custom_properties: inventory.custom_properties.clone(),
    };
    if let Some(first) = rows.first_mut() {
        let mut meta: CrmMeta = serde_json::from_value(first.metadata.clone())?;
        meta.summary = Some(summary);
        meta.warnings = inventory
            .warnings
            .iter()
            .cloned()
            .chain([inventory.not_imported.to_owned()])
            .collect();
        first.metadata = serde_json::to_value(meta)?;
    }
    Ok(rows)
}

#[expect(
    clippy::too_many_arguments,
    reason = "the plan's shared indexes, passed by reference"
)]
fn deal_row<'a>(
    inventory: &'a CrmInventory,
    kinds: CrmKinds,
    deal: &'a CrmDeal,
    stages_of: &HashMap<&str, HashMap<&str, (String, DealOutcome)>>,
    planned: &HashSet<&str>,
    crm: &dyn CrmImportWriter,
    member_of: &impl Fn(&str) -> Option<String>,
    named_owners: &mut HashSet<&'a str>,
) -> Result<PlanRow> {
    let mut losses = Vec::new();
    let pipeline = deal
        .pipeline
        .as_deref()
        .filter(|key| stages_of.contains_key(key));
    let (company, extra) = company_of(&deal.companies, planned);
    if extra {
        losses.push(CrmLoss::ExtraCompanyLinks);
    }
    let owner = deal.owner.as_deref().and_then(|owner| {
        named_owners.insert(owner);
        let member = member_of(owner);
        if member.is_none() {
            losses.push(CrmLoss::OwnerNotMember);
        }
        member
    });
    let (stage, outcome) = pipeline
        .and_then(|pipeline| {
            stages_of
                .get(pipeline)?
                .get(deal.stage.as_deref()?)
                .cloned()
        })
        .map_or((None, DealOutcome::Open), |(label, outcome)| {
            (Some(label), outcome)
        });
    let outcome = deal.outcome.unwrap_or(outcome);
    let currency = deal
        .currency
        .clone()
        .or_else(|| inventory.default_currency.clone())
        .map(|code| code.to_uppercase());
    let supported = currency
        .as_deref()
        .is_some_and(|code| crm.supports_currency(code));
    if deal.amount.is_some() && !supported {
        losses.push(CrmLoss::UnsupportedCurrency);
    }
    let pipeline_key = pipeline.map(str::to_owned);
    let company_key = company.map(str::to_owned);
    let decision = match (&pipeline_key, &company_key) {
        (None, _) => {
            losses.push(CrmLoss::DealWithoutPipeline);
            (
                NotionDecision::Skip,
                Some("Its pipeline is archived or missing."),
            )
        }
        (_, None) => {
            losses.push(CrmLoss::DealWithoutCompany);
            (
                NotionDecision::Skip,
                Some("It has no company, and Macro pipelines track companies."),
            )
        }
        _ => (NotionDecision::Copy, None),
    };
    losses.extend(deal.losses.iter().copied());
    let name = deal
        .name
        .as_deref()
        .map(title)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| deal.fallback.clone());
    row(
        kinds.deal,
        deal.key.clone(),
        pipeline_key.clone(),
        CrmMeta {
            warnings: Vec::new(),
            title: name,
            url: deal.url.clone(),
            plan: plan_item(decision.0, decision.1),
            object: CrmObject::Deal(Box::new(DealPlan {
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
    // Indexed once, keeping the first imported copy of each object.
    let mut imported: HashMap<&str, &ImportEntity> = HashMap::new();
    for copy in copies {
        if copy.status == ImportStatus::Imported {
            imported.entry(copy.foreign_id.as_str()).or_insert(copy);
        }
    }
    for row in rows {
        let Some(copy) = imported.get(row.foreign_id.as_str()) else {
            continue;
        };
        let (Some(entity_id), Some(entity_type)) = (&copy.entity_id, &copy.entity_type) else {
            continue;
        };
        let mut meta: CrmMeta = serde_json::from_value(row.metadata.clone())?;
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
