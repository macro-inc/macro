use ai::{
    structured_output_v2::structured_completion_v2,
    types::{MessageBuilder, RequestBuilder},
};
use anyhow::{Context, Result};
use async_stream::stream;
use chrono::{DateTime, Utc};
use futures::stream::{FuturesUnordered, Stream, StreamExt};
use macro_db_client::insight::user::create_insights;
use model::insight_context::EmailSourceLocation;
use model::insight_context::{
    SourceLocation, UserInsightRecord, email_insights::EMAIL_INSIGHT_PROVIDER_SOURCE_NAME,
};
use models_email::email::service::message::ParsedMessage;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use tokio::{pin, sync::Semaphore, task::JoinHandle};

use crate::{
    context::ServiceContext,
    insight::consumer::INSIGHT_MODEL,
    insight::deduplication::{DeduplicationConfig, InsightDeduplicator},
};
use macro_db_client::insight::user::get_user_insights;

use super::EmailInsights;
use super::shared_prompts::{
    CLASSIFICATION_TYPES_PROMPT, CONFIDENCE_SCORING_PROMPT, KEYWORDS_PROMPT,
};
use crate::context::InsightScribe;

pub const MAX_CONCURRENT_AI_REQUESTS: usize = 4;
pub const MAX_CONCURRENT_THREAD_REQUESTS: usize = 3;
const CHAT_COMPLETION_REQUEST_MAX_TOKENS: usize = 32_000;
const MAX_MESSAGES_PER_THREAD_BATCH: usize = 50; // Smaller batches, max is 100 in email service
const MAX_THREADS_IN_MEMORY: usize = 10; // Limit concurrent threads in memory
const MAX_CHARS_PER_EMAIL_PROMPT: usize = 32_000; // Your existing limit

fn build_email_insights_system_prompt(user_emails: &[String]) -> String {
    format!(
        r#"You are an intelligent internal tool that analyzes user behavior to find patterns. You will be provided
a concatenated list of a user's email threads and you will find insights in these threads.
The user in question is identified by their email address(es) and their user id.
The user's email address(es) which you will use to identify this user is/are: [{}].
Insights are one to three sentences describing user preferences, or who the user is as a person.
You need not generate an insight for every message. You should combine similar ideas into a single user insight.
Use the email thread id and message id (both are standard UUIDs) to identify the insight source location.
An insight source location is a list of thread ids and a list of message ids,
and can have multiple thread ids and message ids (if necessary).
Try to keep insights to a single thread unless you feel they are relevant to multiple threads.
Generally, you should generate insights across multiple messages in a thread.
Insights should be atomic in nature, do not try to combine too much information into a single insight.
If you are unsure if an insight is relevant to the user, prioritize adding it to the insight list.
Remember, if there are no useful insights, return an empty list of insights (not null or omitted).

{}

{}

{}
When specifying a source location (if any), use this format:
{{{{
    "threadIds": ["uuid-string-1", "uuid-string-2"],
    "messageIds": ["uuid-string-3"],
    "confidence": 3,
    "success": true,
    "insightType": "actionable",
    "relevanceKeywords": ["email", "project", "deadline"]
}}}}

All fields must be present, and all IDs must be strings (even if they look like numbers or UUIDs).
"#,
        user_emails.join(", "),
        CONFIDENCE_SCORING_PROMPT,
        CLASSIFICATION_TYPES_PROMPT,
        KEYWORDS_PROMPT
    )
}

pub fn new_thread_processor(
    service_context: Arc<ServiceContext>,
    user_id: String,
    user_emails: &[String],
) -> ThreadProcessor {
    let system_prompt = build_email_insights_system_prompt(user_emails);
    tracing::debug!("Building thread processor for: {}", user_id);
    ThreadProcessor {
        service_context,
        fetch_semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_THREAD_REQUESTS)),
        ai_semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_AI_REQUESTS)),
        system_prompt,
        user_id,
        user_emails: user_emails.to_vec(),
    }
}

pub struct ThreadProcessor {
    pub service_context: Arc<ServiceContext>,
    pub fetch_semaphore: Arc<Semaphore>,
    pub ai_semaphore: Arc<Semaphore>,
    pub system_prompt: String,
    pub user_id: String,
    pub user_emails: Vec<String>,
}

impl ThreadProcessor {
    /// Process threads with enhanced deduplication against existing insights
    pub async fn process_threads_streaming_with_deduplication(
        &self,
        thread_ids: &[String],
    ) -> Result<Vec<String>> {
        let mut all_insight_records = Vec::new();
        let thread_chunks = thread_ids.chunks(MAX_THREADS_IN_MEMORY);

        for thread_chunk in thread_chunks {
            tracing::debug!(?thread_chunk, "Processing thread chunk with deduplication");
            let chunk_results = self.process_thread_chunk(thread_chunk).await?;
            all_insight_records.extend(chunk_results);
        }

        // Get existing insights for deduplication (limit to recent insights for performance)
        let existing_insights = get_user_insights(
            &self.service_context.macro_db,
            &self.user_id,
            Some(true),
            1000,
            0,
        )
        .await
        .context("Failed to fetch existing insights for deduplication")?;

        // Deduplicate insights using email-specific configuration
        let original_count = all_insight_records.len();
        let deduplicated_insights = if !all_insight_records.is_empty() {
            let deduplication_config = DeduplicationConfig {
                exact_match_enabled: true,
                semantic_similarity_threshold: 0.80, // Lower threshold for emails
                edit_distance_threshold: 15,
                source_location_weight: 0.4, // Higher weight for email source overlap
                confidence_weight: 0.1,
                llm_fallback_enabled: true, // Enable LLM for email edge cases
            };

            let deduplicator = InsightDeduplicator::new(deduplication_config);
            deduplicator
                .deduplicate_insights(&all_insight_records, &existing_insights)
                .await
                .context("Failed to deduplicate thread insights")?
        } else {
            all_insight_records
        };

        tracing::info!(
            original_count = original_count,
            existing_count = existing_insights.len(),
            deduplicated_count = deduplicated_insights.len(),
            "Thread insight deduplication completed"
        );

        // Create insights from deduplicated records
        let ids = if !deduplicated_insights.is_empty() {
            tracing::debug!(
                "Creating {} deduplicated insights in DB",
                deduplicated_insights.len()
            );
            create_insights(
                &self.service_context.macro_db,
                &deduplicated_insights,
                &self.user_id,
            )
            .await?
        } else {
            tracing::debug!("No insights to create after deduplication");
            vec![]
        };

        Ok(ids)
    }

    /// Process messages with enhanced deduplication against existing insights
    pub async fn process_messages_streaming_with_deduplication(
        &self,
        message_thread_ids: &[(String, String)], // message_id, thread_id
    ) -> Result<Vec<String>> {
        let mut all_insight_records = Vec::new();
        let mut thread_messages_map: HashMap<String, Vec<String>> = HashMap::new();

        for (message_id, thread_id) in message_thread_ids {
            thread_messages_map
                .entry(thread_id.clone())
                .or_default()
                .push(message_id.clone());
        }

        let thread_messages = thread_messages_map.into_iter().collect::<Vec<_>>();
        let thread_message_chunks = thread_messages.chunks(MAX_THREADS_IN_MEMORY);

        for thread_message_chunk in thread_message_chunks {
            tracing::debug!(
                ?thread_message_chunk,
                "Processing messages chunk with deduplication"
            );
            let chunk_results = self.process_messages_chunk(thread_message_chunk).await?;
            all_insight_records.extend(chunk_results);
        }

        // Get existing insights for deduplication (limit to recent insights for performance)
        let existing_insights = get_user_insights(
            &self.service_context.macro_db,
            &self.user_id,
            Some(true),
            1000,
            0,
        )
        .await
        .context("Failed to fetch existing insights for deduplication")?;

        // Deduplicate insights using email-specific configuration
        let original_count = all_insight_records.len();
        let deduplicated_insights = if !all_insight_records.is_empty() {
            let deduplication_config = DeduplicationConfig {
                exact_match_enabled: true,
                semantic_similarity_threshold: 0.80, // Lower threshold for emails
                edit_distance_threshold: 15,
                source_location_weight: 0.4, // Higher weight for email source overlap
                confidence_weight: 0.1,
                llm_fallback_enabled: true, // Enable LLM for email edge cases
            };

            let deduplicator = InsightDeduplicator::new(deduplication_config);
            deduplicator
                .deduplicate_insights(&all_insight_records, &existing_insights)
                .await
                .context("Failed to deduplicate message insights")?
        } else {
            all_insight_records
        };

        tracing::info!(
            original_count = original_count,
            existing_count = existing_insights.len(),
            deduplicated_count = deduplicated_insights.len(),
            "Message insight deduplication completed"
        );

        // Create insights from deduplicated records
        let ids = if !deduplicated_insights.is_empty() {
            tracing::debug!(
                "Creating {} deduplicated insights in DB",
                deduplicated_insights.len()
            );
            create_insights(
                &self.service_context.macro_db,
                &deduplicated_insights,
                &self.user_id,
            )
            .await?
        } else {
            tracing::debug!("No insights to create after deduplication");
            vec![]
        };

        Ok(ids)
    }

    async fn process_thread_chunk(&self, thread_ids: &[String]) -> Result<Vec<UserInsightRecord>> {
        let mut chunker = MessageChunker::new(MAX_CHARS_PER_EMAIL_PROMPT);
        let mut ai_futures = FuturesUnordered::new();
        let mut all_records = Vec::new();
        let stream_thread_fetcher = StreamingThreadFetcher {
            content_client: self.service_context.content_client.clone(),
            semaphore: self.fetch_semaphore.clone(),
        };

        // Process each thread as a stream
        for thread_id in thread_ids {
            tracing::debug!(%thread_id, "Fetching messages for thread");
            let thread_stream = stream_thread_fetcher
                .fetch_thread_stream(thread_id.clone())
                .await?;

            pin!(thread_stream);

            // Process thread messages in batches
            while let Some(batch_result) = thread_stream.next().await {
                let messages = batch_result?;
                tracing::debug!(%thread_id, batch_size = messages.len(), "Fetched message batch");

                for message in messages {
                    tracing::debug!(%thread_id, msg_id = %message.db_id, "Adding message to chunk");
                    // Try to add message to current chunk
                    if let Some(ready_chunk) = chunker.try_add_message(thread_id, &message) {
                        tracing::debug!(
                            chunk_size = ready_chunk.content.len(),
                            thread_ids = ?ready_chunk.thread_ids,
                            "Emitting chunk for AI processing"
                        );
                        // Process the ready chunk
                        let future = self.process_chunk(ready_chunk, false).await;
                        ai_futures.push(future);

                        // Limit concurrent AI requests
                        if ai_futures.len() >= MAX_CONCURRENT_AI_REQUESTS
                            && let Some(result) = ai_futures.next().await
                        {
                            match result? {
                                Ok(Some(records)) => all_records.extend(records),
                                Ok(None) => {} // No insights generated
                                Err(e) => tracing::warn!("Insight generation failed: {:?}", e),
                            }
                        }
                    }
                }
            }
        }

        // Process final chunk if any
        if let Some(final_chunk) = chunker.finalize() {
            tracing::debug!(
                chunk_size = final_chunk.content.len(),
                thread_ids = ?final_chunk.thread_ids,
                "Emitting final chunk for AI processing"
            );
            let future = self.process_chunk(final_chunk, false).await;
            ai_futures.push(future);
        }

        // Collect remaining results
        while let Some(result) = ai_futures.next().await {
            match result? {
                Ok(Some(records)) => all_records.extend(records),
                Ok(None) => {} // No insights generated
                Err(e) => tracing::warn!("Insight generation failed: {:?}", e),
            }
        }

        Ok(all_records)
    }

    async fn process_messages_chunk(
        &self,
        thread_messages: &[(String, Vec<String>)], // thread_id, message_ids
    ) -> Result<Vec<UserInsightRecord>> {
        let mut chunker = MessageChunker::new(MAX_CHARS_PER_EMAIL_PROMPT);
        let mut ai_futures = FuturesUnordered::new();
        let mut all_records = Vec::new();
        let stream_thread_fetcher = StreamingThreadFetcher {
            content_client: self.service_context.content_client.clone(),
            semaphore: self.fetch_semaphore.clone(),
        };

        // Process each thread as a stream
        for (thread_id, message_ids) in thread_messages {
            tracing::debug!(%thread_id, "Fetching messages for thread");
            let thread_stream = stream_thread_fetcher
                .fetch_messages_stream(message_ids.clone())
                .await?;

            pin!(thread_stream);

            // Process thread messages in batches
            while let Some(batch_result) = thread_stream.next().await {
                let messages = batch_result?;
                tracing::debug!(%thread_id, batch_size = messages.len(), "Fetched message batch");

                for message in messages {
                    tracing::debug!(%thread_id, msg_id = %message.db_id, "Adding message to chunk");
                    // Try to add message to current chunk
                    if let Some(ready_chunk) = chunker.try_add_message(thread_id, &message) {
                        tracing::debug!(
                            chunk_size = ready_chunk.content.len(),
                            thread_ids = ?ready_chunk.thread_ids,
                            "Emitting chunk for AI processing"
                        );
                        // Process the ready chunk
                        let future = self.process_chunk(ready_chunk, true).await;
                        ai_futures.push(future);

                        // Limit concurrent AI requests
                        if ai_futures.len() >= MAX_CONCURRENT_AI_REQUESTS
                            && let Some(result) = ai_futures.next().await
                        {
                            match result? {
                                Ok(Some(records)) => all_records.extend(records),
                                Ok(None) => {} // No insights generated
                                Err(e) => tracing::warn!("Insight generation failed: {:?}", e),
                            }
                        }
                    }
                }
            }
        }

        // Process final chunk if any
        if let Some(final_chunk) = chunker.finalize() {
            tracing::debug!(
                chunk_size = final_chunk.content.len(),
                thread_ids = ?final_chunk.thread_ids,
                "Emitting final chunk for AI processing"
            );
            let future = self.process_chunk(final_chunk, true).await;
            ai_futures.push(future);
        }

        // Collect remaining results
        while let Some(result) = ai_futures.next().await {
            match result? {
                Ok(Some(records)) => all_records.extend(records),
                Ok(None) => {} // No insights generated
                Err(e) => tracing::warn!("Insight generation failed: {:?}", e),
            }
        }

        Ok(all_records)
    }

    async fn process_chunk(
        &self,
        chunk: ChunkReady,
        use_message_ids: bool, // insert message IDs into default source location
    ) -> JoinHandle<Result<Option<Vec<UserInsightRecord>>>> {
        let permit = self.ai_semaphore.clone().acquire_owned().await.unwrap();
        let system_prompt = self.system_prompt.clone();
        let user_id = self.user_id.clone();
        let user_emails = self.user_emails.clone();

        tracing::debug!(
            chunk_size = chunk.content.len(),
            thread_ids = ?chunk.thread_ids,
            "Creating default source location for chunk"
        );
        let default_source_location = Some(SourceLocation::Email(EmailSourceLocation {
            thread_ids: chunk.thread_ids.clone().into_iter().collect(),
            message_ids: if use_message_ids {
                chunk.message_ids.clone().into_iter().collect()
            } else {
                vec![]
            },
            email_addresses: None, // Will be populated by into_insight_records
        }));

        tracing::debug!("Spawning AI request for chunk");
        tokio::spawn(async move {
            let _permit = permit;
            match generate_email_insights_from_prompt(system_prompt, chunk.content).await {
                Ok(insights) if !insights.insights.is_empty() => {
                    tracing::debug!("AI returned {} insights", insights.insights.len());

                    // Build message map for precise span calculation
                    let messages_by_id: std::collections::HashMap<String, &ParsedMessage> = chunk
                        .messages
                        .iter()
                        .map(|msg| (msg.db_id.to_string(), msg))
                        .collect();

                    Ok(Some(insights.into_insight_records(
                        EMAIL_INSIGHT_PROVIDER_SOURCE_NAME,
                        &user_id,
                        default_source_location,
                        chunk.span_start,
                        chunk.span_end,
                        Some(&messages_by_id),
                        Some(&user_emails),
                    )))
                }
                Ok(_) => {
                    tracing::debug!("AI returned no insights");
                    Ok(None)
                }
                Err(e) => {
                    tracing::error!("Insight generation failed: {:?}", e);
                    Ok(None)
                }
            }
        })
    }
}

struct StreamingThreadFetcher {
    content_client: InsightScribe,
    semaphore: Arc<Semaphore>,
}

impl StreamingThreadFetcher {
    async fn fetch_thread_stream(
        &self,
        thread_id: String,
    ) -> Result<impl Stream<Item = Result<Vec<ParsedMessage>>>> {
        let content_client = self.content_client.clone();
        let semaphore = self.semaphore.clone();

        Ok(stream! {
            let _permit = semaphore.acquire().await.unwrap();
            let mut offset = 0;

            loop {
                match content_client
                    .email
                    .get_email_messages_by_thread_id(&thread_id, offset, MAX_MESSAGES_PER_THREAD_BATCH as i64, None)
                    .await
                {
                    Ok(messages) => {
                        if messages.is_empty() {
                            break;
                        }

                        let message_count = messages.len();
                        offset += message_count as i64;
                        yield Ok(messages);

                        // If we got fewer than requested, we're done
                        if message_count < MAX_MESSAGES_PER_THREAD_BATCH {
                            break;
                        }
                    }
                    Err(e) => {
                        yield Err(anyhow::anyhow!("Failed to get email messages by thread ID: {}", e));
                        break;
                    }
                }
            }
        })
    }

    async fn fetch_messages_stream(
        &self,
        message_ids: Vec<String>,
    ) -> Result<impl Stream<Item = Result<Vec<ParsedMessage>>>> {
        let content_client = self.content_client.clone();
        let semaphore = self.semaphore.clone();

        Ok(stream! {
            let _permit = semaphore.acquire().await.unwrap();
            let message_ids_chunks = message_ids.chunks(MAX_MESSAGES_PER_THREAD_BATCH);

            for message_ids_chunk in message_ids_chunks {
                tracing::debug!(?message_ids_chunk, "Processing message IDs chunk");
                let message_ids_chunk_owned: Vec<String> = message_ids_chunk.to_vec();
                let batch_result = content_client
                    .email
                    .get_email_messages_by_id_batch(&message_ids_chunk_owned, None)
                    .await;
                match batch_result {
                    Ok(messages) => {
                        yield Ok(messages);
                    }
                    Err(e) => {
                        yield Err(anyhow::anyhow!("Failed to get email messages by ID batch: {}", e));
                        break;
                    }
                }
            }
        })
    }
}

struct MessageChunker {
    current_chunk: String,
    current_size: usize,
    current_thread_ids: HashSet<String>,
    current_message_ids: HashSet<String>,
    max_size: usize,
    earliest_date: Option<DateTime<Utc>>,
    latest_date: Option<DateTime<Utc>>,
    current_messages: Vec<ParsedMessage>,
}

struct ChunkReady {
    content: String,
    thread_ids: HashSet<String>,
    message_ids: HashSet<String>,
    span_start: Option<DateTime<Utc>>,
    span_end: Option<DateTime<Utc>>,
    messages: Vec<ParsedMessage>,
}

impl MessageChunker {
    fn new(max_size: usize) -> Self {
        Self {
            current_chunk: String::new(),
            current_size: 0,
            current_thread_ids: HashSet::new(),
            current_message_ids: HashSet::new(),
            max_size,
            earliest_date: None,
            latest_date: None,
            current_messages: Vec::new(),
        }
    }

    fn try_add_message(&mut self, thread_id: &str, message: &ParsedMessage) -> Option<ChunkReady> {
        let formatted_msg = format_message(thread_id, message);
        let msg_size = formatted_msg.len();
        let msg_date = message.internal_date_ts;

        // If adding this message would exceed limit and we have content, emit chunk
        if self.current_size + msg_size > self.max_size && !self.current_chunk.is_empty() {
            let chunk = ChunkReady {
                content: std::mem::take(&mut self.current_chunk),
                thread_ids: std::mem::take(&mut self.current_thread_ids),
                message_ids: std::mem::take(&mut self.current_message_ids),
                span_start: self.earliest_date,
                span_end: self.latest_date,
                messages: std::mem::take(&mut self.current_messages),
            };
            self.current_size = 0;

            // Reset date tracking for new chunk with this message
            self.earliest_date = msg_date;
            self.latest_date = msg_date;

            // Start new chunk with this message
            self.current_chunk = formatted_msg;
            self.current_size = msg_size;
            self.current_thread_ids.insert(thread_id.to_string());
            self.current_message_ids.insert(message.db_id.to_string());
            self.current_messages.push(message.clone());

            return Some(chunk);
        }

        // Add to current chunk and update date tracking
        self.current_chunk.push_str(&formatted_msg);
        self.current_size += msg_size;
        self.current_thread_ids.insert(thread_id.to_string());
        self.current_message_ids.insert(message.db_id.to_string());
        self.current_messages.push(message.clone());

        // Update date tracking with this message's timestamp
        if let Some(date) = msg_date {
            self.earliest_date = Some(
                self.earliest_date
                    .map_or(date, |existing| existing.min(date)),
            );
            self.latest_date = Some(self.latest_date.map_or(date, |existing| existing.max(date)));
        }

        None
    }

    fn finalize(self) -> Option<ChunkReady> {
        if self.current_chunk.is_empty() {
            None
        } else {
            Some(ChunkReady {
                content: self.current_chunk,
                thread_ids: self.current_thread_ids,
                message_ids: self.current_message_ids,
                span_start: self.earliest_date,
                span_end: self.latest_date,
                messages: self.current_messages,
            })
        }
    }
}

fn clean_text(text: &str) -> String {
    text.chars()
        .filter(|c| {
            // Remove various Unicode control and formatting characters
            !matches!(*c,
                // Zero-width characters
                '\u{200B}' | // Zero Width Space
                '\u{200C}' | // Zero Width Non-Joiner
                '\u{200D}' | // Zero Width Joiner
                '\u{2060}' | // Word Joiner
                '\u{FEFF}' | // Zero Width No-Break Space (BOM)

                // Directional marks
                '\u{200E}' | // Left-to-Right Mark
                '\u{200F}' | // Right-to-Left Mark
                '\u{202A}' | // Left-to-Right Embedding
                '\u{202B}' | // Right-to-Left Embedding
                '\u{202C}' | // Pop Directional Formatting
                '\u{202D}' | // Left-to-Right Override
                '\u{202E}' | // Right-to-Left Override
                '\u{2066}' | // Left-to-Right Isolate
                '\u{2067}' | // Right-to-Left Isolate
                '\u{2068}' | // First Strong Isolate
                '\u{2069}' | // Pop Directional Isolate

                // Other control characters
                '\u{00AD}' | // Soft Hyphen
                '\u{034F}' | // Combining Grapheme Joiner
                '\u{061C}' | // Arabic Letter Mark
                '\u{180E}' | // Mongolian Vowel Separator
                '\u{2028}' | // Line Separator
                '\u{2029}' | // Paragraph Separator

                // Variation selectors (can cause display issues)
                '\u{FE00}'..='\u{FE0F}' | // Variation Selectors 1-16
                '\u{E0100}'..='\u{E01EF}'  // Variation Selectors 17-256
            )
        })
        // Also collapse multiple whitespace into single spaces
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

fn format_message(thread_id: &str, msg: &ParsedMessage) -> String {
    let mut msg_text = String::new();
    msg_text.push_str("---\n");
    msg_text.push_str(&format!("Thread id: {}\n", thread_id));
    msg_text.push_str(&format!("Message id: {}\n", msg.db_id));

    if let Some(subject) = &msg.subject {
        msg_text.push_str(&format!("Subject: {}\n", subject));
    }

    if let Some(from) = &msg.from {
        msg_text.push_str(&format!(
            "From: {} <{}>\n",
            from.name.clone().unwrap_or_default(),
            from.email
        ));
    }

    if !msg.to.is_empty() {
        let tos = msg
            .to
            .iter()
            .map(|c| format!("{} <{}>", c.name.clone().unwrap_or_default(), c.email))
            .collect::<Vec<_>>()
            .join(", ");
        msg_text.push_str(&format!("To: {}\n", tos));
    }

    if !msg.cc.is_empty() {
        let ccs = msg
            .cc
            .iter()
            .map(|c| format!("{} <{}>", c.name.clone().unwrap_or_default(), c.email))
            .collect::<Vec<_>>()
            .join(", ");
        msg_text.push_str(&format!("CC: {}\n", ccs));
    }

    if !msg.bcc.is_empty() {
        let bccs = msg
            .bcc
            .iter()
            .map(|c| format!("{} <{}>", c.name.clone().unwrap_or_default(), c.email))
            .collect::<Vec<_>>()
            .join(", ");
        msg_text.push_str(&format!("BCC: {}\n", bccs));
    }

    if !msg.labels.is_empty() {
        let labels = msg
            .labels
            .iter()
            .map(|l| l.name.clone())
            .collect::<Vec<_>>()
            .join(", ");
        msg_text.push_str(&format!("Labels: {}\n", labels));
    }

    if let Some(body) = &msg.body_parsed {
        let cleaned_body = clean_text(body);
        let truncated_body = if cleaned_body.len() > MAX_CHARS_PER_EMAIL_PROMPT / 2 {
            format!(
                "{}... [truncated, original length: {} chars]",
                &cleaned_body[..MAX_CHARS_PER_EMAIL_PROMPT / 2],
                cleaned_body.len()
            )
        } else {
            cleaned_body
        };
        msg_text.push_str(&format!("Body: {}\n", truncated_body));
    } else {
        tracing::warn!("No body found for message {:?}", msg);
    }

    msg_text
}

async fn generate_email_insights_from_prompt(
    system_prompt: String,
    prompt: String,
) -> anyhow::Result<EmailInsights> {
    let request = RequestBuilder::new()
        .max_tokens(CHAT_COMPLETION_REQUEST_MAX_TOKENS as u32)
        .system_prompt(system_prompt)
        .model(INSIGHT_MODEL)
        .messages(vec![MessageBuilder::new().user().content(prompt).build()])
        .build();

    let insights = structured_completion_v2::<EmailInsights>(request)
        .await
        .context("Generate new email user insights")?;

    tracing::debug!(?insights, "email insight generation insights");

    Ok(insights)
}

#[cfg(test)]
mod email_tests {
    use super::*;
    use model::insight_context::{EmailSourceLocation, SourceLocation};

    #[derive(Default, Clone)]
    struct TestParsedMessage {
        pub db_id: String,
        pub body_parsed: Option<String>,
    }

    fn make_test_parsed_message(thread_id: &str, db_id: &str) -> (String, TestParsedMessage) {
        (
            thread_id.to_string(),
            TestParsedMessage {
                db_id: db_id.to_string(),
                body_parsed: Some("Test body".to_string()),
            },
        )
    }

    #[test]
    fn test_chunking_and_default_source_location() {
        // Simulate two threads, each with two messages
        let all_messages = vec![
            make_test_parsed_message("thread1", "msg1"),
            make_test_parsed_message("thread1", "msg2"),
            make_test_parsed_message("thread2", "msg3"),
            make_test_parsed_message("thread2", "msg4"),
        ];

        // Simulate chunking logic (small chunk size to force two chunks)
        let max_chars = 60; // small for test
        let mut chunker = MessageChunker {
            current_chunk: String::new(),
            current_size: 0,
            current_thread_ids: HashSet::new(),
            current_message_ids: HashSet::new(),
            max_size: max_chars,
            earliest_date: None,
            latest_date: None,
            current_messages: Vec::new(),
        };
        let mut chunks = Vec::new();
        for (thread_id, msg) in &all_messages {
            let formatted_msg = format!(
                "Thread id: {}\nMessage id: {}\nBody: {}\n",
                thread_id,
                msg.db_id,
                msg.body_parsed.as_deref().unwrap_or("")
            );
            let msg_size = formatted_msg.len();
            if chunker.current_size + msg_size > chunker.max_size
                && !chunker.current_chunk.is_empty()
            {
                chunks.push(ChunkReady {
                    content: std::mem::take(&mut chunker.current_chunk),
                    thread_ids: std::mem::take(&mut chunker.current_thread_ids),
                    message_ids: std::mem::take(&mut chunker.current_message_ids),
                    span_start: None,
                    span_end: None,
                    messages: std::mem::take(&mut chunker.current_messages),
                });
                chunker.current_size = 0;
            }
            chunker.current_chunk.push_str(&formatted_msg);
            chunker.current_size += msg_size;
            chunker.current_thread_ids.insert(thread_id.clone());
        }
        if !chunker.current_chunk.is_empty() {
            chunks.push(ChunkReady {
                content: chunker.current_chunk,
                thread_ids: chunker.current_thread_ids,
                message_ids: chunker.current_message_ids,
                span_start: None,
                span_end: None,
                messages: chunker.current_messages,
            });
        }

        // For each chunk, collect thread_ids and check default_source_location
        for chunk in &chunks {
            let default_source_location = SourceLocation::Email(EmailSourceLocation {
                thread_ids: chunk.thread_ids.clone().into_iter().collect(),
                message_ids: vec![],
                email_addresses: None,
            });
            // The chunk should only contain messages from the threads in thread_ids
            for tid in &chunk.thread_ids {
                assert!(
                    default_source_location
                        .as_email()
                        .unwrap()
                        .thread_ids
                        .contains(tid)
                );
            }
            // The default_source_location should include all thread_ids in the chunk
            let SourceLocation::Email(email_loc) = &default_source_location;
            assert!(email_loc.thread_ids.len() >= 1);
            for tid in &email_loc.thread_ids {
                assert!(chunk.thread_ids.contains(tid));
            }
        }
    }

    // Helper for matching SourceLocation::Email
    trait AsEmail {
        fn as_email(&self) -> Option<&EmailSourceLocation>;
    }
    impl AsEmail for SourceLocation {
        fn as_email(&self) -> Option<&EmailSourceLocation> {
            let SourceLocation::Email(e) = self;
            Some(e)
        }
    }

    #[test]
    fn test_message_chunker_date_tracking() {
        use chrono::{DateTime, Utc};

        // Create test messages with different timestamps
        let earlier_date = DateTime::parse_from_rfc3339("2023-01-01T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let later_date = DateTime::parse_from_rfc3339("2023-01-03T14:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let msg1 = ParsedMessage {
            db_id: uuid::Uuid::new_v4(),
            link_id: uuid::Uuid::new_v4(),
            thread_db_id: uuid::Uuid::new_v4(),
            subject: Some("Test 1".to_string()),
            from: None,
            to: vec![],
            cc: vec![],
            bcc: vec![],
            labels: vec![],
            body_parsed: Some("Body 1".to_string()),
            internal_date_ts: Some(earlier_date),
        };

        let msg2 = ParsedMessage {
            db_id: uuid::Uuid::new_v4(),
            link_id: uuid::Uuid::new_v4(),
            thread_db_id: uuid::Uuid::new_v4(),
            subject: Some("Test 2".to_string()),
            from: None,
            to: vec![],
            cc: vec![],
            bcc: vec![],
            labels: vec![],
            body_parsed: Some("Body 2".to_string()),
            internal_date_ts: Some(later_date),
        };

        let mut chunker = MessageChunker::new(1000); // Large size to fit both messages

        // Add first message
        let result1 = chunker.try_add_message("thread1", &msg1);
        assert!(result1.is_none()); // Should not chunk yet

        // Add second message
        let result2 = chunker.try_add_message("thread1", &msg2);
        assert!(result2.is_none()); // Should still not chunk

        // Finalize the chunk
        let final_chunk = chunker.finalize().unwrap();

        // Check date tracking
        assert_eq!(final_chunk.span_start, Some(earlier_date)); // earliest: msg1.internal_date_ts
        assert_eq!(final_chunk.span_end, Some(later_date)); // latest: msg2.internal_date_ts
        assert_eq!(final_chunk.messages.len(), 2);
    }

    #[test]
    fn test_message_chunker_forces_chunk_with_dates() {
        use chrono::{DateTime, Utc};

        let date1 = DateTime::parse_from_rfc3339("2023-01-01T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let date2 = DateTime::parse_from_rfc3339("2023-01-02T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let date3 = DateTime::parse_from_rfc3339("2023-01-03T14:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let create_message = |id: &str, date: DateTime<Utc>| ParsedMessage {
            db_id: uuid::Uuid::new_v4(),
            link_id: uuid::Uuid::new_v4(),
            thread_db_id: uuid::Uuid::new_v4(),
            subject: Some(format!("Test {}", id)),
            from: None,
            to: vec![],
            cc: vec![],
            bcc: vec![],
            labels: vec![],
            body_parsed: Some(format!(
                "Very long body content for message {} that will exceed the chunk size limit",
                id
            )),
            internal_date_ts: Some(date),
        };

        let msg1 = create_message("1", date1);
        let msg2 = create_message("2", date2);
        let msg3 = create_message("3", date3);

        let mut chunker = MessageChunker::new(150); // Small size to force chunking

        // Add messages and expect chunking
        let chunk1 = chunker.try_add_message("thread1", &msg1);
        assert!(chunk1.is_none()); // First message fits

        let chunk2 = chunker.try_add_message("thread1", &msg2);
        assert!(chunk2.is_some()); // Should trigger chunk due to size

        let emitted_chunk = chunk2.unwrap();
        assert_eq!(emitted_chunk.span_start, Some(date1));
        assert_eq!(emitted_chunk.span_end, Some(date1)); // Only msg1 in this chunk
        assert_eq!(emitted_chunk.messages.len(), 1); // Only msg1 message in chunk content

        // Add third message (might trigger another chunk due to size)
        let chunk3 = chunker.try_add_message("thread1", &msg3);

        if chunk3.is_some() {
            // msg3 triggered another chunk, so msg2 is alone in the second chunk
            let second_chunk = chunk3.unwrap();
            assert_eq!(second_chunk.span_start, Some(date2)); // msg2 only
            assert_eq!(second_chunk.span_end, Some(date2));
            assert_eq!(second_chunk.messages.len(), 1);

            // msg3 should be in the final chunk
            let final_chunk = chunker.finalize().unwrap();
            assert_eq!(final_chunk.span_start, Some(date3)); // msg3 only
            assert_eq!(final_chunk.span_end, Some(date3));
            assert_eq!(final_chunk.messages.len(), 1);
        } else {
            // msg3 fit with msg2 in the same chunk
            let final_chunk = chunker.finalize().unwrap();
            assert_eq!(final_chunk.span_start, Some(date2)); // msg2 and msg3
            assert_eq!(final_chunk.span_end, Some(date3));
            assert_eq!(final_chunk.messages.len(), 2);
        }
    }
}
