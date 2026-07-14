use super::*;
use frecency::domain::models::{
    FrecencyByIdsRequest, FrecencyPageRequest, FrecencyPageResponse, FrecencyQueryErr,
};
use macro_user_id::user_id::MacroUserIdStr;

struct PanicFrecencyService;

impl FrecencyQueryService for PanicFrecencyService {
    async fn get_frecency_page(
        &self,
        _query: FrecencyPageRequest<'_>,
    ) -> Result<FrecencyPageResponse, FrecencyQueryErr> {
        panic!("frecency page lookup should not run")
    }

    async fn get_frecencies_by_ids(
        &self,
        _request: FrecencyByIdsRequest<'_>,
    ) -> Result<FrecencyPageResponse, FrecencyQueryErr> {
        panic!("frecency by-id lookup should not run")
    }
}

#[tokio::test]
async fn skips_frecency_lookup_when_not_requested() {
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap();
    let ids = [EntityType::EmailThread.with_entity_string("thread-id".to_owned())];
    let scores = get_frecency_scores(&PanicFrecencyService, false, user_id, &ids)
        .await
        .unwrap();

    assert!(scores.is_empty());
}
