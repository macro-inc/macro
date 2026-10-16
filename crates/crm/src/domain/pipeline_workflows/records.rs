//! The companies and contacts entries track, named as the viewer sees them.

use std::collections::HashMap;

use entity_access::domain::models::MemberTeamRole;
use filter_ast::Expr;
use item_filters::ast::crm_contact::CrmContactLiteral;
use uuid::Uuid;

use super::super::{
    auth::CrmTeamReceipt,
    companies_repo::CrmCompanyListSort,
    contact_listing::CrmContactListQuery,
    model::CrmError,
    pipelines::PipelineRecordType,
    service::{CrmService, MAX_CONTACT_SEARCH_LIMIT},
};

/// The company or contact an entry tracks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipelineRecord {
    /// The CRM company or contact id.
    pub id: Uuid,
    /// Its display name; `None` when the viewer cannot see the record.
    pub name: Option<String>,
    /// A company's primary domain, or a contact's email address.
    pub detail: Option<String>,
}

impl PipelineRecord {
    /// A record known only by its id.
    pub(crate) fn unnamed(id: Uuid) -> Self {
        Self {
            id,
            name: None,
            detail: None,
        }
    }

    /// Whether its name or detail contains `search`, ignoring case.
    pub(crate) fn matches(&self, search: &str) -> bool {
        let search = search.trim().to_lowercase();
        [&self.name, &self.detail]
            .into_iter()
            .flatten()
            .any(|text| text.to_lowercase().contains(&search))
    }
}

/// The records among `ids` the viewer can see, by id. Companies are read
/// through the viewer's team CRM, hidden ones only for its admins; contacts
/// through every CRM the viewer belongs to.
pub(crate) async fn records<Crm: CrmService>(
    crm: &Crm,
    team: Option<&CrmTeamReceipt<MemberTeamRole>>,
    user_id: &str,
    record_type: PipelineRecordType,
    ids: &[Uuid],
) -> Result<HashMap<Uuid, PipelineRecord>, CrmError> {
    let mut found = HashMap::with_capacity(ids.len());
    for chunk in ids.chunks(usize::from(MAX_CONTACT_SEARCH_LIMIT)) {
        match record_type {
            PipelineRecordType::Company => {
                let Some(team) = team else {
                    return Ok(found);
                };
                let hidden = (!team.include_hidden()).then_some(false);
                let limit = i64::try_from(chunk.len()).unwrap_or(i64::MAX);
                for company in crm
                    .list_companies_for_soup(
                        team,
                        user_id,
                        chunk,
                        hidden,
                        CrmCompanyListSort::UpdatedAt,
                        None,
                        limit,
                    )
                    .await?
                {
                    let domain = company
                        .company
                        .domains
                        .first()
                        .map(|domain| domain.domain.clone());
                    found.insert(
                        company.company.id,
                        PipelineRecord {
                            id: company.company.id,
                            name: company.name.or_else(|| domain.clone()),
                            detail: domain,
                        },
                    );
                }
            }
            PipelineRecordType::Contact => {
                let Some(filter) = chunk
                    .iter()
                    .map(|id| Expr::Literal(CrmContactLiteral::Id(*id)))
                    .reduce(|left, right| Expr::Or(Box::new(left), Box::new(right)))
                else {
                    continue;
                };
                let query = CrmContactListQuery {
                    filter,
                    sort: CrmCompanyListSort::UpdatedAt,
                    cursor: None,
                    ascending: false,
                    limit: u16::try_from(chunk.len()).unwrap_or(MAX_CONTACT_SEARCH_LIMIT),
                };
                for listed in crm.list_contacts_for_soup(user_id, None, query).await? {
                    let contact = listed.contact;
                    found.insert(
                        contact.id,
                        PipelineRecord {
                            id: contact.id,
                            name: Some(contact.name.unwrap_or_else(|| contact.email.clone())),
                            detail: Some(contact.email),
                        },
                    );
                }
            }
        }
    }
    Ok(found)
}
