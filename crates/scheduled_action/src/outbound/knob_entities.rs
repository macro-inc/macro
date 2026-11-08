//! The items entity knobs name, looked up as the routine's owner through the
//! owning entity-access service, and people through [`KnownPeople`].

use entity_access::domain::{
    models::{AccessError, EntityType, ViewAccessLevel, ViewOnly},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use routine_program::{EntityKind, EntityValue};

use crate::domain::ports::{KnobEntities, KnownPeople};

#[cfg(test)]
mod test;

pub struct KnobEntityAccess<S, P> {
    service: S,
    people: P,
}

impl<S, P> KnobEntityAccess<S, P> {
    pub fn new(service: S, people: P) -> Self {
        Self { service, people }
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

#[async_trait::async_trait]
impl<S: EntityAccessService, P: KnownPeople> KnobEntities for KnobEntityAccess<S, P> {
    async fn usable(
        &self,
        owner: &MacroUserIdStr<'static>,
        item: &EntityValue,
    ) -> Result<bool, Report> {
        let id = item.id.as_str();
        let view = |kind| {
            self.service
                .generate_entity_access_receipt::<ViewAccessLevel>(owner, None, id, kind)
        };
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
            EntityKind::Document => granted(view(EntityType::Document).await),
            EntityKind::Project => granted(view(EntityType::Project).await),
            EntityKind::Database => granted(view(EntityType::Database).await),
            // People aren't access-controlled: anyone who is a Macro user.
            EntityKind::User => match MacroUserIdStr::parse_from_str(id) {
                Ok(user) => self.people.exists(&user).await,
                Err(_) => Ok(false),
            },
        }
    }
}
