use models_search_cursor::SearchCursorOption;

use crate::{
    OpensearchClient, Result,
    search::{self, model::SearchHit, unified::UnifiedSearchArgs},
};

impl OpensearchClient {
    /// Performs a unified search
    #[tracing::instrument(skip(self, args))]
    pub async fn search_unified(
        &self,
        args: UnifiedSearchArgs,
    ) -> Result<(Vec<SearchHit>, SearchCursorOption)> {
        search::unified::search_unified(&self.inner, args).await
    }
}
