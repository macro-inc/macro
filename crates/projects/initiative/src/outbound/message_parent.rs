//! Initiative identity for discussions, through the messages domain's port.

use std::{future::Future, pin::Pin};

use messages::domain::ports::{InitiativeParentFacts, InitiativeParentReader};
use uuid::Uuid;

use crate::domain::{
    lookup::{InitiativeLookup, InitiativeReader},
    models::InitiativeId,
    ports::InitiativeRepo,
};

impl<R: InitiativeRepo> InitiativeParentReader for InitiativeLookup<R> {
    fn read_initiative_parent(
        &self,
        id: Uuid,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Option<InitiativeParentFacts>, rootcause::Report>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let basic = self
                .read_basic(InitiativeId::from_uuid(id))
                .await
                .map_err(rootcause::Report::new)?;
            Ok(basic.map(|basic| InitiativeParentFacts {
                name: basic.name,
                owner_id: basic.owner_id.to_string(),
            }))
        })
    }
}
