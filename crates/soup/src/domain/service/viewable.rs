//! Hydration authorized by entity access receipts.
//!
//! Listings enumerate what Soup's per-type policy reaches; a single item is
//! readable whenever entity access grants View, which includes public and team
//! links the listings deliberately never enumerate. A project's View receipt
//! also authorizes listing its tasks, like a folder lists its documents.
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
        self.hydrate_viewable(viewer, &entities, team_receipt).await
    }

    /// Hydrate every live task `project` lists. Soup finds the tasks itself;
    /// the receipt proves only that the viewer may view the project.
    pub(super) async fn project_tasks(
        &self,
        project: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Vec<SoupProjectionHydration>, SoupErr> {
        let entity = project.entity();
        if entity.entity_type != EntityType::Initiative {
            return Err(SoupErr::SoupDbErr(anyhow::anyhow!(
                "project tasks were requested for a {}",
                entity.entity_type
            )));
        }
        let project_id = Uuid::parse_str(&entity.entity_id).map_err(anyhow::Error::new)?;
        let tasks = self
            .soup_storage
            .project_task_entities(project_id)
            .await
            .map_err(anyhow::Error::from)?;
        tracing::Span::current().record("task_count", tasks.len());
        if tasks.is_empty() {
            return Ok(Vec::new());
        }
        // Tasks are documents, so no agent session needs the viewer's team.
        self.hydrate_viewable(project.acting_user_id().cloned(), &tasks, None)
            .await
    }

    /// Hydrate `entities` for `viewer` with no listing predicate; the caller
    /// has already authorized every one.
    async fn hydrate_viewable(
        &self,
        viewer: Option<MacroUserIdStr<'static>>,
        entities: &[Entity<'_>],
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<Vec<SoupProjectionHydration>, SoupErr> {
        let items = self
            .soup_storage
            .expanded_viewable_by_ids(viewer.clone(), entities)
            .await
            .map_err(anyhow::Error::from)?;

        let mut candidates = items
            .into_iter()
            .map(SoupCandidate::from_projection_hydration)
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
                document_server_facts: candidate.document_server_facts,
                sort_key: None,
            })
            .collect())
    }
}
