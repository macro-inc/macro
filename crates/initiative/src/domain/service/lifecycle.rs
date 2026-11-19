//! Physical identity reads for trusted integrations.
use super::*;
use crate::domain::ports::InitiativeLifecycleReads;

impl<R: InitiativeRepo, S: InitiativeDescriptionSurfaces> InitiativeLifecycleReads
    for InitiativeServiceImpl<R, S>
{
    #[tracing::instrument(skip(self), err)]
    async fn initiative_is_live(&self, id: InitiativeId) -> Result<bool, InitiativeError> {
        Ok(self.repo.get_basic(id).await.map_err(Into::into)?.is_some())
    }
}
