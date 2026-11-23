//! HubSpot CRM planning and writes. Deterministic: there is no decision
//! model; every object Macro CRM can hold is copied, and what it cannot hold
//! is counted as a loss. The shared workspace engine owns jobs, leases,
//! approval, cancellation, adoption and session notifications.

use std::collections::HashMap;

use connectors::McpConnectionsService;
use import_notion::domain::ports::NotionConnections;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use strum::IntoEnumIterator;
use tracing::Instrument;
use uuid::Uuid;

use super::ImportServiceImpl;
use super::tracker_workspace::claim;
use super::workspace::run::JobControl;
use crate::domain::models::{
    HubspotLoss, HubspotLossCount, HubspotReport, ImportEntity, ImportKind, ImportStatus,
    NotionPlanItem, ScanCounts, TeamClaim, WrittenKind, WrittenObject,
};
use crate::domain::ports::{
    CanonicalImportRepo, CrmImportWriter, DealOutcome, EntityCreator, ImportError, ImportRepo,
    NewCrmContact, NewDealEntry, NotionPlanRepo, NotionRunRepo, Result, SlackWorkspaceSource,
    WorkspaceWriter, WrittenObjects,
};

pub(in crate::domain::service) mod plan;

#[cfg(test)]
mod test;

/// What one planned HubSpot object becomes. Writing never reads HubSpot
/// again, so the approved review is exactly what is written.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub(in crate::domain::service) enum HubspotObject {
    /// A deal pipeline: a company-tracking Sales pipeline with these stages.
    Pipeline {
        /// Stage labels in order.
        stages: Vec<String>,
    },
    /// A company, keyed by its domain when CRM accepts one.
    Company {
        /// The CRM domain.
        domain: Option<String>,
    },
    /// A contact.
    Contact {
        /// Addresses, primary first, lowercased.
        emails: Vec<String>,
        /// The plan key of its company.
        company: Option<String>,
    },
    /// A deal, an entry of its pipeline.
    Deal(Box<DealPlan>),
}

/// A deal's entry, as planned.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::domain::service) struct DealPlan {
    /// The plan key of its pipeline.
    pub pipeline: String,
    /// The plan key of the company it tracks.
    pub company: String,
    /// Stage label.
    pub stage: Option<String>,
    /// Outcome from the stage.
    pub outcome: DealOutcome,
    /// Amount, when its currency is supported.
    pub amount: Option<f64>,
    /// Currency code.
    pub currency: Option<String>,
    /// `YYYY-MM-DD`.
    pub close_date: Option<String>,
    /// The owning team member's Macro user id.
    pub owner: Option<String>,
}

/// Facts about the whole plan, kept on its first row.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::domain::service) struct PlanSummary {
    /// HubSpot owners named by planned records.
    pub owners: u32,
    /// Of those, matched to a team member.
    pub owners_matched: u32,
    /// Portal-defined properties, as `object.name`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_properties: Vec<String>,
}

/// A HubSpot ledger row's metadata. `title`, `url`, `plan` and `warnings`
/// are the shared report's fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::domain::service) struct HubspotMeta {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    pub title: String,
    pub url: Option<String>,
    pub plan: NotionPlanItem,
    pub object: HubspotObject,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub losses: Vec<HubspotLoss>,
    /// Named apart from the shared report's text `summary`.
    #[serde(
        default,
        rename = "hubspotSummary",
        skip_serializing_if = "Option::is_none"
    )]
    pub summary: Option<PlanSummary>,
}

/// What a write links objects to, kept across its phases.
struct Known {
    /// Earlier phases' records and earlier imports', by plan key.
    targets: HashMap<String, Uuid>,
    /// Records a stopped write made, by ledger row.
    earlier: HashMap<Uuid, Uuid>,
    /// Each company's entries per pipeline, by deal link, read once per write.
    deal_entries: HashMap<(Uuid, Uuid), HashMap<String, Uuid>>,
    /// Plan keys of objects the owner left out of this review.
    left_out: std::collections::HashSet<String>,
}

/// Kinds in write order: what a later kind links to is written first.
const WRITE_ORDER: [ImportKind; 4] = [
    ImportKind::HubspotPipeline,
    ImportKind::HubspotCompany,
    ImportKind::HubspotContact,
    ImportKind::HubspotDeal,
];

/// The Macro entity type each kind becomes, as the ledger records it.
fn entity_type(kind: ImportKind) -> &'static str {
    match kind {
        ImportKind::HubspotPipeline => "crm_pipeline",
        ImportKind::HubspotContact => "crm_contact",
        ImportKind::HubspotDeal => "database_row",
        _ => "crm_company",
    }
}

const NOT_AVAILABLE: ImportError = ImportError::NotReady("HubSpot imports are not available here.");

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: McpConnectionsService,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    /// Refuse before a run starts when the user may not write the team's CRM.
    pub(super) async fn check_crm_access(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        let hubspot = self.hubspot.as_ref().ok_or(NOT_AVAILABLE)?;
        hubspot
            .writer
            .crm_team(user)
            .await?
            .ok_or(ImportError::CrmAccessRequired)?;
        Ok(())
    }

    #[tracing::instrument(name = "import.hubspot.plan", skip_all, fields(portal, rows), err)]
    pub(super) async fn plan_hubspot(
        &self,
        user: &MacroUserIdStr<'static>,
        control: &JobControl,
    ) -> Result<()> {
        let hubspot = self.hubspot.clone().ok_or(NOT_AVAILABLE)?;
        let team = hubspot
            .writer
            .crm_team(user)
            .await?
            .ok_or(ImportError::CrmAccessRequired)?;
        let (counts, scanned) = tokio::sync::watch::channel(ScanCounts::default());
        let walk = async {
            let found = hubspot
                .reader
                .inventory(user, &|read| {
                    let records = read.companies + read.contacts + read.deals;
                    counts.send_replace(ScanCounts {
                        pages: u32::try_from(records).unwrap_or(u32::MAX),
                        data_sources: 0,
                    });
                })
                .await;
            drop(counts);
            found
        };
        let (found, ()) = tokio::join!(
            walk,
            super::workspace::scan::record_scan(&self.repo, user, scanned, self.workspace_source)
        );
        let found = found?;
        if control.reason().is_some() {
            return Ok(());
        }
        let mut rows = plan::rows(&found, &team, hubspot.writer.as_ref())?;
        let span = tracing::Span::current();
        span.record("portal", found.portal.id);
        span.record("rows", rows.len());
        let copies = super::lifecycle::team_copies(
            &self.repo,
            self.creator.as_ref(),
            user,
            &rows
                .iter()
                .map(|row| row.foreign_id.clone())
                .collect::<Vec<_>>(),
        )
        .instrument(tracing::info_span!("import.hubspot.plan.team_copies"))
        .await?;
        plan::link_existing(&mut rows, &copies)?;
        super::lifecycle::replace_plan(
            &self.repo,
            self.creator.as_ref(),
            user,
            self.workspace_source,
            &rows,
        )
        .instrument(tracing::info_span!("import.hubspot.plan.stage"))
        .await?;
        self.notify(user).await;
        Ok(())
    }

    #[tracing::instrument(name = "import.hubspot.write", skip_all, fields(%review, written, failed), err)]
    pub(super) async fn write_hubspot(
        &self,
        user: &MacroUserIdStr<'static>,
        review: Uuid,
        control: &JobControl,
    ) -> Result<usize> {
        let hubspot = self.hubspot.clone().ok_or(NOT_AVAILABLE)?;
        let team = self.repo.user_team_id(user).await?;
        // One read of the ledger serves every phase: each phase adds the
        // records it writes, so later phases link to them.
        let rows = self
            .repo
            .list(user, Some(self.workspace_source), None)
            .await?;
        let todo: Vec<&ImportEntity> = rows
            .iter()
            .filter(|row| {
                row.user_id == user.as_ref()
                    && row.review_id == Some(review)
                    && row.status == ImportStatus::Importing
                    && row.waiting_on.is_none()
            })
            .collect();
        // Records a stopped write already made, read once for the whole write.
        let ids: Vec<Uuid> = todo.iter().map(|row| row.id).collect();
        let earlier = self
            .repo
            .written(user, &ids)
            .await?
            .into_iter()
            .filter(|object| object.kind == WrittenKind::CrmRecord)
            .map(|object| (object.import_id, object.macro_id))
            .collect();
        let mut known = Known {
            // Records earlier imports made.
            targets: rows
                .iter()
                .filter(|row| row.user_id == user.as_ref() && row.status == ImportStatus::Imported)
                .filter_map(|row| {
                    Some((
                        row.foreign_id.clone(),
                        row.entity_id.as_deref()?.parse().ok()?,
                    ))
                })
                .collect(),
            earlier,
            deal_entries: HashMap::new(),
            left_out: rows
                .iter()
                .filter(|row| {
                    row.user_id == user.as_ref()
                        && row.review_id == Some(review)
                        && row.status == ImportStatus::Discarded
                })
                .map(|row| row.foreign_id.clone())
                .collect(),
        };
        let mut failed = 0;
        let mut written = 0;
        for kind in WRITE_ORDER {
            let span = tracing::info_span!(
                "import.hubspot.write.phase",
                kind = kind.as_ref(),
                objects = tracing::field::Empty,
                written = tracing::field::Empty,
                failed = tracing::field::Empty
            );
            let phase = async {
                let objects: Vec<&ImportEntity> = todo
                    .iter()
                    .copied()
                    .filter(|row| row.kind == kind)
                    .collect();
                tracing::Span::current().record("objects", objects.len());
                let mut phase_failed = 0;
                let mut phase_written = 0;
                for row in objects {
                    if control.reason().is_some() {
                        return Ok::<_, ImportError>(phase_failed);
                    }
                    let result = self
                        .write_hubspot_object(
                            user,
                            row,
                            team,
                            &mut known,
                            hubspot.writer.as_ref(),
                            control,
                        )
                        .await;
                    match result {
                        Ok(Some(id)) => {
                            written += 1;
                            phase_written += 1;
                            known.targets.insert(row.foreign_id.clone(), id);
                        }
                        Ok(None) => {}
                        Err(error) => {
                            phase_failed += 1;
                            self.repo
                                .mark_import_failed(user, row.id, &error.to_string())
                                .await?;
                        }
                    }
                    self.notify(user).await;
                }
                tracing::Span::current().record("failed", phase_failed);
                tracing::Span::current().record("written", phase_written);
                Ok(phase_failed)
            };
            failed += phase.instrument(span).await?;
            if control.reason().is_some() {
                break;
            }
        }
        let span = tracing::Span::current();
        span.record("written", written);
        span.record("failed", failed);
        Ok(failed)
    }

    async fn write_hubspot_object(
        &self,
        user: &MacroUserIdStr<'static>,
        row: &ImportEntity,
        team: Option<Uuid>,
        known: &mut Known,
        writer: &dyn CrmImportWriter,
        control: &JobControl,
    ) -> Result<Option<Uuid>> {
        let meta: HubspotMeta = serde_json::from_value(row.metadata.clone())?;
        let team = team.ok_or(ImportError::CrmAccessRequired)?;
        let resolved = claim::resolve(
            || async {
                if control.reason().is_some() {
                    return Err(ImportError::NotReady("The import stopped."));
                }
                super::lifecycle::claim_team_object(
                    &self.repo,
                    self.creator.as_ref(),
                    user,
                    row.id,
                    team,
                    true,
                )
                .await
            },
            |holder| self.repo.wait_on(user, row.id, holder),
        )
        .await?;
        match resolved {
            TeamClaim::Linked {
                entity_id,
                entity_type,
            } => {
                self.repo
                    .mark_imported(user, row.id, &entity_id, &entity_type, None)
                    .await?;
                return Ok(entity_id.parse().ok());
            }
            TeamClaim::Waiting { .. } => return Ok(None),
            TeamClaim::Held | TeamClaim::Free => {}
        }
        // A record created before a crash is reused, never created again.
        let id = match known.earlier.get(&row.id).copied() {
            Some(id) => id,
            None => {
                let (id, created) = self
                    .find_or_create(user, &meta, &link(row, &meta), known, writer)
                    .await?;
                if created {
                    self.repo
                        .record_written(
                            user,
                            &[WrittenObject::own(row.id, WrittenKind::CrmRecord, id)],
                        )
                        .await?;
                }
                id
            }
        };
        self.repo
            .mark_imported(
                user,
                row.id,
                &id.to_string(),
                entity_type(row.kind),
                Some(team),
            )
            .await?;
        Ok(Some(id))
    }

    /// The CRM record for one object: an existing one by its natural key
    /// (domain, any address, the deal's link), or a new one. `true` when it
    /// was created.
    async fn find_or_create(
        &self,
        user: &MacroUserIdStr<'static>,
        meta: &HubspotMeta,
        link: &str,
        known: &mut Known,
        writer: &dyn CrmImportWriter,
    ) -> Result<(Uuid, bool)> {
        let Known {
            targets,
            left_out,
            deal_entries,
            ..
        } = known;
        match &meta.object {
            HubspotObject::Pipeline { stages } => Ok((
                writer
                    .create_deal_pipeline(user, &meta.title, stages)
                    .await?,
                true,
            )),
            HubspotObject::Company { domain } => {
                if let Some(domain) = domain
                    && let Some(existing) = writer.company_by_domain(user, domain).await?
                {
                    return Ok((existing, false));
                }
                Ok((
                    writer
                        .create_company(user, &meta.title, domain.as_deref())
                        .await?,
                    true,
                ))
            }
            HubspotObject::Contact { emails, company } => {
                // Only the primary address identifies a contact: a further
                // address another contact holds must not merge the two.
                if let Some(primary) = emails.first()
                    && let Some(existing) = writer.contact_by_email(user, primary).await?
                {
                    return Ok((existing, false));
                }
                let company = match company.as_deref() {
                    None => None,
                    // The owner left the company out: the contact stays
                    // without one, and the report counts it.
                    Some(key) if left_out.contains(key) => None,
                    Some(key) => Some(targets.get(key).copied().ok_or(ImportError::NotReady(
                        "Its company has not been imported. Plan again to retry this contact.",
                    ))?),
                };
                let contact = NewCrmContact {
                    name: meta.title.clone(),
                    emails: emails.clone(),
                    company,
                };
                Ok((writer.create_contact(user, &contact).await?, true))
            }
            HubspotObject::Deal(deal) => {
                let pipeline =
                    targets
                        .get(deal.pipeline.as_str())
                        .copied()
                        .ok_or(ImportError::NotReady(
                            "Its pipeline has not been imported. Plan again to retry this deal.",
                        ))?;
                if left_out.contains(deal.company.as_str()) {
                    return Err(ImportError::NotReady(
                        "Its company was left out of the import, and a pipeline entry tracks a company.",
                    ));
                }
                let company =
                    targets
                        .get(deal.company.as_str())
                        .copied()
                        .ok_or(ImportError::NotReady(
                            "Its company has not been imported. Plan again to retry this deal.",
                        ))?;
                let entries = match deal_entries.entry((pipeline, company)) {
                    std::collections::hash_map::Entry::Occupied(known) => known.into_mut(),
                    std::collections::hash_map::Entry::Vacant(slot) => {
                        slot.insert(writer.deal_entries(user, pipeline, company).await?)
                    }
                };
                if let Some(existing) = entries.get(link) {
                    return Ok((*existing, false));
                }
                let entry = NewDealEntry {
                    company,
                    name: meta.title.clone(),
                    stage: deal.stage.clone(),
                    outcome: deal.outcome,
                    amount: deal.amount,
                    currency: deal.currency.clone(),
                    close_date: deal.close_date.clone(),
                    owner: deal.owner.clone(),
                    link: link.to_owned(),
                };
                let added = writer.add_deal_entry(user, pipeline, &entry).await?;
                entries.insert(link.to_owned(), added);
                Ok((added, true))
            }
        }
    }
}

/// The object's HubSpot URL, which a deal entry carries as its identity.
fn link(row: &ImportEntity, meta: &HubspotMeta) -> String {
    meta.url.clone().unwrap_or_else(|| row.foreign_id.clone())
}

/// The review card's HubSpot section, from the current plan's rows.
pub(in crate::domain::service) fn report<'a>(
    review: Option<Uuid>,
    rows: impl IntoIterator<Item = &'a ImportEntity>,
) -> Option<HubspotReport> {
    let mut report = HubspotReport::default();
    let mut losses: HashMap<HubspotLoss, u32> = HashMap::new();
    let mut any = false;
    let rows: Vec<&ImportEntity> = rows.into_iter().collect();
    // Companies the owner left out: their contacts are written without them.
    let left_out: std::collections::HashSet<&str> = rows
        .iter()
        .filter(|row| {
            row.kind == ImportKind::HubspotCompany
                && row.status == ImportStatus::Discarded
                && review.is_some()
                && row.review_id == review
        })
        .map(|row| row.foreign_id.as_str())
        .collect();
    for row in rows {
        let Ok(meta) = serde_json::from_value::<HubspotMeta>(row.metadata.clone()) else {
            continue;
        };
        any = true;
        match row.kind {
            ImportKind::HubspotPipeline => report.pipelines += 1,
            ImportKind::HubspotCompany => report.companies += 1,
            ImportKind::HubspotContact => report.contacts += 1,
            ImportKind::HubspotDeal => report.deals += 1,
            _ => {}
        }
        if row.status == ImportStatus::Imported && meta.plan.already_imported.is_some() {
            report.already_imported += 1;
        }
        for loss in meta.losses {
            *losses.entry(loss).or_default() += 1;
        }
        if let HubspotObject::Contact {
            company: Some(company),
            ..
        } = &meta.object
            && left_out.contains(company.as_str())
            && row.status != ImportStatus::Discarded
        {
            *losses
                .entry(HubspotLoss::ContactWithoutCompany)
                .or_default() += 1;
        }
        if let Some(summary) = meta.summary {
            report.owners = summary.owners;
            report.owners_matched = summary.owners_matched;
            report.custom_properties = summary.custom_properties;
        }
    }
    report.losses = HubspotLoss::iter()
        .filter_map(|loss| {
            Some(HubspotLossCount {
                loss,
                count: *losses.get(&loss)?,
            })
        })
        .collect();
    any.then_some(report)
}
