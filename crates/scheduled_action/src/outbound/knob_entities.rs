//! The items entity knobs name, looked up as the routine's owner through the
//! owning entity-access service, people through [`KnownPeople`], and the
//! trash through [`LiveItems`].

use entity_access::domain::{
    models::{AccessError, EntityType, ViewAccessLevel, ViewOnly},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use routine_program::{EntityKind, EntityValue};

use crate::domain::ports::{KnobEntities, KnownPeople, LiveItems};

#[cfg(test)]
mod test;

pub struct KnobEntityAccess<S, P, L> {
    service: S,
    people: P,
    live: L,
}

impl<S, P, L> KnobEntityAccess<S, P, L> {
    pub fn new(service: S, people: P, live: L) -> Self {
        Self {
            service,
            people,
            live,
        }
    }
}

/// Usable when a receipt was granted; gone or out of reach when the service
/// refused or couldn't find it, or the id isn't one its kind can have.
fn granted<T>(result: Result<T, AccessError>) -> Result<bool, Report> {
    match result {
        Ok(_) => Ok(true),
        Err(
            AccessError::Unauthorized
            | AccessError::UnauthorizedWithMessage(_)
            | AccessError::NotFound(_)
            | AccessError::BadRequest(_),
        ) => Ok(false),
        // Never turn infrastructure or adapter-contract errors into denial.
        Err(error) => Err(Report::new(error).into_dynamic()),
    }
}

impl<S: EntityAccessService, P: KnownPeople, L: LiveItems> KnobEntityAccess<S, P, L> {
    /// Whether the owner may view it, as `kind` in the access service.
    async fn viewable(
        &self,
        owner: &MacroUserIdStr<'static>,
        id: &str,
        kind: EntityType,
    ) -> Result<bool, Report> {
        granted(
            self.service
                .generate_entity_access_receipt::<ViewAccessLevel>(owner, None, id, kind)
                .await,
        )
    }

    /// Viewable, then out of the trash: the owner can still open what they
    /// trashed.
    async fn viewable_and_live(
        &self,
        owner: &MacroUserIdStr<'static>,
        item: &EntityValue,
        kind: EntityType,
    ) -> Result<bool, Report> {
        Ok(self.viewable(owner, item.id.as_str(), kind).await? && self.live.live(item).await?)
    }
}

#[async_trait::async_trait]
impl<S: EntityAccessService, P: KnownPeople, L: LiveItems> KnobEntities
    for KnobEntityAccess<S, P, L>
{
    async fn usable(
        &self,
        owner: &MacroUserIdStr<'static>,
        item: &EntityValue,
    ) -> Result<bool, Report> {
        let id = item.id.as_str();
        match item.kind {
            // Channel access is membership, which posting needs too.
            EntityKind::Channel => granted(
                self.service
                    .generate_entity_access_receipt::<ViewOnly>(
                        owner,
                        None,
                        id,
                        EntityType::Channel,
                    )
                    .await,
            ),
            // A task is a document; `live` checks it is still a task.
            EntityKind::Document | EntityKind::Task => {
                self.viewable_and_live(owner, item, EntityType::Document)
                    .await
            }
            EntityKind::Project => {
                self.viewable_and_live(owner, item, EntityType::Project)
                    .await
            }
            EntityKind::Chat => self.viewable_and_live(owner, item, EntityType::Chat).await,
            EntityKind::Database => self.viewable(owner, id, EntityType::Database).await,
            EntityKind::EmailThread => self.viewable(owner, id, EntityType::EmailThread).await,
            // Team CRM access, less what is hidden from plain members.
            EntityKind::CrmCompany => self.viewable(owner, id, EntityType::CrmCompany).await,
            EntityKind::CrmContact => self.viewable(owner, id, EntityType::CrmContact).await,
            EntityKind::Initiative => self.viewable(owner, id, EntityType::Initiative).await,
            // People aren't access-controlled: anyone who is a Macro user.
            EntityKind::User => match MacroUserIdStr::parse_from_str(id) {
                Ok(user) => self.people.exists(&user).await,
                Err(_) => Ok(false),
            },
        }
    }
}
