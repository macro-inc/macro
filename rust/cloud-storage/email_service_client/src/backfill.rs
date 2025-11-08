use super::EmailServiceClient;
use anyhow::Result;
use model::insight_context::email_insights::BackfillEmailInsightsFilter;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct BackfillJobResponse {
    // One job id per user backfill job
    pub job_ids: Vec<String>,
}

impl EmailServiceClient {
    /// backfills insights for emails according to the filter (if any)
    /// Returns the job IDs that can be used to track progress (one per user)
    #[tracing::instrument(skip(self))]
    pub async fn backfill_insights(
        &self,
        input: BackfillEmailInsightsFilter,
    ) -> Result<Vec<String>> {
        let res = self
            .client
            .post(format!("{}/internal/backfill/insights", self.url))
            .json(&input)
            .send()
            .await?;

        let status_code = res.status();

        if status_code != reqwest::StatusCode::OK {
            let body: String = res.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from email service"
            );
            return Err(anyhow::anyhow!(body));
        }

        let response: BackfillJobResponse = res.json().await?;
        tracing::info!(job_ids=?response.job_ids, "Started insights backfill jobs");

        Ok(response.job_ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Example usage of the simplified backfill client
    #[tokio::test]
    #[ignore] // Requires running email service
    async fn example_backfill_simple() {
        let client =
            EmailServiceClient::new("http://localhost:3000".to_string(), "test_key".to_string());

        // Start a backfill job
        let filter = BackfillEmailInsightsFilter {
            user_ids: Some(vec!["user123".to_string()]),
            user_thread_limit: Some(100),
        };

        let job_ids = client.backfill_insights(filter).await.unwrap();
        println!("Started backfill jobs: {:?}", job_ids);

        // Job tracking is now handled by the insight service
        // Query the database directly to check job status
    }

    #[test]
    fn test_response_serialization() {
        // Test that our response types can be serialized/deserialized
        let response = BackfillJobResponse {
            job_ids: vec!["test-123".to_string(), "test-456".to_string()],
        };

        let json = serde_json::to_string(&response).unwrap();
        let deserialized: BackfillJobResponse = serde_json::from_str(&json).unwrap();

        assert_eq!(response.job_ids, deserialized.job_ids);
    }
}
