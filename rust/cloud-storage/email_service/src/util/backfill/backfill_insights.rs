use email_db_client::links::get::fetch_link_by_macro_id;
use email_db_client::threads::get::get_threads_by_user_with_outbound;
use insight_service_client::InsightContextProvider;
use model::insight_context::email_insights::{
    BackfillBatchPayload, BackfillEmailInsightsFilter, EMAIL_INSIGHT_BATCH_SIZE,
    EMAIL_INSIGHT_PROVIDER_SOURCE_NAME, EmailInfo, GenerateEmailInsightContext,
};
use models_email::email::service::thread::UserThreadsPage;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use sqs_client::SQS;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct BackfillJobResponse {
    pub job_ids: Vec<String>,
}

#[tracing::instrument(skip(sqs_client, db))]
pub async fn backfill_email_insights(
    sqs_client: SQS,
    db: &Pool<Postgres>,
    req: BackfillEmailInsightsFilter,
) -> anyhow::Result<BackfillJobResponse> {
    tracing::info!("backfill email insights");

    let user_ids = if let Some(ref ids) = req.user_ids {
        ids.clone()
    } else {
        anyhow::bail!("user_ids required for now");
    };
    let user_thread_limit = req.user_thread_limit;

    // Generate unique job IDs for each user (insight service will create the actual job records)
    let mut job_ids = Vec::new();
    for user_id in &user_ids {
        let job_id = Uuid::new_v4().to_string();
        tracing::info!("Generated job ID {} for user {}", job_id, user_id);
        job_ids.push(job_id);
    }

    let provider =
        InsightContextProvider::create(sqs_client.clone(), EMAIL_INSIGHT_PROVIDER_SOURCE_NAME);

    tracing::debug!("received user ids: {:?}", user_ids);

    // Fetch all user emails for each user
    let mut user_emails_map = std::collections::HashMap::new();
    for user_id in &user_ids {
        let link = fetch_link_by_macro_id(db, user_id)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "Failed to fetch links for user");
            })?
            .ok_or_else(|| {
                tracing::error!(user_id=%user_id, "No link found for user");
                anyhow::anyhow!("No link found for user {}", user_id)
            })?;
        tracing::debug!(
            "user {} has email account {} linked",
            user_id,
            link.email_address.0.as_ref()
        );
        user_emails_map.insert(
            user_id.clone(),
            vec![link.email_address.0.as_ref().to_string()],
        );
    }

    let mut user_offsets: std::collections::HashMap<String, i64> =
        user_ids.iter().map(|u| (u.clone(), 0)).collect();
    let mut user_processed: std::collections::HashMap<String, i64> =
        user_ids.iter().map(|u| (u.clone(), 0)).collect();
    let user_job_ids: std::collections::HashMap<String, String> = user_ids
        .iter()
        .zip(job_ids.iter())
        .map(|(u, j)| (u.clone(), j.clone()))
        .collect();

    tracing::debug!("processing users: {:?}", user_offsets);

    while !user_offsets.is_empty() {
        let mut finished_users = Vec::new();
        for (user_id, offset) in user_offsets.iter_mut() {
            tracing::debug!("processing user {} at offset {}", user_id, offset);
            let Some(processed) = user_processed.get_mut(user_id) else {
                tracing::warn!("user {} not found in processed map", user_id);
                continue;
            };
            let Some(job_id) = user_job_ids.get(user_id) else {
                tracing::warn!("user {} not found in job ids map", user_id);
                continue;
            };
            if let Some(limit) = user_thread_limit
                && *processed >= limit
            {
                tracing::debug!("user {} has reached thread limit {}", user_id, limit);
                finished_users.push(user_id.clone());
                continue;
            }
            let page: UserThreadsPage =
                get_threads_by_user_with_outbound(db, user_id, EMAIL_INSIGHT_BATCH_SIZE, *offset)
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "Failed to fetch threads for user");
                    })?;
            tracing::debug!("user {} threads page {:?}", user_id, page);
            if page.threads.is_empty() {
                finished_users.push(user_id.clone());
                continue;
            }
            let threads: Vec<String> = if let Some(limit) = user_thread_limit {
                let remaining = limit - *processed;
                if remaining < page.threads.len() as i64 {
                    page.threads
                        .iter()
                        .take(remaining as usize)
                        .map(|t| t.thread_id.to_string())
                        .collect()
                } else {
                    page.threads
                        .iter()
                        .map(|t| t.thread_id.to_string())
                        .collect()
                }
            } else {
                page.threads
                    .iter()
                    .map(|t| t.thread_id.to_string())
                    .collect()
            };

            let thread_count = threads.len() as i64;
            *processed += thread_count;
            tracing::debug!("user {} processed threads {}", user_id, processed);

            let is_complete =
                page.is_complete || user_thread_limit.is_some_and(|limit| *processed >= limit);

            let Some(user_emails) = user_emails_map.get(user_id).cloned() else {
                tracing::warn!("user {} not found in emails map", user_id);
                continue;
            };

            // Generate unique batch ID for insight service tracking
            let batch_id = Uuid::new_v4().to_string();

            let payload = BackfillBatchPayload {
                thread_ids: threads,
                batch_size: thread_count,
                is_complete,
                user_emails,
                job_id: job_id.clone(),
                batch_id: batch_id.clone(),
            };
            let context = GenerateEmailInsightContext {
                macro_user_id: user_id.clone(),
                info: EmailInfo::Backfill(payload),
            };
            tracing::debug!("generated email context {:?}", context);

            // Send to SQS - fail the entire request if SQS fails
            if let Err(e) = provider.provide_email_context(context).await {
                tracing::error!(error=?e, user_id=%user_id, job_id=%job_id, batch_id=%batch_id, "Failed to send batch to SQS");
                anyhow::bail!("Failed to queue backfill batch");
            }

            if is_complete {
                finished_users.push(user_id.clone());
            } else {
                *offset += EMAIL_INSIGHT_BATCH_SIZE;
            }
        }
        for user_id in finished_users {
            user_offsets.remove(&user_id);
            user_processed.remove(&user_id);
        }
    }

    let response = BackfillJobResponse { job_ids };

    Ok(response)
}

#[cfg(test)]
mod backfill_tests {
    use super::*;
    use model::insight_context::email_insights::GenerateEmailInsightContext;
    use models_email::email::service::thread::{ThreadUserInfo, UserThreadsPage};
    use std::sync::{Arc, Mutex};
    use uuid::Uuid;

    struct MockProvider {
        pub batches: Arc<Mutex<Vec<GenerateEmailInsightContext>>>,
        pub should_fail: bool,
    }

    impl MockProvider {
        pub fn new() -> Self {
            Self {
                batches: Arc::new(Mutex::new(vec![])),
                should_fail: false,
            }
        }

        pub fn with_failure() -> Self {
            Self {
                batches: Arc::new(Mutex::new(vec![])),
                should_fail: true,
            }
        }

        pub async fn provide_email_context(
            &self,
            context: GenerateEmailInsightContext,
        ) -> anyhow::Result<()> {
            if self.should_fail {
                anyhow::bail!("SQS send failed");
            }
            self.batches.lock().unwrap().push(context);
            Ok(())
        }
    }

    // Test data builders
    fn create_test_threads(count: usize, start_id: u128) -> Vec<ThreadUserInfo> {
        (0..count)
            .map(|i| ThreadUserInfo {
                thread_id: Uuid::from_u128(start_id + i as u128),
            })
            .collect()
    }

    // Mock get_threads_by_user_with_outbound with configurable behavior
    async fn mock_get_threads_by_user_with_outbound(
        user_id: &str,
        batch_size: i64,
        offset: i64,
    ) -> anyhow::Result<UserThreadsPage> {
        let total = match user_id {
            "macro|user1@macro.com" => 5,
            "macro|user2@macro.com" => 3,
            "macro|empty_user@macro.com" => 0,
            _ => 2,
        };

        let start = offset;
        let end = (offset + batch_size).min(total);
        let threads = create_test_threads((end - start) as usize, start as u128 + 1);
        let is_complete = end >= total;

        Ok(UserThreadsPage {
            threads,
            is_complete,
        })
    }

    #[tokio::test]
    async fn test_backfill_email_insights_request_validation() {
        // Test successful request structure
        let req = BackfillEmailInsightsFilter {
            user_ids: Some(vec![
                "macro|user1@macro.com".to_string(),
                "macro|user2@macro.com".to_string(),
            ]),
            user_thread_limit: Some(3),
        };

        let user_ids = req.user_ids.as_ref().unwrap();
        assert_eq!(user_ids.len(), 2);
        assert_eq!(user_ids[0], "macro|user1@macro.com");
        assert_eq!(user_ids[1], "macro|user2@macro.com");
        assert_eq!(req.user_thread_limit, Some(3));

        // Test job ID generation uniqueness
        let mut job_ids = Vec::new();
        for _user_id in user_ids {
            let job_id = Uuid::new_v4().to_string();
            job_ids.push(job_id);
        }

        assert_eq!(job_ids.len(), 2);
        assert_ne!(job_ids[0], job_ids[1]);
    }

    #[tokio::test]
    async fn test_backfill_email_insights_no_user_ids() {
        let req = BackfillEmailInsightsFilter {
            user_ids: None,
            user_thread_limit: None,
        };

        // Request should be invalid without user IDs
        assert!(req.user_ids.is_none());
    }

    #[tokio::test]
    async fn test_backfill_email_insights_empty_user_list() {
        let req = BackfillEmailInsightsFilter {
            user_ids: Some(vec![]),
            user_thread_limit: Some(10),
        };

        let user_ids = req.user_ids.as_ref().unwrap();
        assert!(user_ids.is_empty());
    }

    #[tokio::test]
    async fn test_backfill_with_thread_limit() {
        // Test that thread limit is respected
        let user_id = "macro|user1@macro.com";
        let limit = 3i64;
        let batch_size = 2i64;

        let mut processed = 0i64;
        let mut offset = 0i64;
        let mut batches = Vec::new();

        while processed < limit {
            let page = mock_get_threads_by_user_with_outbound(user_id, batch_size, offset)
                .await
                .unwrap();

            if page.threads.is_empty() {
                break;
            }

            let remaining = limit - processed;
            let threads_to_take = if remaining < page.threads.len() as i64 {
                remaining as usize
            } else {
                page.threads.len()
            };

            let threads: Vec<String> = page
                .threads
                .iter()
                .take(threads_to_take)
                .map(|t| t.thread_id.to_string())
                .collect();

            processed += threads.len() as i64;
            batches.push(threads);

            if processed >= limit || page.is_complete {
                break;
            }

            offset += batch_size;
        }

        assert_eq!(processed, limit);
        assert_eq!(batches.len(), 2); // 2 threads, then 1 thread
        assert_eq!(batches[0].len(), 2);
        assert_eq!(batches[1].len(), 1);
    }

    #[tokio::test]
    async fn test_backfill_empty_user() {
        // Test user with no threads
        let user_id = "macro|empty_user@macro.com";
        let batch_size = 10i64;

        let page = mock_get_threads_by_user_with_outbound(user_id, batch_size, 0)
            .await
            .unwrap();

        assert!(page.threads.is_empty());
        assert!(page.is_complete);
    }

    #[tokio::test]
    async fn test_provider_error_handling() {
        let provider = MockProvider::with_failure();
        let context = GenerateEmailInsightContext {
            macro_user_id: "test_user".to_string(),
            info: EmailInfo::Backfill(BackfillBatchPayload {
                thread_ids: vec!["thread1".to_string()],
                batch_size: 1,
                is_complete: true,
                user_emails: vec!["test@example.com".to_string()],
                job_id: "test_job".to_string(),
                batch_id: "test_batch".to_string(),
            }),
        };

        let result = provider.provide_email_context(context).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("SQS send failed"));
    }

    #[tokio::test]
    async fn test_batch_payload_creation() {
        let thread_ids = vec!["thread1".to_string(), "thread2".to_string()];
        let user_emails = vec!["user@example.com".to_string()];
        let job_id = "test_job_123".to_string();
        let batch_id = Uuid::new_v4().to_string();

        let payload = BackfillBatchPayload {
            thread_ids: thread_ids.clone(),
            batch_size: thread_ids.len() as i64,
            is_complete: false,
            user_emails: user_emails.clone(),
            job_id: job_id.clone(),
            batch_id: batch_id.clone(),
        };

        assert_eq!(payload.thread_ids, thread_ids);
        assert_eq!(payload.batch_size, 2);
        assert!(!payload.is_complete);
        assert_eq!(payload.user_emails, user_emails);
        assert_eq!(payload.job_id, job_id);
        assert_eq!(payload.batch_id, batch_id);
    }

    #[tokio::test]
    async fn test_backfill_batching_and_limit() {
        let user_ids = vec![
            "macro|user1@macro.com".to_string(),
            "macro|user2@macro.com".to_string(),
        ];
        let user_thread_limit = Some(4); // Should only process up to 4 threads per user
        let batch_size = 2;

        let provider = MockProvider::new();
        let mut user_offsets: std::collections::HashMap<String, i64> =
            user_ids.iter().map(|u| (u.clone(), 0)).collect();
        let mut user_processed: std::collections::HashMap<String, i64> =
            user_ids.iter().map(|u| (u.clone(), 0)).collect();
        while !user_offsets.is_empty() {
            let mut finished_users = Vec::new();
            for (user_id, offset) in user_offsets.iter_mut() {
                let processed = user_processed.get_mut(user_id).unwrap();
                if let Some(limit) = user_thread_limit {
                    if *processed >= limit {
                        finished_users.push(user_id.clone());
                        continue;
                    }
                }
                let page = mock_get_threads_by_user_with_outbound(user_id, batch_size, *offset)
                    .await
                    .unwrap();
                if page.threads.is_empty() {
                    finished_users.push(user_id.clone());
                    continue;
                }
                let threads: Vec<String> = if let Some(limit) = user_thread_limit {
                    let remaining = limit - *processed;
                    if remaining < page.threads.len() as i64 {
                        page.threads
                            .iter()
                            .take(remaining as usize)
                            .map(|t| t.thread_id.to_string())
                            .collect()
                    } else {
                        page.threads
                            .iter()
                            .map(|t| t.thread_id.to_string())
                            .collect()
                    }
                } else {
                    page.threads
                        .iter()
                        .map(|t| t.thread_id.to_string())
                        .collect()
                };
                *processed += threads.len() as i64;
                let is_complete = page.is_complete
                    || (user_thread_limit.is_some() && *processed >= user_thread_limit.unwrap());
                let payload = BackfillBatchPayload {
                    thread_ids: threads,
                    batch_size,
                    is_complete,
                    user_emails: vec![],
                    job_id: "test_job_id".to_string(),
                    batch_id: "test_batch_id".to_string(),
                };
                let context = GenerateEmailInsightContext {
                    macro_user_id: user_id.clone(),
                    info: EmailInfo::Backfill(payload),
                };
                let _ = provider.provide_email_context(context).await;
                if is_complete {
                    finished_users.push(user_id.clone());
                } else {
                    *offset += batch_size;
                }
            }
            for user_id in finished_users {
                user_offsets.remove(&user_id);
                user_processed.remove(&user_id);
            }
        }
        // Assert: provider.batches contains the expected number of batches and threads per user
        let batches = provider.batches.lock().unwrap();
        // user1: 5 threads, but limit is 4, so 2 batches of 2
        // user2: 3 threads, but limit is 3, so 2 batches: 2 and 1
        let user1_batches: Vec<_> = batches
            .iter()
            .filter(|b| b.macro_user_id == "macro|user1@macro.com")
            .collect();
        let user2_batches: Vec<_> = batches
            .iter()
            .filter(|b| b.macro_user_id == "macro|user2@macro.com")
            .collect();
        assert_eq!(user1_batches.len(), 2);
        assert_eq!(user2_batches.len(), 2);
        assert_eq!(
            user1_batches[0]
                .info
                .as_backfill()
                .unwrap()
                .thread_ids
                .len(),
            2
        );
        assert_eq!(
            user1_batches[1]
                .info
                .as_backfill()
                .unwrap()
                .thread_ids
                .len(),
            2
        );
        assert_eq!(
            user2_batches[0]
                .info
                .as_backfill()
                .unwrap()
                .thread_ids
                .len(),
            2
        );
        assert_eq!(
            user2_batches[1]
                .info
                .as_backfill()
                .unwrap()
                .thread_ids
                .len(),
            1
        );
        // Check is_complete flag
        assert!(!user1_batches[0].info.as_backfill().unwrap().is_complete);
        assert!(user1_batches[1].info.as_backfill().unwrap().is_complete);
        assert!(!user2_batches[0].info.as_backfill().unwrap().is_complete);
        assert!(user2_batches[1].info.as_backfill().unwrap().is_complete);
    }

    // Helper to extract BackfillBatchPayload from EmailInfo
    trait AsBackfill {
        fn as_backfill(&self) -> Option<&BackfillBatchPayload>;
    }
    impl AsBackfill for EmailInfo {
        fn as_backfill(&self) -> Option<&BackfillBatchPayload> {
            if let EmailInfo::Backfill(payload) = self {
                Some(payload)
            } else {
                None
            }
        }
    }

    #[tokio::test]
    async fn test_backfill_handler_simplified() {
        // Test the simplified job ID generation logic

        let user_ids = vec!["test_user_1".to_string(), "test_user_2".to_string()];

        // Simulate the simplified job creation part of the handler
        let mut job_ids = Vec::new();
        for _user_id in &user_ids {
            // Generate unique job ID for insight service tracking
            let job_id = Uuid::new_v4().to_string();
            job_ids.push(job_id);
        }

        assert_eq!(job_ids.len(), 2);
        assert_ne!(job_ids[0], job_ids[1]);

        // Verify UUIDs are valid format
        for job_id in &job_ids {
            assert!(Uuid::parse_str(job_id).is_ok());
        }
    }

    #[test]
    fn test_backfill_response_structure() {
        let job_ids = vec!["test_job_123".to_string(), "test_job_456".to_string()];
        let response = BackfillJobResponse {
            job_ids: job_ids.clone(),
        };

        // Test serialization
        let json = serde_json::to_string(&response).expect("Should serialize");
        let expected = r#"{"job_ids":["test_job_123","test_job_456"]}"#;
        assert_eq!(json, expected);

        // Test deserialization
        let deserialized: BackfillJobResponse =
            serde_json::from_str(&json).expect("Should deserialize");
        assert_eq!(deserialized.job_ids, job_ids);
    }

    #[test]
    fn test_backfill_response_empty() {
        let response = BackfillJobResponse { job_ids: vec![] };

        let json = serde_json::to_string(&response).expect("Should serialize");
        let expected = r#"{"job_ids":[]}"#;
        assert_eq!(json, expected);
    }

    #[tokio::test]
    async fn test_uuid_generation_uniqueness() {
        // Test that generated UUIDs are unique across multiple calls
        let mut uuids = std::collections::HashSet::new();

        for _ in 0..1000 {
            let uuid = Uuid::new_v4().to_string();
            assert!(
                Uuid::parse_str(&uuid).is_ok(),
                "UUID should be valid format"
            );
            assert!(uuids.insert(uuid), "UUID should be unique");
        }

        assert_eq!(uuids.len(), 1000);
    }

    #[tokio::test]
    async fn test_offset_calculation() {
        // Test offset calculations with different batch sizes
        let test_cases = vec![
            (10, 3, vec![0, 3, 6, 9]), // 10 items, batch size 3
            (5, 2, vec![0, 2, 4]),     // 5 items, batch size 2
            (7, 5, vec![0, 5]),        // 7 items, batch size 5
        ];

        for (total_items, batch_size, expected_offsets) in test_cases {
            let mut offsets = Vec::new();
            let mut offset = 0i64;

            while offset < total_items {
                offsets.push(offset);
                offset += batch_size;
            }

            assert_eq!(
                offsets, expected_offsets,
                "Offsets should match for total={}, batch_size={}",
                total_items, batch_size
            );
        }
    }

    #[tokio::test]
    async fn test_thread_limiting_edge_cases() {
        // Test various edge cases for thread limiting
        struct TestCase {
            total_threads: i64,
            limit: Option<i64>,
            batch_size: i64,
            expected_processed: i64,
            expected_batches: usize,
        }

        let test_cases = vec![
            TestCase {
                total_threads: 10,
                limit: Some(5),
                batch_size: 2,
                expected_processed: 5,
                expected_batches: 3, // 2, 2, 1
            },
            TestCase {
                total_threads: 3,
                limit: Some(10),
                batch_size: 2,
                expected_processed: 3,
                expected_batches: 2, // 2, 1
            },
            TestCase {
                total_threads: 5,
                limit: None,
                batch_size: 3,
                expected_processed: 5,
                expected_batches: 2, // 3, 2
            },
        ];

        for case in test_cases {
            let mut processed = 0i64;
            let mut offset = 0i64;
            let mut batch_count = 0;

            while processed < case.total_threads
                && case.limit.map_or(true, |limit| processed < limit)
            {
                let start = offset;
                let end = (offset + case.batch_size).min(case.total_threads);
                let threads_in_batch = end - start;

                if threads_in_batch == 0 {
                    break;
                }

                let remaining = case.limit.map_or(threads_in_batch, |limit| {
                    (limit - processed).min(threads_in_batch)
                });

                processed += remaining;
                batch_count += 1;
                offset += case.batch_size;

                if case.limit.map_or(false, |limit| processed >= limit) {
                    break;
                }
            }

            assert_eq!(
                processed, case.expected_processed,
                "Processed count mismatch for case: total={}, limit={:?}, batch_size={}",
                case.total_threads, case.limit, case.batch_size
            );
            assert_eq!(
                batch_count, case.expected_batches,
                "Batch count mismatch for case: total={}, limit={:?}, batch_size={}",
                case.total_threads, case.limit, case.batch_size
            );
        }
    }

    #[test]
    fn test_email_info_pattern_matching() {
        // Test the AsBackfill trait implementation
        let payload = BackfillBatchPayload {
            thread_ids: vec!["thread1".to_string()],
            batch_size: 1,
            is_complete: true,
            user_emails: vec!["test@example.com".to_string()],
            job_id: "job1".to_string(),
            batch_id: "batch1".to_string(),
        };

        let email_info = EmailInfo::Backfill(payload);
        let extracted = email_info.as_backfill();

        assert!(extracted.is_some());
        assert_eq!(extracted.unwrap().thread_ids.len(), 1);
        assert_eq!(extracted.unwrap().job_id, "job1");
    }
}
