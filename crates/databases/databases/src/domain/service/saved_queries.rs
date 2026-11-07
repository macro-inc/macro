use super::*;
use models_databases::MAX_STATEMENT_LENGTH;

impl<Repository, Definitions, Cells, Events, Access, Broker>
    DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    pub(super) async fn store_query(
        &self,
        viewer: Viewer,
        database_id: Option<DatabaseId>,
        definition: QueryDefinition,
    ) -> Result<SavedQuery, SavedQueryError> {
        if definition.sql().len() > MAX_STATEMENT_LENGTH {
            return Err(SavedQueryError::TooLong);
        }
        if let Some(database_id) = database_id
            && self
                .live_database_grant(&viewer, database_id)
                .await
                .map_err(SavedQueryError::Repo)?
                .is_none()
        {
            return Err(SavedQueryError::NotFound);
        }
        self.repository
            .save_query(database_id, &definition, &viewer.user_id)
            .await
            .map_err(|error| SavedQueryError::Repo(rootcause::Report::new(error).into_dynamic()))
    }

    /// A saved query the viewer may read: their own, or one scoped to a live
    /// database they can view. Anything else is indistinguishable from a
    /// missing query.
    pub(super) async fn readable_query(
        &self,
        viewer: &Viewer,
        id: QueryId,
    ) -> Result<SavedQuery, SavedQueryError> {
        let saved = self
            .repository
            .get_query(id)
            .await
            .map_err(|error| SavedQueryError::Repo(rootcause::Report::new(error).into_dynamic()))?
            .ok_or(SavedQueryError::NotFound)?;
        if saved.created_by.as_deref() == Some(viewer.user_id.as_ref()) {
            return Ok(saved);
        }
        let Some(database_id) = saved.database_id else {
            return Err(SavedQueryError::NotFound);
        };
        match self
            .live_database_grant(viewer, database_id)
            .await
            .map_err(SavedQueryError::Repo)?
        {
            Some(_) => Ok(saved),
            None => Err(SavedQueryError::NotFound),
        }
    }
}
