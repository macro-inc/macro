use models_search_cursor::SearchCursorOption;

use crate::{
    OpensearchClient, Result,
    retry::resend_on_lost_connection,
    search::{self, model::SearchHit, unified::UnifiedSearchArgs},
};

impl OpensearchClient {
    /// Performs a unified search
    #[tracing::instrument(skip(self, args), err)]
    pub async fn search_unified(
        &self,
        args: UnifiedSearchArgs,
    ) -> Result<(Vec<SearchHit>, SearchCursorOption)> {
        resend_on_lost_connection(|| search::unified::search_unified(&self.inner, args.clone()))
            .await
    }
}
