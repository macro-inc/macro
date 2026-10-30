//! Restrict Soup to the items associated with a CRM record.
//!
//! An item is associated with a company when its Companies property names
//! the company, its Contacts property names one of the company's contacts, or
//! it references the company or one of those contacts. An item is associated
//! with a contact when its Contacts property names the contact or it
//! references the contact. Activity matches properties only, and email
//! participants from visible CRM domains and addresses in the user's own mailbox.
//!
//! The CRM service authorizes the record and expands a company to the
//! contacts the viewer may see. The property and reference edges of those
//! records are then read as complete sets and every source query is
//! constrained to the matching entity ids, before its own access checks,
//! filters, sort, limit, grouping, and cursor apply. Nothing here grants
//! access: an edge only narrows a source query that already enforces the
//! viewer's access to each item.
use super::*;
use crate::domain::models::CrmPropertyEdge;
use channels::domain::models::{MessageParent, ReferenceSource, ReferenceTarget};
use crm::domain::{
    association::{CrmAssociation, CrmRecordAssociation},
    auth::CrmTeamReceipt,
    model::CrmError,
};
use item_filters::ast::email::Email;
use item_filters::ast::{
    agent_session::AgentSessionLiteral, calendar_event::CalendarEventLiteral, call::CallLiteral,
    chat::ChatLiteral, crm_contact::CrmContactLiteral, database_row::DatabaseRowLiteral,
    document::DocumentLiteral, initiative::InitiativeLiteral, project::ProjectLiteral,
};
use macro_user_id::email::EmailStr;
use models_properties::EntityType as PropertyEntityType;
use std::collections::BTreeSet;

#[cfg(test)]
mod test;

/// Upper bound on distinct CRM records one request may restrict to; each
/// costs an authorization read and an edge read.
const MAX_CRM_ASSOCIATIONS: usize = 8;

/// The entities associated with one CRM record, per Soup source.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct AssociatedEntities {
    pub documents: BTreeSet<Uuid>,
    pub chats: BTreeSet<Uuid>,
    pub projects: BTreeSet<Uuid>,
    pub initiatives: BTreeSet<Uuid>,
    pub database_rows: BTreeSet<Uuid>,
    pub calendar_events: BTreeSet<Uuid>,
    pub email_threads: BTreeSet<Uuid>,
    pub calls: BTreeSet<Uuid>,
    pub channels: BTreeSet<Uuid>,
    /// Top-level channel messages: a referencing message, or the root of
    /// the thread a referencing reply belongs to.
    pub channel_threads: BTreeSet<Uuid>,
    pub crm_companies: BTreeSet<Uuid>,
    pub crm_contacts: BTreeSet<Uuid>,
}

impl AssociatedEntities {
    /// Group property and (for record associations) reference edges by source.
    pub(super) fn from_edges(
        record: CrmAssociation,
        property_edges: Vec<CrmPropertyEdge>,
        reference_sources: Vec<ReferenceSource>,
    ) -> Self {
        let mut entities = Self::default();
        for edge in property_edges {
            let Ok(id) = Uuid::parse_str(&edge.entity_id) else {
                tracing::warn!(entity_type = ?edge.entity_type, "associated entity id is not a uuid; skipping");
                continue;
            };
            let set = match edge.entity_type {
                PropertyEntityType::Document | PropertyEntityType::Task => &mut entities.documents,
                PropertyEntityType::Chat => &mut entities.chats,
                PropertyEntityType::Project => &mut entities.projects,
                PropertyEntityType::Initiative => &mut entities.initiatives,
                PropertyEntityType::DatabaseRow => &mut entities.database_rows,
                PropertyEntityType::CalendarEvent => &mut entities.calendar_events,
                PropertyEntityType::Thread => &mut entities.email_threads,
                PropertyEntityType::CallRecord => &mut entities.calls,
                PropertyEntityType::Channel => &mut entities.channels,
                // A CRM record's own Companies or Contacts property can name
                // another record, which the CRM sources list like any item.
                PropertyEntityType::Company => &mut entities.crm_companies,
                PropertyEntityType::Contact => &mut entities.crm_contacts,
                // Users are not a Soup source.
                PropertyEntityType::User => continue,
            };
            set.insert(id);
        }
        for source in reference_sources {
            match source {
                ReferenceSource::Document(id) => match Uuid::parse_str(&id) {
                    Ok(id) => {
                        entities.documents.insert(id);
                    }
                    Err(_) => tracing::warn!("referencing document id is not a uuid; skipping"),
                },
                ReferenceSource::Message(message) => {
                    match message.parent {
                        MessageParent::Channel(_) => {
                            entities.channel_threads.insert(message.root_id());
                        }
                        // Discussion messages make their parent the
                        // associated item; they are never channel rows.
                        MessageParent::Document(id) => match Uuid::parse_str(&id) {
                            Ok(id) => {
                                entities.documents.insert(id);
                            }
                            Err(_) => tracing::warn!(
                                "discussion parent document id is not a uuid; skipping"
                            ),
                        },
                        MessageParent::Initiative(id) => {
                            entities.initiatives.insert(id);
                        }
                        MessageParent::Call(id) => {
                            entities.calls.insert(id);
                        }
                        MessageParent::CrmCompany(id) => {
                            entities.crm_companies.insert(id);
                        }
                        MessageParent::CrmContact(id) => {
                            entities.crm_contacts.insert(id);
                        }
                    }
                }
            }
        }
        // A record's own discussion does not make it associated with itself.
        match record {
            CrmAssociation::Company(id) => {
                entities.crm_companies.remove(&id);
            }
            CrmAssociation::Contact(id) => {
                entities.crm_contacts.remove(&id);
            }
            CrmAssociation::Activity => {}
        }
        entities
    }
}

/// The reference targets a resolved association matches.
fn reference_targets(association: &CrmRecordAssociation) -> Vec<ReferenceTarget> {
    let target = |entity_type: &str, id: &Uuid| ReferenceTarget {
        entity_type: entity_type.to_owned(),
        entity_id: id.to_string(),
    };
    association
        .company_ids
        .iter()
        .map(|id| target("crm_company", id))
        .chain(
            association
                .contact_ids
                .iter()
                .map(|id| target("crm_contact", id)),
        )
        .collect()
}

/// Every CRM association a request names, resolved to its entities.
#[derive(Debug, Default)]
pub(super) struct ResolvedAssociations {
    entities: HashMap<CrmAssociation, AssociatedEntities>,
    activity_email: Option<Arc<Expr<EmailLiteral>>>,
}

impl ResolvedAssociations {
    /// The entities of a record resolved for this request.
    pub(super) fn get(&self, record: &CrmAssociation) -> Option<&AssociatedEntities> {
        self.entities.get(record)
    }

    /// Restrict `ast` to the resolved associations: every source to the
    /// top-level record's entities, and each document association literal
    /// to its record's documents. The top-level scope is cleared so no
    /// renderer sees it.
    pub(super) fn apply(&self, mut ast: EntityFilterAst) -> EntityFilterAst {
        if let Some(tree) = ast.document_filter.take() {
            ast.document_filter = Some(Arc::new(replace_document_associations(&tree, self)));
        }
        let Some(record) = ast.crm_association.take() else {
            return ast;
        };
        if record == CrmAssociation::Activity {
            let email = self
                .activity_email
                .clone()
                .unwrap_or_else(|| Arc::new(Expr::val(EmailLiteral::ThreadId(Uuid::nil()))));
            ast.email_filter.tree = Some(with_id_tree(email, ast.email_filter.tree.as_ref()));
        }
        let Some(entities) = self.get(&record) else {
            return ast;
        };
        constrain(
            &mut ast.document_filter,
            &entities.documents,
            DocumentLiteral::Id,
        );
        constrain(&mut ast.chat_filter, &entities.chats, ChatLiteral::ChatId);
        constrain(
            &mut ast.project_filter,
            &entities.projects,
            ProjectLiteral::ProjectIdSelf,
        );
        if record != CrmAssociation::Activity {
            constrain(
                &mut ast.email_filter.tree,
                &entities.email_threads,
                EmailLiteral::ThreadId,
            );
        }
        constrain(
            &mut ast.channel_filter,
            &entities.channels,
            ChannelLiteral::ChannelId,
        );
        constrain(
            &mut ast.channel_thread_filter,
            &entities.channel_threads,
            ChannelThreadLiteral::ThreadId,
        );
        constrain(&mut ast.call_filter, &entities.calls, CallLiteral::CallId);
        constrain(
            &mut ast.calendar_event_filter,
            &entities.calendar_events,
            CalendarEventLiteral::Id,
        );
        // Foreign entities and agent sessions carry no CRM association.
        constrain(
            &mut ast.foreign_entity_filter,
            &BTreeSet::new(),
            ForeignEntityLiteral::Id,
        );
        // Agent sessions, initiatives, rows, and contacts are opt-in:
        // constrain them only when requested so the association never opts
        // a query into them.
        if ast.agent_session_filter.is_some() {
            constrain(
                &mut ast.agent_session_filter,
                &BTreeSet::new(),
                AgentSessionLiteral::Id,
            );
        }
        if item_filters::ast::initiative::initiatives_requested(ast.initiative_filter.as_deref()) {
            constrain(
                &mut ast.initiative_filter,
                &entities.initiatives,
                InitiativeLiteral::Id,
            );
        }
        if item_filters::ast::database_row::database_rows_requested(
            ast.database_row_filter.as_deref(),
        ) {
            constrain(
                &mut ast.database_row_filter,
                &entities.database_rows,
                DatabaseRowLiteral::Id,
            );
        }
        if ast.crm_contact_filter.is_some() {
            constrain(
                &mut ast.crm_contact_filter,
                &entities.crm_contacts,
                CrmContactLiteral::Id,
            );
        }
        // CRM companies take an id list, intersected where the request is
        // built (see `intersect_crm_companies`).
        ast
    }
}

/// AND `tree` with membership in `ids`; an empty set matches nothing.
fn constrain<T: Clone>(
    tree: &mut Option<Arc<Expr<T>>>,
    ids: &BTreeSet<Uuid>,
    literal: impl Fn(Uuid) -> T,
) {
    *tree = Some(with_id_tree(id_tree(ids, literal), tree.as_ref()));
}

/// A balanced OR over `ids`, or a nil id when there are none.
fn id_tree<T>(ids: &BTreeSet<Uuid>, literal: impl Fn(Uuid) -> T) -> Arc<Expr<T>> {
    balanced_or_tree(ids.iter().map(|id| Expr::val(literal(*id))).collect())
        .unwrap_or_else(|| Arc::new(Expr::val(literal(Uuid::nil()))))
}

fn replace_document_associations(
    expr: &Expr<DocumentLiteral>,
    resolved: &ResolvedAssociations,
) -> Expr<DocumentLiteral> {
    match expr {
        Expr::Literal(DocumentLiteral::CrmAssociated(record)) => {
            let empty = BTreeSet::new();
            let documents = resolved
                .get(record)
                .map_or(&empty, |entities| &entities.documents);
            Arc::unwrap_or_clone(id_tree(documents, DocumentLiteral::Id))
        }
        Expr::Literal(literal) => Expr::val(literal.clone()),
        Expr::And(a, b) => Expr::and(
            replace_document_associations(a, resolved),
            replace_document_associations(b, resolved),
        ),
        Expr::Or(a, b) => Expr::or(
            replace_document_associations(a, resolved),
            replace_document_associations(b, resolved),
        ),
        Expr::Not(a) => Expr::is_not(replace_document_associations(a, resolved)),
    }
}

/// Restrict a CRM company request to the companies associated with the
/// top-level record. `false` when none remain and the source is skipped.
pub(super) fn intersect_crm_companies(
    request: &mut GetCrmCompaniesRequest,
    entities: &AssociatedEntities,
) -> bool {
    super::favorites::intersect(
        &mut request.company_ids,
        entities.crm_companies.iter().copied().collect(),
    )
}

fn crm_error(error: CrmError) -> SoupErr {
    match error {
        CrmError::CompanyNotFoundForTeam | CrmError::ContactNotFoundForTeam => {
            SoupErr::CrmRecordNotFound
        }
        error => {
            tracing::error!(error = ?error, "failed to resolve a CRM association");
            SoupErr::CrmErr
        }
    }
}

impl<T, U, V, C, K, Crm, F> SoupImpl<T, U, V, C, K, Crm, F>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
    V: EmailPreviewServiceReadOnly,
    C: ChannelListService,
    K: CallRecordQueryService,
    Crm: CrmService,
    F: GithubPullRequestListing,
{
    /// Authorize and resolve every CRM record `ast` restricts to.
    #[tracing::instrument(name = "soup.crm_associations", skip_all, err)]
    pub(super) async fn resolve_crm_associations(
        &self,
        user: &MacroUserIdStr<'_>,
        team_receipt: Option<&EntityAccessReceipt<MemberTeamRole>>,
        ast: Option<&EntityFilterAst>,
    ) -> Result<Option<ResolvedAssociations>, SoupErr> {
        let records = ast
            .map(EntityFilterAst::crm_associations)
            .unwrap_or_default();
        if records.is_empty() {
            return Ok(None);
        }
        if records.len() > MAX_CRM_ASSOCIATIONS {
            return Err(SoupErr::AstErr(item_filters::ast::ExpandErr::ApiAst(
                format!("at most {MAX_CRM_ASSOCIATIONS} CRM associations per query"),
            )));
        }
        let access = team_receipt
            .cloned()
            .map(CrmTeamReceipt::from_team_receipt)
            .transpose()
            .map_err(crm_error)?;
        let mut resolved = HashMap::with_capacity(records.len());
        let mut activity_email = None;
        for record in records {
            let association = self
                .crm_service
                .resolve_association(user.as_ref(), access.as_ref(), record)
                .await
                .map_err(crm_error)?;
            let targets = reference_targets(&association);
            let (property_edges, reference_sources) = tokio::join!(
                async {
                    self.soup_storage
                        .crm_property_edges(&association.company_ids, &association.contact_ids)
                        .await
                        .map_err(anyhow::Error::from)
                        .map_err(SoupErr::from)
                },
                async {
                    if record == CrmAssociation::Activity {
                        return Ok(Vec::new());
                    }
                    self.comms_service
                        .get_reference_sources(&targets)
                        .await
                        .inspect_err(
                            |error| tracing::error!(error = ?error, "failed to read CRM references"),
                        )
                        .map_err(|_| SoupErr::CommsErr)
                },
            );
            if record == CrmAssociation::Activity {
                let values = association
                    .domains
                    .iter()
                    .cloned()
                    .map(Email::Domain)
                    .chain(association.addresses.iter().filter_map(|address| {
                        EmailStr::parse_from_str(address)
                            .ok()
                            .map(|email| Email::Complete(email.into_owned()))
                    }));
                activity_email = balanced_or_tree(
                    values
                        .map(|email| {
                            Expr::or(
                                Expr::or(
                                    Expr::val(EmailLiteral::Sender(email.clone())),
                                    Expr::val(EmailLiteral::Recipient(email.clone())),
                                ),
                                Expr::or(
                                    Expr::val(EmailLiteral::Cc(email.clone())),
                                    Expr::val(EmailLiteral::Bcc(email)),
                                ),
                            )
                        })
                        .collect(),
                );
            }
            let entities =
                AssociatedEntities::from_edges(record, property_edges?, reference_sources?);
            tracing::debug!(
                contacts = association.contact_ids.len(),
                documents = entities.documents.len(),
                channel_threads = entities.channel_threads.len(),
                calls = entities.calls.len(),
                "resolved CRM association"
            );
            resolved.insert(record, entities);
        }
        Ok(Some(ResolvedAssociations {
            entities: resolved,
            activity_email,
        }))
    }
}
