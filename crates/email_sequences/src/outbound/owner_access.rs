//! Team membership, CRM state and CRM people, through their owning crates.

use crm::domain::{
    auth::CrmTeamReceipt, companies_repo::CrmCompanyListSort, contact_listing::CrmContactListQuery,
    model::CrmError, service::CrmService,
};
use entity_access::domain::{
    models::{AccessError, Entity, EntityAccessReceipt, EntityPermission, EntityType},
    ports::EntityAccessService,
};
use filter_ast::Expr;
use item_filters::ast::crm_contact::CrmContactLiteral;
use macro_user_id::user_id::MacroUserIdStr;
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

    async fn customers_team(&self, user_id: &str) -> Result<Option<Uuid>, OwnerAccessError> {
        let user = MacroUserIdStr::try_from(user_id.to_owned())
            .map_err(|_| OwnerAccessError::InvalidUser)?;
        let Some(team) = self.entity_access.get_user_team(&user).await? else {
            return Ok(None);
        };
        let receipt = EntityAccessReceipt::try_new_authenticated_user(
            user,
            Entity {
                entity_id: team.team_id.to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole { role: team.role },
        )?;
        // The CRM also refuses a member whose access an admin revoked.
        match self
            .crm
            .crm_scope_precheck(&CrmTeamReceipt::from_team_receipt(receipt)?, &[], &[])
            .await
        {
            Ok(precheck) => Ok(precheck.crm_enabled.then_some(team.team_id)),
            Err(CrmError::AccessDenied) => Ok(None),
            Err(error) => Err(error.into()),
        }
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
            // An id lookup shows a team admin archived people too.
            .filter(|listed| !listed.contact.hidden)
            .map(|listed| CrmPerson {
                id: listed.contact.id,
                team_id: listed.team_id,
                email: listed.contact.email,
                name: listed.contact.name,
            })
            .collect())
    }
}

#[cfg(test)]
mod test;
