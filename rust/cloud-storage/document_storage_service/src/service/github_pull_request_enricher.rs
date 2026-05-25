use authentication_service_client::AuthServiceClient;
use documents_hex::domain::{
    models::GithubPullRequest as DocumentGithubPullRequest, ports::GithubPullRequestEnricher,
};
use github::domain::models::{
    EnrichGithubPullRequestsRequest, EnrichGithubPullRequestsResponse, EnrichedGithubPullRequest,
    GithubPullRequestRef,
};
use macro_user_id::user_id::MacroUserIdStr;

/// Adapter that enriches document GitHub pull requests through authentication service.
#[derive(Clone)]
pub(crate) struct GithubPullRequestEnricherAdapter {
    auth_service_client: AuthServiceClient,
}

impl GithubPullRequestEnricherAdapter {
    /// Create a GitHub pull request enrichment adapter.
    pub(crate) fn new(auth_service_client: AuthServiceClient) -> Self {
        Self {
            auth_service_client,
        }
    }
}

impl GithubPullRequestEnricher for GithubPullRequestEnricherAdapter {
    fn enrich_pull_requests(
        &self,
        user_id: &MacroUserIdStr<'static>,
        pull_requests: Vec<DocumentGithubPullRequest>,
    ) -> impl Future<Output = Vec<DocumentGithubPullRequest>> + Send {
        let auth_service_client = self.auth_service_client.clone();
        let macro_user_id = user_id.as_ref().to_string();

        async move {
            let request = EnrichGithubPullRequestsRequest {
                macro_user_id,
                pull_requests: pull_requests
                    .iter()
                    .map(document_pull_request_to_github_ref)
                    .collect(),
            };

            let response: EnrichGithubPullRequestsResponse = match auth_service_client
                .enrich_github_pull_requests(&request)
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    tracing::warn!(
                        error=?error,
                        "failed to enrich GitHub pull requests through authentication service"
                    );
                    return pull_requests;
                }
            };

            response
                .pull_requests
                .into_iter()
                .map(enriched_github_pull_request_to_document)
                .collect()
        }
    }
}

fn document_pull_request_to_github_ref(
    pull_request: &DocumentGithubPullRequest,
) -> GithubPullRequestRef {
    GithubPullRequestRef {
        github_key: pull_request.github_key.clone(),
        owner: pull_request.owner.clone(),
        repo: pull_request.repo.clone(),
        number: pull_request.number,
        url: pull_request.url.clone(),
        display_name: pull_request.display_name.clone(),
    }
}

fn enriched_github_pull_request_to_document(
    pull_request: EnrichedGithubPullRequest,
) -> DocumentGithubPullRequest {
    DocumentGithubPullRequest {
        github_key: pull_request.github_key,
        owner: pull_request.owner,
        repo: pull_request.repo,
        number: pull_request.number,
        url: pull_request.url,
        display_name: pull_request.display_name,
        name: pull_request.name,
        status: pull_request.status.map(|status| status.to_string()),
        additions: pull_request.additions,
        deletions: pull_request.deletions,
    }
}
