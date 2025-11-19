use crate::{
    OpensearchClient, Result,
    search::{
        self,
        unified::{UnifiedSearchArgs, UnifiedSearchResponse},
    },
};

impl OpensearchClient {
    /// Performs a unified search
    #[tracing::instrument(skip(self, args))]
    pub async fn search_unified(
        &self,
        args: UnifiedSearchArgs,
    ) -> Result<Vec<UnifiedSearchResponse>> {
        search::unified::search_unified(&self.inner, args).await
    }
}
