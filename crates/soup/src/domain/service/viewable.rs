//! Single-item hydration authorized by entity access receipts.
//!
//! Listings enumerate what Soup's per-type policy reaches; a single item is
//! readable whenever entity access grants View, which includes public and team
//! links the listings deliberately never enumerate.
use super::*;
use entity_access::domain::models::ViewAccessLevel;

impl<T, U, V, C, K, Crm, F> SoupImpl<T, U, V, C, K, Crm, F>
where
    T: SoupRepo,
    anyhow::Error: From<T::Err>,
    U: FrecencyQueryService,
    V: EmailPreviewServiceReadOnly,
    C: ChannelListService,
    K: CallRecordQueryService,
    Crm: CrmService,
    F: GithubPullRequestListing,
{
    pub(super) async fn viewable_items(
        &self,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<Vec<SoupProjectionHydration>, SoupErr> {
        let Some(first) = receipts.first() else {
            return Ok(Vec::new());
        };
        let viewer = first.acting_user_id().cloned();
        if receipts
            .iter()
            .any(|receipt| receipt.acting_user_id() != viewer.as_ref())
        {
            return Err(SoupErr::SoupDbErr(anyhow::anyhow!(
                "viewable items were requested for more than one viewer"
            )));
        }
        let entities = receipts
            .iter()
            .map(|receipt| {
                let entity = receipt.entity();
                entity
                    .entity_type
                    .with_entity_string(entity.entity_id.clone())
            })
            .collect::<Vec<_>>();
        let items = self
            .soup_storage
            .expanded_viewable_by_ids(viewer.clone(), &entities)
            .await
            .map_err(anyhow::Error::from)?;

        let mut candidates = items
            .into_iter()
            .map(SoupCandidate::plain)
            .collect::<Vec<_>>();
        // Pull request facts are scoped to the viewer's own and team sources;
        // a caller with no account sees none.
        let sources = viewer
            .iter()
            .map(|user| SourceId::user(user.as_ref()))
            .chain(
                team_receipt
                    .iter()
                    .map(|receipt| SourceId::new(receipt.entity().entity_id.clone(), "team")),
            )
            .collect();
        agent_metadata::enrich(
            &self.github_pull_request_service,
            self.agent_branches.as_deref(),
            viewer.map(|user| user.to_string()),
            sources,
            &mut candidates,
        )
        .await?;
        Ok(candidates
            .into_iter()
            .map(|candidate| SoupProjectionHydration {
                item: candidate.item,
                document_server_facts: None,
            })
            .collect())
    }
}
