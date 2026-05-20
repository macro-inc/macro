//! AI-backed implementation of [`CallSummarizer`](crate::domain::ports::CallSummarizer).
//!
//! Wraps the [`ai`] crate's `get_chat_completion` entry point to generate a
//! natural-language summary of a finished call from its finalized transcript.
//! No external client handle is required — [`ai::chat_completion::get_chat_completion`]
//! internally constructs its own provider client (see the `memory` crate's
//! `judge_memory` for the same pattern this mirrors).

use std::collections::HashSet;
use std::fmt::Write as _;

use ai::chat_completion::get_chat_completion;
use ai::types::{Model, RequestBuilder};
use uuid::Uuid;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{
    CallRecordTranscriptSegment, CallTranscriptCustomSpeakerResult, EnrichedCallTranscript,
};
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
- The first sentence MUST jump straight into substance — a topic, a decision, \
  a participant, or a concrete update. No scene-setting, no framing, no \
  characterizing the meeting itself.
- Forbidden openers include (but are not limited to) any sentence that \
  describes what kind of call it was, who it was for, the tone of the call, \
  or the transcript/recording itself. Examples of openers to NEVER produce: \
  `This was a [standup/sync/intro/team] call...`, `This call was...`, \
  `The meeting was...`, `This transcript...`, `The transcript...`, `The \
  call...`, `In this call...`, `The recording...`, `[Team] held a...`, \
  `[Team] met to discuss...`. Skip the throat-clearing and lead with the \
  meat.
- No markdown headings of any kind. That includes `#`/`##` headings AND \
  bold-as-heading lines like `**Technical Updates**` or `**Action Items**` \
  used to label a section. Use short paragraphs or bullet points only.
- Write in plain prose.
- Do not speculate or invent content that is not in the transcript.
- If the transcript is empty, contains only fragmented or incoherent speech, \
  or otherwise has no useful information to summarize, respond with exactly \
  the single token `NULL` and nothing else. Do not produce a summary that \
  merely states the transcript is uninformative — return `NULL` instead.
- Respond with only the summary text — no preamble, no sign-off.";

/// Sentinel the model is asked to emit when the transcript has no useful
/// content to summarize. Mapped to `None` so the caller skips persisting a
/// summary at all (rather than writing a placeholder \"transcript is
/// uninformative\" line).
const NULL_SUMMARY_SENTINEL: &str = "NULL";

/// System prompt for naming a call from its summary. Kept tight so the model
/// returns a bare title instead of a sentence.
const CALL_NAME_SYSTEM_PROMPT: &str = "\
You generate short titles for recorded calls from a written summary of the \
call. The title is shown in a list of past calls, so it must be specific \
enough to distinguish one call from another at a glance.

Output requirements:
- A single title, 4 to 8 words, in Title Case (capitalize every word except \
  articles, prepositions, and conjunctions of 3 letters or fewer).
- No surrounding quotes, no trailing punctuation, no preamble, no sign-off.
- Internal punctuation (colons, hyphens, ampersands, apostrophes) is allowed \
  when it improves readability.
- Prefer concrete topics and proper nouns drawn from the summary — people, \
  companies, projects, products — over generic words like `Meeting`, \
  `Discussion`, or `Call`.
- If the summary indicates the call had no substantive content (silence, \
  test call, accidental recording, empty transcript), output exactly: \
  UNTITLED_CALL

Examples:
Summary: `Alex and Priya reviewed Q3 marketing spend and agreed to cut paid \
search by 20% next quarter.` → `Q3 Marketing Spend Review`
Summary: `Standup with the platform team. Blocked on the Postgres upgrade; \
Sam will follow up with infra.` → `Platform Standup: Postgres Upgrade Blocker`
Summary: `Intro call between Jordan (Macro) and Lee (Acme) about a possible \
SSO integration.` → `Macro & Acme SSO Intro Call`
Summary: `No speech detected in the transcript.` → `UNTITLED_CALL`";

/// System prompt for assigning archived transcript rows to known Macro users.
const CUSTOM_SPEAKER_SYSTEM_PROMPT: &str = "\
You assign speakers in archived call transcript rows to Macro user ids. You are \
given JSON transcript rows from the `call_record_transcripts` table and a JSON \
array of candidate Macro user ids. Your job is to infer the actual speaker for \
each row only when the transcript content and surrounding context make that \
attribution clear.

Rules:
- Output strictly valid JSON and nothing else.
- The JSON must be an array of objects with exactly these keys: \
  `call_transcript_id` and `custom_speaker`.
- `call_transcript_id` must be the `id` value from an input transcript row.
- `custom_speaker` must be one of the candidate Macro user ids exactly.
- Return an entry only when you are confident. If unsure, omit that row.
- If you cannot confidently identify any speaker, return exactly `[]`.
- Do not invent users, do not use display names, and do not include reasons.";

/// Sentinel the model is asked to emit when the summary has no substantive
/// content. Mapped to `None` so the caller leaves the existing name untouched.
const UNTITLED_CALL_SENTINEL: &str = "UNTITLED_CALL";

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
    ) -> Result<Option<String>, Self::Err> {
        let user_message = format_transcript_prompt(call_id, &transcript);

        let request = RequestBuilder::new()
            .model(SUMMARIZATION_MODEL)
            .system_prompt(SUMMARIZATION_SYSTEM_PROMPT)
            .user_message(user_message)
            .build();

        let raw = get_chat_completion(request)
            .await
            .map_err(|e| anyhow::anyhow!(e))
            .inspect_err(|e| {
                tracing::error!(error = ?e, %call_id, "ai call summarization failed");
            })?;

        Ok(parse_summary(&raw))
    }

    #[tracing::instrument(skip(self, summary), fields(summary_len = summary.len()), err)]
    async fn generate_call_name(
        &self,
        call_id: &Uuid,
        summary: &str,
    ) -> Result<Option<String>, Self::Err> {
        let trimmed_summary = summary.trim();
        if trimmed_summary.is_empty() {
            return Ok(None);
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

        let user_message = format!("Summary:\n\n{summary_for_prompt}");

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

    #[tracing::instrument(
        skip(self, transcript, candidate_speakers),
        fields(segment_count = transcript.len(), candidate_count = candidate_speakers.len()),
        err
    )]
    async fn generate_custom_speakers(
        &self,
        transcript: Vec<EnrichedCallTranscript>,
        candidate_speakers: Vec<MacroUserIdStr<'static>>,
    ) -> Result<Vec<CallTranscriptCustomSpeakerResult>, Self::Err> {
        if transcript.is_empty() || candidate_speakers.is_empty() {
            return Ok(Vec::new());
        }

        let transcript_ids: HashSet<Uuid> = transcript.iter().map(|row| row.id).collect();
        let candidate_user_ids: HashSet<String> = candidate_speakers
            .iter()
            .map(|user_id| user_id.as_ref().to_string())
            .collect();
        let user_message = format_custom_speakers_prompt(&transcript, &candidate_speakers);

        let request = RequestBuilder::new()
            .model(SUMMARIZATION_MODEL)
            .system_prompt(CUSTOM_SPEAKER_SYSTEM_PROMPT)
            .user_message(user_message)
            .build();

        let raw = get_chat_completion(request)
            .await
            .map_err(|e| anyhow::anyhow!(e))
            .inspect_err(|e| {
                tracing::error!(error = ?e, "ai custom-speaker generation failed");
            })?;

        parse_custom_speaker_results(&raw, &transcript_ids, &candidate_user_ids)
    }
}

#[cfg(test)]
mod test;

/// Map a raw summary completion to `Some(text)` or `None`.
///
/// Trims whitespace and surrounding quotes/backticks. Returns `None` when
/// the model emitted [`NULL_SUMMARY_SENTINEL`] (case-insensitive, with or
/// without surrounding quotes/whitespace) or when sanitization left
/// nothing usable. The caller treats `None` as "do not persist a summary".
fn parse_summary(raw: &str) -> Option<String> {
    let trimmed = raw
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'' || c == '`')
        .trim();

    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case(NULL_SUMMARY_SENTINEL) {
        return None;
    }

    Some(trimmed.to_string())
}

/// Trim quotes/whitespace, normalize internal whitespace, and clamp to
/// [`CALL_NAME_MAX_CHARS`] at a word boundary. Returns `None` when the model
/// emitted [`UNTITLED_CALL_SENTINEL`] or sanitization left nothing usable, so
/// the caller can leave the existing call name untouched.
fn sanitize_call_name(raw: &str) -> Option<String> {
    let trimmed = raw
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'' || c == '`')
        .trim();
    let normalized = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");

    if normalized.is_empty() || normalized.eq_ignore_ascii_case(UNTITLED_CALL_SENTINEL) {
        return None;
    }

    if normalized.chars().count() <= CALL_NAME_MAX_CHARS {
        return Some(normalized);
    }

    let mut taken = String::with_capacity(CALL_NAME_MAX_CHARS);
    for ch in normalized.chars().take(CALL_NAME_MAX_CHARS) {
        taken.push(ch);
    }
    // Cut back to the last whitespace so we don't end mid-word.
    if let Some(idx) = taken.rfind(char::is_whitespace) {
        taken.truncate(idx);
    }
    let cut = taken.trim_end().to_string();
    if cut.is_empty() { None } else { Some(cut) }
}

/// Render archived transcript rows and candidate speakers for the speaker
/// attribution prompt.
fn format_custom_speakers_prompt(
    transcript: &[EnrichedCallTranscript],
    candidate_speakers: &[MacroUserIdStr<'static>],
) -> String {
    let candidate_user_ids: Vec<&str> = candidate_speakers
        .iter()
        .map(|user_id| user_id.as_ref())
        .collect();
    let transcript_json =
        serde_json::to_string_pretty(transcript).unwrap_or_else(|_| "[]".to_string());
    let candidate_json =
        serde_json::to_string_pretty(&candidate_user_ids).unwrap_or_else(|_| "[]".to_string());

    format!(
        "Candidate Macro user ids:\n{candidate_json}\n\nArchived transcript rows:\n{transcript_json}\n\nReturn only the JSON array of confident custom speaker assignments."
    )
}

/// Parse and validate model output for custom-speaker attribution.
fn parse_custom_speaker_results(
    raw: &str,
    valid_transcript_ids: &HashSet<Uuid>,
    candidate_user_ids: &HashSet<String>,
) -> anyhow::Result<Vec<CallTranscriptCustomSpeakerResult>> {
    let json = extract_json_array(raw)?;
    let parsed: Vec<CallTranscriptCustomSpeakerResult> = serde_json::from_str(json)?;
    let mut seen_transcript_ids = HashSet::new();
    let mut results = Vec::with_capacity(parsed.len());

    for result in parsed {
        if !valid_transcript_ids.contains(&result.call_transcript_id) {
            continue;
        }

        let Ok(normalized_user_id) = MacroUserIdStr::try_from(result.custom_speaker) else {
            continue;
        };
        let normalized_custom_speaker = normalized_user_id.as_ref().to_string();
        if !candidate_user_ids.contains(&normalized_custom_speaker)
            || !seen_transcript_ids.insert(result.call_transcript_id)
        {
            continue;
        }

        results.push(CallTranscriptCustomSpeakerResult {
            call_transcript_id: result.call_transcript_id,
            custom_speaker: normalized_custom_speaker,
        });
    }

    Ok(results)
}

/// Extract the first JSON array from a model response.
fn extract_json_array(raw: &str) -> anyhow::Result<&str> {
    let trimmed = raw.trim();
    let Some(start) = trimmed.find('[') else {
        anyhow::bail!("custom speaker response did not contain a JSON array");
    };
    let Some(end) = trimmed.rfind(']') else {
        anyhow::bail!("custom speaker response did not contain a complete JSON array");
    };
    if end < start {
        anyhow::bail!("custom speaker response had malformed JSON array bounds");
    }
    Ok(&trimmed[start..=end])
}

/// Render the transcript as a chronological, speaker-labeled block suitable
/// for inclusion in an LLM user message. Segments are expected to already be
/// ordered by `sequence_num` ascending; we preserve that order verbatim.
fn format_transcript_prompt(call_id: &Uuid, transcript: &[CallRecordTranscriptSegment]) -> String {
    if transcript.is_empty() {
        return format!(
            "Call {call_id} has no transcript segments. Per the system prompt, \
             respond with exactly the single token NULL."
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
