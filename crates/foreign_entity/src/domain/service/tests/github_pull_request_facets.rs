use super::*;

use entity_access::domain::models::MemberTeamRole;

use crate::domain::models::{GithubPullRequestFacets, GithubRepositoryFacet};
use crate::domain::ports::{GithubPullRequestFacetRepository, GithubPullRequestFacetService};

#[derive(Clone, Default)]
struct RecordingFacetRepository {
    calls: Arc<Mutex<Vec<Vec<SourceId>>>>,
}

impl RecordingFacetRepository {
    fn calls(&self) -> Vec<Vec<SourceId>> {
        self.calls
            .lock()
            .expect("recording facet repository lock poisoned")
            .clone()
    }
}

impl GithubPullRequestFacetRepository for RecordingFacetRepository {
    type Err = anyhow::Error;

    async fn get_github_pull_request_facets(
        &self,
        source_ids: Vec<SourceId>,
    ) -> Result<GithubPullRequestFacets, Self::Err> {
        self.calls
            .lock()
            .expect("recording facet repository lock poisoned")
            .push(source_ids);
        Ok(GithubPullRequestFacets {
            repositories: vec![GithubRepositoryFacet {
                repository_id: "100".to_string(),
                repository: "macro-inc/macro".to_string(),
                count: 2,
            }],
            authors: Vec::new(),
        })
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|user@example.com".to_string())
        .expect("test user id should parse")
}

#[tokio::test]
async fn facets_are_scoped_to_the_user_without_a_team() {
    let repo = RecordingFacetRepository::default();
    let service = ForeignEntityServiceImpl::new(repo.clone());

    let facets = service
        .get_github_pull_request_facets(user(), None)
        .await
        .expect("facets should load");

    assert_eq!(facets.repositories.len(), 1);
    assert_eq!(
        repo.calls(),
        vec![vec![SourceId::user("macro|user@example.com")]]
    );
}

#[tokio::test]
async fn facets_include_the_team_in_context() {
    let repo = RecordingFacetRepository::default();
    let service = ForeignEntityServiceImpl::new(repo.clone());
    let team_id = Uuid::now_v7();
    let team = EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_internal_user(
        &team_id.to_string(),
        EntityType::Team,
    );

    service
        .get_github_pull_request_facets(user(), Some(team))
        .await
        .expect("facets should load");

    assert_eq!(
        repo.calls(),
        vec![vec![
            SourceId::user("macro|user@example.com"),
            SourceId::team(team_id),
        ]]
    );
}

#[tokio::test]
async fn facets_reject_a_non_team_receipt() {
    let repo = RecordingFacetRepository::default();
    let service = ForeignEntityServiceImpl::new(repo.clone());
    let receipt = EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_internal_user(
        "document-1",
        EntityType::Document,
    );

    let error = service
        .get_github_pull_request_facets(user(), Some(receipt))
        .await
        .expect_err("a non-team receipt should be rejected");

    assert!(matches!(error, ForeignEntityError::BadRequest(_)));
    assert!(repo.calls().is_empty());
}
