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
