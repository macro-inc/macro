//! AI-backed implementation of [`CallSummarizer`](crate::domain::ports::CallSummarizer).
//!
//! Wraps the [`ai`] crate's `get_chat_completion` entry point to generate a
//! natural-language summary of a finished call from its finalized transcript.
//! No external client handle is required — [`ai::chat_completion::get_chat_completion`]
//! internally constructs its own provider client (see the `memory` crate's
//! `judge_memory` for the same pattern this mirrors).

use std::fmt::Write as _;

use ai::chat_completion::get_chat_completion;
use ai::types::{Model, RequestBuilder};
use uuid::Uuid;

use crate::domain::models::CallRecordTranscriptSegment;
use crate::domain::ports::CallSummarizer;

/// Default model used when summarizing a call transcript.
const SUMMARIZATION_MODEL: Model = Model::Claude46Sonnet;

/// System prompt framing the LLM's task: produce a concise, factual call summary.
const SUMMARIZATION_SYSTEM_PROMPT: &str = "\
You are a meeting-notes assistant. Given the transcript of a voice or video \
call, write a concise, factual summary that captures:
- The main topics discussed.
- Key decisions that were made.
- Action items or follow-ups, including who owns them when stated.
- Any notable context that would help someone who missed the call catch up.

Rules:
- Write in plain prose, using short paragraphs or bullet points where \
  appropriate. No markdown headings.
- Do not speculate or invent content that is not in the transcript.
- If the transcript is empty or uninformative, say so briefly rather than \
  fabricating content.
- Respond with only the summary text — no preamble, no sign-off.";

/// System prompt for naming a call from its summary. Kept tight so the model
/// returns a bare title instead of a sentence.
const CALL_NAME_SYSTEM_PROMPT: &str = "\
You write short titles for recorded calls based on their summary. \
Output a single title — 3 to 6 words, Title Case, no punctuation, no \
quotes, no preamble, no sign-off. The title should reflect the main \
topic of the call; if the summary is empty or uninformative, respond \
with `Untitled Call`.";

/// Maximum characters of summary text we send to the naming model. The
/// summary is already concise; this is a safety cap so a runaway summary
/// does not blow up the prompt.
const CALL_NAME_SUMMARY_CHAR_CAP: usize = 4_000;

/// Hard cap on the title returned to callers. Anything longer is truncated
/// at a word boundary — protects the DB column / UI from misbehaving model
/// output regardless of the system prompt.
const CALL_NAME_MAX_CHARS: usize = 80;

/// AI-powered [`CallSummarizer`] that delegates to
/// [`ai::chat_completion::get_chat_completion`].
///
/// Stateless on purpose: the underlying `ai` crate builds its provider client
/// per request, so this adapter does not need to cache one. Construct once at
/// service startup and share via the [`CallSummarizer`] trait.
#[derive(Debug, Default, Clone, Copy)]
pub struct AiCallSummarizer;

impl AiCallSummarizer {
    /// Create a new [`AiCallSummarizer`].
    pub fn new() -> Self {
        Self
    }
}

impl CallSummarizer for AiCallSummarizer {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self, transcript), fields(segment_count = transcript.len()), err)]
    async fn summarize_call(
        &self,
        call_id: &Uuid,
        transcript: Vec<CallRecordTranscriptSegment>,
    ) -> Result<String, Self::Err> {
        let user_message = format_transcript_prompt(call_id, &transcript);

        let request = RequestBuilder::new()
            .model(SUMMARIZATION_MODEL)
            .system_prompt(SUMMARIZATION_SYSTEM_PROMPT)
            .user_message(user_message)
            .build();

        get_chat_completion(request)
            .await
            .map_err(|e| anyhow::anyhow!(e))
            .inspect_err(|e| {
                tracing::error!(error = ?e, %call_id, "ai call summarization failed");
            })
    }

    #[tracing::instrument(skip(self, summary), fields(summary_len = summary.len()), err)]
    async fn generate_call_name(&self, call_id: &Uuid, summary: &str) -> Result<String, Self::Err> {
        let trimmed_summary = summary.trim();
        if trimmed_summary.is_empty() {
            return Ok("Untitled Call".to_string());
        }

        let summary_for_prompt: &str = if trimmed_summary.len() > CALL_NAME_SUMMARY_CHAR_CAP {
            let mut end = CALL_NAME_SUMMARY_CHAR_CAP;
            while end > 0 && !trimmed_summary.is_char_boundary(end) {
                end -= 1;
            }
            &trimmed_summary[..end]
        } else {
            trimmed_summary
        };

        let user_message = format!(
            "Call {call_id} summary follows. Produce a title per the rules in \
             the system prompt.\n\n{summary_for_prompt}"
        );

        let request = RequestBuilder::new()
            .model(SUMMARIZATION_MODEL)
            .system_prompt(CALL_NAME_SYSTEM_PROMPT)
            .user_message(user_message)
            .build();

        let raw = get_chat_completion(request)
            .await
            .map_err(|e| anyhow::anyhow!(e))
            .inspect_err(|e| {
                tracing::error!(error = ?e, %call_id, "ai call naming failed");
            })?;

        Ok(sanitize_call_name(&raw))
    }
}

#[cfg(test)]
mod test;

/// Trim quotes/whitespace, normalize internal whitespace, and clamp to
/// [`CALL_NAME_MAX_CHARS`] at a word boundary so the persisted name is
/// well-formed regardless of model output.
fn sanitize_call_name(raw: &str) -> String {
    let trimmed = raw
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'' || c == '`')
        .trim();
    let normalized = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");

    if normalized.is_empty() {
        return "Untitled Call".to_string();
    }

    if normalized.chars().count() <= CALL_NAME_MAX_CHARS {
        return normalized;
    }

    let mut taken = String::with_capacity(CALL_NAME_MAX_CHARS);
    for ch in normalized.chars().take(CALL_NAME_MAX_CHARS) {
        taken.push(ch);
    }
    // Cut back to the last whitespace so we don't end mid-word.
    if let Some(idx) = taken.rfind(char::is_whitespace) {
        taken.truncate(idx);
    }
    taken.trim_end().to_string()
}

/// Render the transcript as a chronological, speaker-labeled block suitable
/// for inclusion in an LLM user message. Segments are expected to already be
/// ordered by `sequence_num` ascending; we preserve that order verbatim.
fn format_transcript_prompt(call_id: &Uuid, transcript: &[CallRecordTranscriptSegment]) -> String {
    if transcript.is_empty() {
        return format!(
            "Call {call_id} has no transcript segments. Produce a one-line \
             summary noting that the call has no transcribed content."
        );
    }

    // Rough pre-allocation: each segment typically renders on one line.
    let mut buf = String::with_capacity(transcript.len() * 64);
    let _ = writeln!(
        buf,
        "Transcript for call {call_id} (one line per segment, format: `speaker: text`):\n"
    );
    for segment in transcript {
        // `write!` into `String` never fails; discard the `fmt::Result`.
        let _ = writeln!(buf, "{}: {}", segment.speaker_id, segment.content);
    }
    let _ = write!(
        buf,
        "\nWrite a concise summary of this call following the rules in the system prompt."
    );
    buf
}
