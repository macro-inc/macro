/*
    A generic insight generator reference implementation
    This implementation may be good enough to use with may context sources but testing is needed
*/

use crate::context::ServiceContext;
use crate::insight::consumer::{INSIGHT_MODEL, Insights};
use crate::insight::deduplication::{DeduplicationConfig, InsightDeduplicator};
use ai::structured_output_v2::structured_completion_v2;
use ai::types::{MessageBuilder, RequestBuilder};
use ai_format::InsightContextLog;
use anyhow::{Context, Result};
use model::insight_context::UserInsightRecord;
use std::fmt::Display;
use std::sync::Arc;

use super::email_processing::new_thread_processor;
use super::shared_prompts::{
    CLASSIFICATION_TYPES_PROMPT, CONFIDENCE_SCORING_PROMPT, KEYWORDS_PROMPT,
};

static CHAT_COMPLETION_REQUEST_MAX_TOKENS: usize = 32_000;

fn build_base_prompt() -> String {
    format!(
        r#"You are an intelligent internal tool that analyzes user behavior to find patterns. You will be provided
user logs and you will find insights in these logs. Insights are one to three sentences describing user preferences,
or who the user is as a person. You need not generate an insight for every log. You should combine similar logs into a single
user insight.

{}

{}

{}
The logs you are analyzing are:
    "#,
        CONFIDENCE_SCORING_PROMPT, CLASSIFICATION_TYPES_PROMPT, KEYWORDS_PROMPT
    )
}

pub async fn generate_insights<T>(
    source: &str,
    user_id: &str,
    log_description: &'static str, // a description of the logs being generated over
    context: InsightContextLog<T>,
    existing_insights: &[UserInsightRecord],
) -> Result<Vec<UserInsightRecord>>
where
    T: Display + Sized,
{
    //1. generate insights for current context
    let base_prompt = build_base_prompt();
    let prompt = format!("{} {}", base_prompt, log_description);
    let existing_insights_string = existing_insights
        .iter()
        .map(|insight| insight.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    let log_string = context.to_string();
    let context_string = format!(
        "These are existing insights about the user: {existing_insights_string}\nCONTEXT LOGS\n{log_string}"
    );

    let request = RequestBuilder::new()
        .max_tokens(CHAT_COMPLETION_REQUEST_MAX_TOKENS as u32)
        .system_prompt(prompt)
        .model(INSIGHT_MODEL)
        .messages(vec![
            MessageBuilder::new().user().content(context_string).build(),
        ])
        .build();

    let insights = structured_completion_v2::<Insights>(request)
        .await
        .context("Generate new user insights")?;

    let new_insights = insights.into_insight_records(source, user_id, None, None, None, None, None);

    // 2. deduplicate insights using efficient multi-layer approach
    let deduplication_config = DeduplicationConfig {
        exact_match_enabled: true,
        semantic_similarity_threshold: 0.85,
        edit_distance_threshold: 10,
        source_location_weight: 0.3,
        confidence_weight: 0.2,
        llm_fallback_enabled: false, // Disable LLM fallback for general insights
    };
    let deduplicator = InsightDeduplicator::new(deduplication_config);
    let deduplicated_insights = deduplicator
        .deduplicate_insights(&new_insights, existing_insights)
        .await
        .context("Failed to deduplicate insights")?;

    tracing::debug!(
        new_count = new_insights.len(),
        existing_count = existing_insights.len(),
        deduplicated_count = deduplicated_insights.len(),
        "Insight deduplication completed"
    );

    Ok(deduplicated_insights)
}

#[tracing::instrument(skip(service_context))]
pub async fn generate_email_insights_for_threads(
    service_context: Arc<ServiceContext>,
    user_id: &str,
    user_emails: &[String],
    thread_ids: &[String],
) -> Result<Vec<String>> {
    let processor = new_thread_processor(service_context, user_id.to_string(), user_emails);
    processor
        .process_threads_streaming_with_deduplication(thread_ids)
        .await
}

#[tracing::instrument(skip(service_context))]
pub async fn generate_email_insights_for_messages(
    service_context: Arc<ServiceContext>,
    user_id: &str,
    user_emails: &[String],
    message_thread_ids: &[(String, String)], // message_id, thread_id
) -> Result<Vec<String>> {
    let processor = new_thread_processor(service_context, user_id.to_string(), user_emails);
    processor
        .process_messages_streaming_with_deduplication(message_thread_ids)
        .await
}
