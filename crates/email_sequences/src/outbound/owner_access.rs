//! Team membership, CRM state and CRM people, through their owning crates.

use crm::domain::{
    companies_repo::CrmCompanyListSort, contact_listing::CrmContactListQuery, model::CrmError,
    service::CrmService,
};
use entity_access::domain::{models::AccessError, ports::EntityAccessService};
use filter_ast::Expr;
use item_filters::ast::crm_contact::CrmContactLiteral;
use macro_user_id::user_id::MacroUserId;
use uuid::Uuid;

use crate::domain::{models::CrmPerson, ports::OwnerAccess};

/// [`OwnerAccess`] over entity access and the CRM service.
#[derive(Clone)]
pub struct CrmOwnerAccess<E, C> {
    entity_access: E,
    crm: C,
}

impl<E, C> CrmOwnerAccess<E, C> {
    /// Compose from the two services.
    pub fn new(entity_access: E, crm: C) -> Self {
        Self { entity_access, crm }
    }
}

/// A failure reading access.
#[derive(Debug, thiserror::Error)]
pub enum OwnerAccessError {
    /// Team membership couldn't be read.
    #[error(transparent)]
    Access(#[from] AccessError),
    /// CRM couldn't be read.
    #[error(transparent)]
    Crm(#[from] CrmError),
    /// The user id isn't one.
    #[error("invalid user id")]
    InvalidUser,
}

impl<E, C> OwnerAccess for CrmOwnerAccess<E, C>
where
    E: EntityAccessService,
    C: CrmService,
{
    type Err = OwnerAccessError;

    async fn team_of(&self, user_id: &str) -> Result<Option<Uuid>, OwnerAccessError> {
        let user = MacroUserId::parse_from_str(user_id)
            .map_err(|_| OwnerAccessError::InvalidUser)?
            .lowercase();
        Ok(self
            .entity_access
            .get_user_team(&user)
            .await?
            .map(|team| team.team_id))
    }

    async fn crm_enabled(&self, team_id: Uuid) -> Result<bool, OwnerAccessError> {
        Ok(self
            .crm
            .crm_scope_precheck(&team_id, &[], &[])
            .await?
            .crm_enabled)
    }

    async fn people(
        &self,
        user_id: &str,
        ids: &[Uuid],
    ) -> Result<Vec<CrmPerson>, OwnerAccessError> {
        let Some(filter) = ids
            .iter()
            .map(|id| Expr::Literal(CrmContactLiteral::Id(*id)))
            .reduce(|left, right| Expr::Or(Box::new(left), Box::new(right)))
        else {
            return Ok(Vec::new());
        };
        let query = CrmContactListQuery {
            filter,
            sort: CrmCompanyListSort::UpdatedAt,
            cursor: None,
            ascending: false,
            limit: u16::try_from(ids.len()).unwrap_or(u16::MAX),
        };
        Ok(self
            .crm
            .list_contacts_for_soup(user_id, None, query)
            .await?
            .into_iter()
            .map(|listed| CrmPerson {
                id: listed.contact.id,
                team_id: listed.team_id,
                email: listed.contact.email,
                name: listed.contact.name,
            })
            .collect())
    }
}
