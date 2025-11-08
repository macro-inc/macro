pub mod chat;
pub mod email_processing;
pub mod generator;
pub mod shared_prompts;

use crate::context::ServiceContext;
use ai::{traits::Metadata, types::Model};
pub use chat::ChatInsightContextConsumer;
use chrono::{DateTime, Utc};
use model::insight_context::{
    EmailSourceLocation, InsightType as ModelInsightType, SourceLocation, UserInsightRecord,
};
use models_email::email::service::message::ParsedMessage;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;

pub const INSIGHT_MODEL: Model = Model::OpenAIGPT4o;

/// Helper function to parse insight type from string
fn parse_insight_type(type_str: &str) -> Option<ModelInsightType> {
    ModelInsightType::from_str(type_str).ok()
}

#[async_trait::async_trait]
pub trait InsightContextConsumer: Send + Sync {
    fn source_name(&self) -> String;
    fn trigger_generation_at_n_messages(&self) -> usize;

    async fn generate_insights(
        &self,
        resource_ids: &[String],
        user_id: &str,
        existing_insights: &[model::insight_context::UserInsightRecord],
        service_context: std::sync::Arc<ServiceContext>,
    ) -> Result<Vec<model::insight_context::UserInsightRecord>, anyhow::Error>;
}

impl std::fmt::Debug for dyn InsightContextConsumer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InsightContextConsumer")
            .field("source_name", &self.source_name())
            .finish()
    }
}

pub trait InsightType: for<'de> Deserialize<'de> + JsonSchema {
    fn insight_content(&self) -> String;
    fn source_location(&self) -> Option<SourceLocation>;
    fn confidence(&self) -> i32;
    fn insight_type(&self) -> Option<model::insight_context::InsightType>;
    fn relevance_keywords(&self) -> Option<Vec<String>>;
}

#[derive(Serialize, Deserialize, Debug, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StructuredInsights<T> {
    pub insights: Vec<T>,
}

pub type EmailInsights = StructuredInsights<EmailInsight>;
// Insights with no source location
pub type Insights = StructuredInsights<Insight>;

impl<T> StructuredInsights<T>
where
    T: InsightType,
{
    #[expect(
        clippy::too_many_arguments,
        reason = "no good reason but too hard to fix right now"
    )]
    pub fn into_insight_records(
        self,
        source: &str,
        user_id: &str,
        default_source_location: Option<SourceLocation>,
        fallback_span_start: Option<DateTime<Utc>>,
        fallback_span_end: Option<DateTime<Utc>>,
        messages_by_id: Option<&HashMap<String, &ParsedMessage>>,
        user_emails: Option<&[String]>,
    ) -> Vec<UserInsightRecord> {
        self.insights
            .into_iter()
            .map(|insight| {
                let now = Utc::now();
                let mut source_location = insight
                    .source_location()
                    .or_else(|| default_source_location.clone());

                // Calculate precise span dates from LLM-specific message IDs
                let (span_start, span_end) = calculate_insight_span_dates(
                    &insight,
                    messages_by_id,
                    fallback_span_start,
                    fallback_span_end,
                );

                // Extract user email addresses from the messages and update source location
                if let Some(emails) = user_emails {
                    let user_email_addresses =
                        calculate_user_email_addresses(&insight, messages_by_id, emails);

                    // Update the source location with user email addresses
                    if let Some(SourceLocation::Email(ref mut email_location)) = source_location {
                        email_location.email_addresses = user_email_addresses;
                    }
                }
                UserInsightRecord {
                    id: None,
                    user_id: user_id.to_string(),
                    confidence: validate_confidence_score(insight.confidence()),
                    content: insight.insight_content(),
                    generated: true,
                    created_at: now,
                    updated_at: now,
                    source: source.to_string(),
                    source_location,
                    span_end,
                    span_start,
                    insight_type: insight.insight_type(),
                    relevance_keywords: insight.relevance_keywords(),
                }
            })
            .collect()
    }
}

/// Validate confidence score is within the valid range (1-5), return None if invalid
fn validate_confidence_score(score: i32) -> Option<i32> {
    if (1..=5).contains(&score) {
        Some(score)
    } else {
        tracing::warn!(
            "Invalid confidence score received from LLM: {}. Expected 1-5, setting to None",
            score
        );
        None
    }
}

/// Calculate precise span dates for an insight based on the specific message IDs the LLM referenced
fn calculate_insight_span_dates<T: InsightType>(
    insight: &T,
    messages_by_id: Option<&HashMap<String, &ParsedMessage>>,
    fallback_span_start: Option<DateTime<Utc>>,
    fallback_span_end: Option<DateTime<Utc>>,
) -> (Option<DateTime<Utc>>, Option<DateTime<Utc>>) {
    // Try to get specific message IDs from the insight if it's an EmailInsight
    (|| {
        let SourceLocation::Email(email_location) = insight.source_location()?;
        let msg_map = messages_by_id?;
        // Calculate span from the specific messages the LLM referenced
        let mut earliest_date: Option<DateTime<Utc>> = None;
        let mut latest_date: Option<DateTime<Utc>> = None;
        for message_id in &email_location.message_ids {
            let Some(ParsedMessage {
                internal_date_ts: Some(date),
                ..
            }) = msg_map.get(message_id)
            else {
                continue;
            };
            earliest_date = Some(earliest_date.map_or(*date, |existing| existing.min(*date)));
            latest_date = Some(latest_date.map_or(*date, |existing| existing.max(*date)));
        }
        // If we found specific dates, use them
        if earliest_date.is_some() || latest_date.is_some() {
            return Some((earliest_date, latest_date));
        }
        None
    })()
    .unwrap_or((fallback_span_start, fallback_span_end))
}

/// Extract user email addresses from messages based on the specific message IDs the LLM referenced
fn calculate_user_email_addresses<T: InsightType>(
    insight: &T,
    messages_by_id: Option<&HashMap<String, &ParsedMessage>>,
    user_emails: &[String],
) -> Option<Vec<String>> {
    // Try to get specific message IDs from the insight if it's an EmailInsight
    let SourceLocation::Email(email_location) = insight.source_location()?;
    let msg_map = messages_by_id?;
    let mut found_user_emails = std::collections::HashSet::new();
    for message_id in &email_location.message_ids {
        let Some(message) = msg_map.get(message_id) else {
            continue;
        };
        // Check from field
        if let Some(from) = &message.from
            && user_emails.contains(&from.email)
        {
            found_user_emails.insert(from.email.clone());
        }
        // Check to, cc, bcc fields
        for contact in &message.to {
            if user_emails.contains(&contact.email) {
                found_user_emails.insert(contact.email.clone());
            }
        }
        for contact in &message.cc {
            if user_emails.contains(&contact.email) {
                found_user_emails.insert(contact.email.clone());
            }
        }
        for contact in &message.bcc {
            if user_emails.contains(&contact.email) {
                found_user_emails.insert(contact.email.clone());
            }
        }
    }
    let mut emails: Vec<String> = found_user_emails.into_iter().collect();
    emails.sort(); // For consistent ordering
    if emails.is_empty() {
        return None;
    }
    Some(emails)
}

impl<T> Metadata for StructuredInsights<T>
where
    T: InsightType,
{
    fn description() -> Option<String> {
        Some("A list of insights generated from log context. Timestamps should always be taken directly from logs".to_string())
    }

    fn name() -> String {
        "Insights_Schema".to_string()
    }
}

#[derive(Serialize, Deserialize, JsonSchema, Debug)]
#[serde(deny_unknown_fields)]
pub struct Insight {
    pub insight_content: String,
    pub earliest_log_timestamp: String,
    pub latest_log_timestamp: String,
    pub confidence: i32,
    pub insight_type: String, // "actionable", "informational", "warning", "trend"
    pub relevance_keywords: Vec<String>,
}

impl InsightType for Insight {
    fn insight_content(&self) -> String {
        self.insight_content.clone()
    }

    fn source_location(&self) -> Option<SourceLocation> {
        None
    }

    fn confidence(&self) -> i32 {
        self.confidence
    }

    fn insight_type(&self) -> Option<model::insight_context::InsightType> {
        parse_insight_type(&self.insight_type)
    }

    fn relevance_keywords(&self) -> Option<Vec<String>> {
        Some(self.relevance_keywords.clone())
    }
}

#[derive(Serialize, Deserialize, JsonSchema, Debug)]
#[serde(deny_unknown_fields)]
pub struct EmailInsight {
    // false if deserialization failed
    pub success: bool,
    pub insight_content: String,
    pub thread_ids: Vec<String>,
    pub message_ids: Vec<String>,
    pub confidence: i32,
    pub insight_type: String, // "actionable", "informational", "warning", "trend"
    pub relevance_keywords: Vec<String>,
}

impl InsightType for EmailInsight {
    fn insight_content(&self) -> String {
        self.insight_content.clone()
    }

    fn source_location(&self) -> Option<SourceLocation> {
        match self.success {
            true => {
                let source_location = EmailSourceLocation {
                    thread_ids: self.thread_ids.clone(),
                    message_ids: self.message_ids.clone(),
                    email_addresses: None,
                };
                Some(SourceLocation::Email(source_location))
            }
            false => None,
        }
    }

    fn confidence(&self) -> i32 {
        self.confidence
    }

    fn insight_type(&self) -> Option<model::insight_context::InsightType> {
        parse_insight_type(&self.insight_type)
    }

    fn relevance_keywords(&self) -> Option<Vec<String>> {
        Some(self.relevance_keywords.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, Utc};
    use models_email::email::service::address::ContactInfo;
    use schemars::JsonSchema;

    // Helper function to create test ParsedMessage
    fn create_test_message(id: &str, internal_date_ts: Option<DateTime<Utc>>) -> ParsedMessage {
        ParsedMessage {
            db_id: uuid::Uuid::parse_str(id).unwrap_or_else(|_| uuid::Uuid::new_v4()),
            link_id: uuid::Uuid::new_v4(),
            thread_db_id: uuid::Uuid::new_v4(),
            subject: Some("Test".to_string()),
            from: None,
            to: vec![],
            cc: vec![],
            bcc: vec![],
            labels: vec![],
            body_parsed: Some("Test body".to_string()),
            internal_date_ts,
        }
    }

    // Mock insight that implements InsightType for testing
    #[derive(serde::Deserialize, JsonSchema)]
    struct MockInsight {
        content: String,
        #[serde(skip)]
        source_location: Option<SourceLocation>,
        #[serde(skip)]
        confidence: Option<i32>,
    }

    impl InsightType for MockInsight {
        fn insight_content(&self) -> String {
            self.content.clone()
        }

        fn source_location(&self) -> Option<SourceLocation> {
            self.source_location.clone()
        }

        fn confidence(&self) -> i32 {
            self.confidence.unwrap_or(3)
        }

        fn insight_type(&self) -> Option<model::insight_context::InsightType> {
            None
        }

        fn relevance_keywords(&self) -> Option<Vec<String>> {
            None
        }
    }

    #[test]
    fn test_calculate_insight_span_dates_with_specific_messages() {
        let date1 = DateTime::parse_from_rfc3339("2023-01-01T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let date2 = DateTime::parse_from_rfc3339("2023-01-02T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let date3 = DateTime::parse_from_rfc3339("2023-01-03T14:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        // Create test messages
        let msg1 = create_test_message("550e8400-e29b-41d4-a716-446655440001", Some(date1));
        let msg2 = create_test_message("550e8400-e29b-41d4-a716-446655440002", Some(date2));
        let msg3 = create_test_message("550e8400-e29b-41d4-a716-446655440003", Some(date3));

        // Create message map
        let mut messages_by_id = HashMap::new();
        messages_by_id.insert(msg1.db_id.to_string(), &msg1);
        messages_by_id.insert(msg2.db_id.to_string(), &msg2);
        messages_by_id.insert(msg3.db_id.to_string(), &msg3);

        // Create insight that references specific messages
        let insight = MockInsight {
            content: "Test insight".to_string(),
            source_location: Some(SourceLocation::Email(EmailSourceLocation {
                thread_ids: vec!["thread1".to_string()],
                message_ids: vec![
                    msg1.db_id.to_string(),
                    msg3.db_id.to_string(), // Skip msg2
                ],
                email_addresses: None,
            })),
            confidence: Some(3),
        };

        let fallback_start = DateTime::parse_from_rfc3339("2022-12-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let fallback_end = DateTime::parse_from_rfc3339("2023-12-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let (start, end) = calculate_insight_span_dates(
            &insight,
            Some(&messages_by_id),
            Some(fallback_start),
            Some(fallback_end),
        );

        // Should use specific messages (msg1 and msg3), not fallback dates
        assert_eq!(start, Some(date1)); // earliest from msg1 and msg3
        assert_eq!(end, Some(date3)); // latest from msg1 and msg3
    }

    #[test]
    fn test_calculate_insight_span_dates_fallback_to_chunk_dates() {
        let fallback_start = DateTime::parse_from_rfc3339("2023-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let fallback_end = DateTime::parse_from_rfc3339("2023-01-31T23:59:59Z")
            .unwrap()
            .with_timezone(&Utc);

        // Create insight with no source location (should use fallback)
        let insight = MockInsight {
            content: "Test insight".to_string(),
            source_location: None,
            confidence: Some(3),
        };

        let (start, end) =
            calculate_insight_span_dates(&insight, None, Some(fallback_start), Some(fallback_end));

        // Should use fallback dates
        assert_eq!(start, Some(fallback_start));
        assert_eq!(end, Some(fallback_end));
    }

    #[test]
    fn test_calculate_insight_span_dates_missing_messages() {
        let date1 = DateTime::parse_from_rfc3339("2023-01-01T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let msg1 = create_test_message("550e8400-e29b-41d4-a716-446655440001", Some(date1));

        let mut messages_by_id = HashMap::new();
        messages_by_id.insert(msg1.db_id.to_string(), &msg1);

        // Create insight that references messages not in the map
        let insight = MockInsight {
            content: "Test insight".to_string(),
            source_location: Some(SourceLocation::Email(EmailSourceLocation {
                thread_ids: vec!["thread1".to_string()],
                message_ids: vec!["nonexistent-message-id".to_string()],
                email_addresses: None,
            })),
            confidence: Some(3),
        };

        let fallback_start = DateTime::parse_from_rfc3339("2022-12-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let fallback_end = DateTime::parse_from_rfc3339("2023-12-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let (start, end) = calculate_insight_span_dates(
            &insight,
            Some(&messages_by_id),
            Some(fallback_start),
            Some(fallback_end),
        );

        // Should fall back to chunk dates since message wasn't found
        assert_eq!(start, Some(fallback_start));
        assert_eq!(end, Some(fallback_end));
    }

    #[test]
    fn test_calculate_insight_span_dates_uses_internal_date() {
        let internal_date = DateTime::parse_from_rfc3339("2023-01-01T08:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        // Message with internal_date_ts
        let msg = create_test_message("550e8400-e29b-41d4-a716-446655440001", Some(internal_date));

        let mut messages_by_id = HashMap::new();
        messages_by_id.insert(msg.db_id.to_string(), &msg);

        let insight = MockInsight {
            content: "Test insight".to_string(),
            source_location: Some(SourceLocation::Email(EmailSourceLocation {
                thread_ids: vec!["thread1".to_string()],
                message_ids: vec![msg.db_id.to_string()],
                email_addresses: None,
            })),
            confidence: Some(3),
        };

        let (start, end) =
            calculate_insight_span_dates(&insight, Some(&messages_by_id), None, None);

        // Should use internal_date_ts
        assert_eq!(start, Some(internal_date));
        assert_eq!(end, Some(internal_date));
    }

    #[test]
    fn test_calculate_insight_span_dates_none_when_no_date() {
        // Message with no timestamp
        let msg = create_test_message("550e8400-e29b-41d4-a716-446655440001", None);

        let mut messages_by_id = HashMap::new();
        messages_by_id.insert(msg.db_id.to_string(), &msg);

        let insight = MockInsight {
            content: "Test insight".to_string(),
            source_location: Some(SourceLocation::Email(EmailSourceLocation {
                thread_ids: vec!["thread1".to_string()],
                message_ids: vec![msg.db_id.to_string()],
                email_addresses: None,
            })),
            confidence: Some(3),
        };

        let fallback_start = DateTime::parse_from_rfc3339("2022-12-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let fallback_end = DateTime::parse_from_rfc3339("2023-12-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let (start, end) = calculate_insight_span_dates(
            &insight,
            Some(&messages_by_id),
            Some(fallback_start),
            Some(fallback_end),
        );

        // Should fall back to chunk dates since message has no timestamp
        assert_eq!(start, Some(fallback_start));
        assert_eq!(end, Some(fallback_end));
    }

    #[test]
    fn test_into_insight_records_integration() {
        let date1 = DateTime::parse_from_rfc3339("2023-01-01T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let date2 = DateTime::parse_from_rfc3339("2023-01-03T14:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let msg1 = create_test_message("550e8400-e29b-41d4-a716-446655440001", Some(date1));
        let msg2 = create_test_message("550e8400-e29b-41d4-a716-446655440002", Some(date2));

        let mut messages_by_id = HashMap::new();
        messages_by_id.insert(msg1.db_id.to_string(), &msg1);
        messages_by_id.insert(msg2.db_id.to_string(), &msg2);

        // Create EmailInsight that references both messages
        let email_insight = EmailInsight {
            insight_content: "Test email insight".to_string(),
            thread_ids: vec!["thread1".to_string()],
            message_ids: vec![msg1.db_id.to_string(), msg2.db_id.to_string()],
            confidence: 4,
            success: true,
            insight_type: "informational".to_string(),
            relevance_keywords: vec!["test".to_string(), "email".to_string()],
        };

        let insights = StructuredInsights {
            insights: vec![email_insight],
        };

        let fallback_start = DateTime::parse_from_rfc3339("2022-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let fallback_end = DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let records = insights.into_insight_records(
            "email",
            "test_user",
            None,
            Some(fallback_start),
            Some(fallback_end),
            Some(&messages_by_id),
            None, // No user emails for this test
        );

        assert_eq!(records.len(), 1);
        let record = &records[0];

        // Should use precise dates from the specific messages, not fallback
        assert_eq!(record.span_start, Some(date1)); // earliest
        assert_eq!(record.span_end, Some(date2)); // latest
        assert_eq!(record.content, "Test email insight");
        assert_eq!(record.source, "email");
        assert_eq!(record.user_id, "test_user");
    }

    #[test]
    fn test_calculate_user_email_addresses() {
        let user_emails = vec![
            "user@example.com".to_string(),
            "user2@example.com".to_string(),
        ];

        // Create test message with user emails in various fields
        let from_contact = ContactInfo {
            email: "user@example.com".to_string(),
            name: Some("User Name".to_string()),
            photo_url: None,
        };
        let to_contact = ContactInfo {
            email: "other@example.com".to_string(),
            name: Some("Other User".to_string()),
            photo_url: None,
        };
        let cc_contact = ContactInfo {
            email: "user2@example.com".to_string(),
            name: Some("User Two".to_string()),
            photo_url: None,
        };

        let msg = ParsedMessage {
            db_id: uuid::Uuid::new_v4(),
            link_id: uuid::Uuid::new_v4(),
            thread_db_id: uuid::Uuid::new_v4(),
            subject: Some("Test Email".to_string()),
            from: Some(from_contact),
            to: vec![to_contact],
            cc: vec![cc_contact],
            bcc: vec![],
            labels: vec![],
            body_parsed: Some("Test body".to_string()),
            internal_date_ts: None,
        };

        // Create message map
        let mut messages_by_id = HashMap::new();
        messages_by_id.insert(msg.db_id.to_string(), &msg);

        // Create insight that references this message
        let insight = MockInsight {
            content: "Test insight".to_string(),
            source_location: Some(SourceLocation::Email(EmailSourceLocation {
                thread_ids: vec!["thread1".to_string()],
                message_ids: vec![msg.db_id.to_string()],
                email_addresses: None,
            })),
            confidence: Some(3),
        };

        // Test the function
        let result = calculate_user_email_addresses(&insight, Some(&messages_by_id), &user_emails);

        // Should find both user emails (from from field and cc field)
        assert!(result.is_some());
        let found_emails = result.unwrap();
        assert_eq!(found_emails.len(), 2);
        assert!(found_emails.contains(&"user@example.com".to_string()));
        assert!(found_emails.contains(&"user2@example.com".to_string()));
    }

    #[test]
    fn test_calculate_user_email_addresses_no_user_emails() {
        let user_emails = vec!["user@example.com".to_string()];

        // Create test message with no user emails
        let from_contact = ContactInfo {
            email: "other@example.com".to_string(),
            name: Some("Other User".to_string()),
            photo_url: None,
        };

        let msg = ParsedMessage {
            db_id: uuid::Uuid::new_v4(),
            link_id: uuid::Uuid::new_v4(),
            thread_db_id: uuid::Uuid::new_v4(),
            subject: Some("Test Email".to_string()),
            from: Some(from_contact),
            to: vec![],
            cc: vec![],
            bcc: vec![],
            labels: vec![],
            body_parsed: Some("Test body".to_string()),
            internal_date_ts: None,
        };

        // Create message map
        let mut messages_by_id = HashMap::new();
        messages_by_id.insert(msg.db_id.to_string(), &msg);

        // Create insight that references this message
        let insight = MockInsight {
            content: "Test insight".to_string(),
            source_location: Some(SourceLocation::Email(EmailSourceLocation {
                thread_ids: vec!["thread1".to_string()],
                message_ids: vec![msg.db_id.to_string()],
                email_addresses: None,
            })),
            confidence: Some(3),
        };

        // Test the function
        let result = calculate_user_email_addresses(&insight, Some(&messages_by_id), &user_emails);

        // Should find no user emails
        assert!(result.is_none());
    }

    #[test]
    fn test_validate_confidence_score() {
        // Valid scores
        assert_eq!(validate_confidence_score(1), Some(1));
        assert_eq!(validate_confidence_score(2), Some(2));
        assert_eq!(validate_confidence_score(3), Some(3));
        assert_eq!(validate_confidence_score(4), Some(4));
        assert_eq!(validate_confidence_score(5), Some(5));

        // Invalid scores
        assert_eq!(validate_confidence_score(0), None);
        assert_eq!(validate_confidence_score(6), None);
        assert_eq!(validate_confidence_score(-1), None);
        assert_eq!(validate_confidence_score(100), None);
    }

    #[test]
    fn test_into_insight_records_with_invalid_confidence() {
        // Create mock insight with invalid confidence
        let insight = MockInsight {
            content: "Test insight with invalid confidence".to_string(),
            source_location: None,
            confidence: Some(10), // Invalid - should become None
        };

        let insights = StructuredInsights {
            insights: vec![insight],
        };

        let records =
            insights.into_insight_records("test", "test_user", None, None, None, None, None);

        assert_eq!(records.len(), 1);
        let record = &records[0];

        // Should have None confidence due to invalid score
        assert_eq!(record.confidence, None);
        assert_eq!(record.content, "Test insight with invalid confidence");
    }
}
