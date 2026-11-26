//! CRM planning and writes, shared by the HubSpot and Attio importers. Each
//! source reads its own inventory and converts it into a [`plan::CrmInventory`];
//! from there planning and writing are the same. Deterministic: there is no
//! decision model; every object Macro CRM can hold is copied, and what it
//! cannot hold is counted as a loss. The shared workspace engine owns jobs,
//! leases, approval, cancellation, adoption and session notifications.

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
    CrmLoss, CrmLossCount, CrmReport, ImportEntity, ImportKind, ImportSource, ImportStatus,
    NotionPlanItem, ScanCounts, TeamClaim, WrittenKind, WrittenObject,
};
use crate::domain::ports::{
    CanonicalImportRepo, CrmImportWriter, DealOutcome, EntityCreator, ImportError, ImportRepo,
    NewCrmContact, NewDealEntry, NotionPlanRepo, NotionRunRepo, Result, SlackWorkspaceSource,
    WorkspaceWriter, WrittenObjects,
};

pub(in crate::domain::service) mod plan;

/// The ledger kinds one CRM source stages, by role.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::domain::service) struct CrmKinds {
    pub source: ImportSource,
    pub pipeline: ImportKind,
    pub company: ImportKind,
    pub contact: ImportKind,
    pub deal: ImportKind,
}

impl CrmKinds {
    pub(in crate::domain::service) const HUBSPOT: Self = Self {
        source: ImportSource::Hubspot,
        pipeline: ImportKind::HubspotPipeline,
        company: ImportKind::HubspotCompany,
        contact: ImportKind::HubspotContact,
        deal: ImportKind::HubspotDeal,
    };

    pub(in crate::domain::service) const ATTIO: Self = Self {
        source: ImportSource::Attio,
        pipeline: ImportKind::AttioPipeline,
        company: ImportKind::AttioCompany,
        contact: ImportKind::AttioPerson,
        deal: ImportKind::AttioDeal,
    };

    /// Kinds in write order: what a later kind links to is written first.
    fn write_order(self) -> [ImportKind; 4] {
        [self.pipeline, self.company, self.contact, self.deal]
    }

    /// The Macro entity type each kind becomes, as the ledger records it.
    fn entity_type(self, kind: ImportKind) -> &'static str {
        if kind == self.pipeline {
            "crm_pipeline"
        } else if kind == self.contact {
            "crm_contact"
        } else if kind == self.deal {
            "database_row"
        } else {
            "crm_company"
        }
    }
}

/// What one planned CRM object becomes. Writing never reads the source
/// again, so the approved review is exactly what is written.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub(in crate::domain::service) enum CrmObject {
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
    /// Source owners named by planned records.
    pub owners: u32,
    /// Of those, matched to a team member.
    pub owners_matched: u32,
    /// Source-defined properties or attributes, as `object.name`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom_properties: Vec<String>,
}

/// A CRM ledger row's metadata. `title`, `url`, `plan` and `warnings` are
/// the shared report's fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::domain::service) struct CrmMeta {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    pub title: String,
    pub url: Option<String>,
    pub plan: NotionPlanItem,
    pub object: CrmObject,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub losses: Vec<CrmLoss>,
    /// Named apart from the shared report's text `summary`. Its stored name
    /// predates Attio and stays.
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
    /// Each company's entries per pipeline, by the path of their deal link,
    /// read once per write.
    deal_entries: HashMap<(Uuid, Uuid), HashMap<String, Uuid>>,
    /// Plan keys of objects the owner left out of this review.
    left_out: std::collections::HashSet<String>,
}

/// The CRM writer, for hosts that wired one.
const NOT_AVAILABLE: ImportError = ImportError::NotReady("CRM imports are not available here.");

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: McpConnectionsService,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    /// The CRM writer every CRM source writes through.
    fn crm_writer(&self) -> Result<std::sync::Arc<dyn CrmImportWriter>> {
        self.crm_writer.clone().ok_or(NOT_AVAILABLE)
    }

    /// Refuse before a run starts when the user may not write the team's CRM
    /// or has not connected this source, so neither leaves a failed import.
    pub(super) async fn check_crm_access(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        self.check_rolled_out(user).await?;
        self.crm_writer()?
            .crm_team(user)
            .await?
            .ok_or(ImportError::CrmAccessRequired)?;
        match self.workspace_source {
            ImportSource::Hubspot => self.check_hubspot_connected(user).await,
            ImportSource::Attio => self.check_attio_connected(user).await,
            ImportSource::Linear
            | ImportSource::Jira
            | ImportSource::Notion
            | ImportSource::Slack => Err(NOT_AVAILABLE),
        }
    }

    /// Refuse a source whose import is not rolled out to the user. Checked
    /// before a run starts and again before planning reads the source, so a
    /// run adopted after its flag went off reads nothing.
    async fn check_rolled_out(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        if self.rollout.enabled_for(user, self.workspace_source).await {
            Ok(())
        } else {
            Err(ImportError::NotRolledOut(self.workspace_source))
        }
    }

    /// Plan a CRM import from what `read` returns: it reads the source
    /// through `progress` and converts it into a CRM inventory.
    pub(super) async fn plan_crm<Read>(
        &self,
        user: &MacroUserIdStr<'static>,
        control: &JobControl,
        kinds: CrmKinds,
        read: impl FnOnce(tokio::sync::watch::Sender<ScanCounts>) -> Read,
    ) -> Result<()>
    where
        Read: Future<Output = Result<plan::CrmInventory>>,
    {
        self.check_rolled_out(user).await?;
        let writer = self.crm_writer()?;
        let team = writer
            .crm_team(user)
            .await?
            .ok_or(ImportError::CrmAccessRequired)?;
        let (counts, scanned) = tokio::sync::watch::channel(ScanCounts::default());
        let (found, ()) = tokio::join!(
            read(counts),
            super::workspace::scan::record_scan(&self.repo, user, scanned, self.workspace_source)
        );
        let found = found?;
        if control.reason().is_some() {
            return Ok(());
        }
        let mut rows = plan::rows(&found, kinds, &team, writer.as_ref())?;
        tracing::Span::current().record("rows", rows.len());
        let copies = super::lifecycle::team_copies(
            &self.repo,
            self.creator.as_ref(),
            user,
            &rows
                .iter()
                .map(|row| row.foreign_id.clone())
                .collect::<Vec<_>>(),
        )
        .instrument(tracing::info_span!("import.crm.plan.team_copies"))
        .await?;
        plan::link_existing(&mut rows, &copies)?;
        super::lifecycle::replace_plan(
            &self.repo,
            self.creator.as_ref(),
            user,
            self.workspace_source,
            &rows,
        )
        .instrument(tracing::info_span!("import.crm.plan.stage"))
        .await?;
        self.notify(user).await;
        Ok(())
    }

    #[tracing::instrument(name = "import.crm.write", skip_all, fields(source = kinds.source.as_ref(), %review, written, failed), err)]
    pub(super) async fn write_crm(
        &self,
        user: &MacroUserIdStr<'static>,
        review: Uuid,
        control: &JobControl,
        kinds: CrmKinds,
    ) -> Result<usize> {
        let writer = self.crm_writer()?;
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
        for kind in kinds.write_order() {
            let span = tracing::info_span!(
                "import.crm.write.phase",
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
                        .write_crm_object(
                            user,
                            row,
                            team,
                            &mut known,
                            writer.as_ref(),
                            control,
                            kinds,
                        )
                        .await;
                    match result {
                        Ok(Some(id)) => {
                            written += 1;
                            phase_written += 1;
                            known.targets.insert(row.foreign_id.clone(), id);
                        }
                        Ok(None) => {}
                        // Cut short by shutdown: the row stays importing for
                        // the process that adopts the run.
                        Err(_) if control.handed_over() => return Ok(phase_failed),
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

    #[expect(
        clippy::too_many_arguments,
        reason = "one object's write needs the whole write's state"
    )]
    async fn write_crm_object(
        &self,
        user: &MacroUserIdStr<'static>,
        row: &ImportEntity,
        team: Option<Uuid>,
        known: &mut Known,
        writer: &dyn CrmImportWriter,
        control: &JobControl,
        kinds: CrmKinds,
    ) -> Result<Option<Uuid>> {
        let meta: CrmMeta = serde_json::from_value(row.metadata.clone())?;
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
                // A row that left importing meanwhile is not this write's to
                // link, so nothing may be filed under it.
                let marked = self
                    .repo
                    .mark_imported(user, row.id, &entity_id, &entity_type, None)
                    .await?;
                return Ok(marked.and_then(|_| entity_id.parse().ok()));
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
        // The record stays journaled when its row left importing meanwhile,
        // so a later write reconciles it; this one does not file under it.
        let marked = self
            .repo
            .mark_imported(
                user,
                row.id,
                &id.to_string(),
                kinds.entity_type(row.kind),
                Some(team),
            )
            .await?;
        Ok(marked.map(|_| id))
    }

    /// The CRM company `key` became. One a teammate's write linked after this
    /// write read the ledger is read again, so it is not reported missing.
    async fn company_target(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &str,
        targets: &mut HashMap<String, Uuid>,
    ) -> Result<Option<Uuid>> {
        if let Some(target) = targets.get(key) {
            return Ok(Some(*target));
        }
        let Some(row) = self
            .repo
            .get_own_by_foreign_id(user, self.workspace_source, key)
            .await?
        else {
            return Ok(None);
        };
        let target = (row.status == ImportStatus::Imported)
            .then_some(row.entity_id)
            .flatten()
            .and_then(|id| id.parse().ok());
        if let Some(target) = target {
            targets.insert(key.to_owned(), target);
        }
        Ok(target)
    }

    /// The CRM record for one object: an existing one by its natural key
    /// (domain, any address, the deal's link), or a new one. `true` when it
    /// was created.
    async fn find_or_create(
        &self,
        user: &MacroUserIdStr<'static>,
        meta: &CrmMeta,
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
            CrmObject::Pipeline { stages } => Ok((
                writer
                    .create_deal_pipeline(user, &meta.title, stages)
                    .await?,
                true,
            )),
            CrmObject::Company { domain } => {
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
            CrmObject::Contact { emails, company } => {
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
                    Some(key) => Some(self.company_target(user, key, targets).await?.ok_or(
                        ImportError::NotReady(
                            "Its company has not been imported. Plan again to retry this contact.",
                        ),
                    )?),
                };
                let contact = NewCrmContact {
                    name: meta.title.clone(),
                    emails: emails.clone(),
                    company,
                };
                Ok((writer.create_contact(user, &contact).await?, true))
            }
            CrmObject::Deal(deal) => {
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
                let company = self
                    .company_target(user, &deal.company, targets)
                    .await?
                    .ok_or(ImportError::NotReady(
                        "Its company has not been imported. Plan again to retry this deal.",
                    ))?;
                let entries = match deal_entries.entry((pipeline, company)) {
                    std::collections::hash_map::Entry::Occupied(known) => known.into_mut(),
                    std::collections::hash_map::Entry::Vacant(slot) => slot.insert(
                        writer
                            .deal_entries(user, pipeline, company)
                            .await?
                            .into_iter()
                            .map(|(link, entry)| (record_path(&link).to_owned(), entry))
                            .collect(),
                    ),
                };
                if let Some(existing) = entries.get(record_path(link)) {
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
                entries.insert(record_path(link).to_owned(), added);
                Ok((added, true))
            }
        }
    }
}

/// The object's URL in its source, which a deal entry carries as its identity.
fn link(row: &ImportEntity, meta: &CrmMeta) -> String {
    meta.url.clone().unwrap_or_else(|| row.foreign_id.clone())
}

/// What identifies a deal entry's link: its path, which names the portal or
/// workspace and the record. The host differs by region and can change
/// between plans.
fn record_path(link: &str) -> &str {
    link.split_once("://")
        .and_then(|(_, rest)| rest.find('/').map(|slash| &rest[slash..]))
        .unwrap_or(link)
}

/// The review card's section for one CRM source, from the current plan's
/// rows of that source.
pub(in crate::domain::service) fn report<'a>(
    review: Option<Uuid>,
    rows: impl IntoIterator<Item = &'a ImportEntity>,
    kinds: CrmKinds,
) -> Option<CrmReport> {
    let mut report = CrmReport::default();
    let mut losses: HashMap<CrmLoss, u32> = HashMap::new();
    let mut any = false;
    let rows: Vec<&ImportEntity> = rows
        .into_iter()
        .filter(|row| row.kind.source() == kinds.source)
        .collect();
    // Companies the owner left out: their contacts are written without them.
    let left_out: std::collections::HashSet<&str> = rows
        .iter()
        .filter(|row| {
            row.kind == kinds.company
                && row.status == ImportStatus::Discarded
                && review.is_some()
                && row.review_id == review
        })
        .map(|row| row.foreign_id.as_str())
        .collect();
    for row in rows {
        let Ok(meta) = serde_json::from_value::<CrmMeta>(row.metadata.clone()) else {
            continue;
        };
        any = true;
        if row.kind == kinds.pipeline {
            report.pipelines += 1;
        } else if row.kind == kinds.company {
            report.companies += 1;
        } else if row.kind == kinds.contact {
            report.contacts += 1;
        } else if row.kind == kinds.deal {
            report.deals += 1;
        }
        // A teammate's copy counts from the plan on, not once it is linked.
        if row.status != ImportStatus::Discarded && meta.plan.already_imported.is_some() {
            report.already_imported += 1;
        }
        for loss in meta.losses {
            *losses.entry(loss).or_default() += 1;
        }
        if let CrmObject::Contact {
            company: Some(company),
            ..
        } = &meta.object
            && left_out.contains(company.as_str())
            && row.status != ImportStatus::Discarded
        {
            *losses.entry(CrmLoss::ContactWithoutCompany).or_default() += 1;
        }
        if let Some(summary) = meta.summary {
            report.owners = summary.owners;
            report.owners_matched = summary.owners_matched;
            report.custom_properties = summary.custom_properties;
        }
    }
    report.losses = CrmLoss::iter()
        .filter_map(|loss| {
            Some(CrmLossCount {
                loss,
                count: *losses.get(&loss)?,
            })
        })
        .collect();
    any.then_some(report)
}
