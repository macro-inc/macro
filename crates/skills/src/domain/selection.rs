//! Which of the user's skills a request needs, decided by Jev before an
//! agent's turn.
//!
//! The user's most recently updated skills are the candidates. Jev answers one
//! yes/no question per candidate, built from its "Use when …" description, at
//! most 32 per call, so candidates are split into parallel calls
//! ([`decide_in_batches`]), at most [`MAX_CALLS`]. A skill redirects the
//! agent, so only a confident match loads.

#[cfg(test)]
mod test;

use std::sync::Arc;
use std::time::Duration;

use cognition::domain::{
    Answer, BatchedOutcome, Cognition, MAX_QUESTIONS, RoutingRequest, decide_in_batches,
};
use futures::future::join_all;
use macro_user_id::user_id::MacroUserIdStr;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::domain::model::{SkillError, SkillSummary};
use crate::domain::ports::SkillService;

/// Parallel Jev calls per turn; candidates past `MAX_CALLS * 32` are not
/// routed, and stay reachable through `ReadSkill`.
pub const MAX_CALLS: usize = 8;
/// How long the turn waits for Jev; calls that miss it lose only their own
/// candidates.
const DECISION_DEADLINE: Duration = Duration::from_secs(1);
/// How long the turn waits for the chosen skills' instructions.
const READ_DEADLINE: Duration = Duration::from_secs(1);
/// Skills scoring at least this load, most relevant first, at most
/// [`LOAD_LIMIT`].
const LOAD_THRESHOLD: f32 = 0.8;
const LOAD_LIMIT: usize = 2;
/// A skill created before descriptions existed routes on its name alone, and
/// a generic name ("Brand voice") matches too much, so it loads only when the
/// request all but names it.
const UNDESCRIBED_LOAD_THRESHOLD: f32 = 0.95;
/// Skills scoring at least this, but not loaded, are recorded as suggested.
const SUGGEST_THRESHOLD: f32 = 0.5;
/// Jev's limit on one question.
const MAX_QUESTION_CHARS: usize = 500;

/// A skill chosen for a turn, with its instructions.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedSkill {
    /// The skill document id, or built-in skill id.
    pub id: Uuid,
    /// The skill's display name.
    pub name: String,
    /// Jev's probability that the request needs it.
    pub score: f32,
    /// The skill's full instructions.
    pub content: String,
}

/// How routing ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionStatus {
    /// Jev scored the candidates; nothing loading is a decision too.
    Selected,
    /// There was nothing to ask about.
    NoCandidates,
    /// No cognition service is configured.
    Unconfigured,
    /// The turn was cancelled first.
    Cancelled,
    /// Listing skills or every Jev call failed.
    ProviderError,
    /// No Jev call answered before the deadline.
    Timeout,
}

impl SelectionStatus {
    /// The status as recorded on spans.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Selected => "selected",
            Self::NoCandidates => "no_candidates",
            Self::Unconfigured => "unconfigured",
            Self::Cancelled => "cancelled",
            Self::ProviderError => "provider_error",
            Self::Timeout => "timeout",
        }
    }
}

/// What routing chose for one turn.
#[derive(Debug, Clone, PartialEq)]
pub struct SkillSelection {
    /// Skills Jev was asked about.
    pub candidates: usize,
    /// Skills to load, most relevant first.
    pub loaded: Vec<LoadedSkill>,
    /// Skills that may help but fell short of loading.
    pub suggested: Vec<SkillSummary>,
    /// How routing ended.
    pub status: SelectionStatus,
    /// The highest score any candidate got.
    pub top_score: Option<f32>,
}

impl SkillSelection {
    fn nothing(candidates: usize, status: SelectionStatus) -> Self {
        Self {
            candidates,
            loaded: Vec::new(),
            suggested: Vec::new(),
            status,
            top_score: None,
        }
    }
}

/// Choose the skills a request needs. Never fails: anything that goes wrong
/// loads nothing and says why in the status.
///
/// `already_loaded` skills are in the conversation already and are not asked
/// about again; neither is a skill the request mentions, whose mention
/// carries its id and which the agent reads itself.
#[tracing::instrument(
    name = "agent.skill_selection",
    skip_all,
    fields(
        candidates = tracing::field::Empty,
        loaded = tracing::field::Empty,
        suggested = tracing::field::Empty,
        top_score = tracing::field::Empty,
        bytes = tracing::field::Empty,
        selection_status = tracing::field::Empty,
    )
)]
pub async fn select_skills<Svc: SkillService>(
    service: &Svc,
    cognition: Option<&Arc<dyn Cognition>>,
    user: &MacroUserIdStr<'static>,
    request: RoutingRequest<'_>,
    already_loaded: &[Uuid],
    cancel: &CancellationToken,
) -> SkillSelection {
    let selection = select(service, cognition, user, request, already_loaded, cancel).await;
    let span = tracing::Span::current();
    span.record("candidates", selection.candidates);
    span.record(
        "loaded",
        selection
            .loaded
            .iter()
            .map(|skill| skill.id.to_string())
            .collect::<Vec<_>>()
            .join(","),
    );
    span.record(
        "suggested",
        selection
            .suggested
            .iter()
            .map(|skill| skill.document_id.to_string())
            .collect::<Vec<_>>()
            .join(","),
    );
    if let Some(score) = selection.top_score {
        span.record("top_score", f64::from(score));
    }
    span.record(
        "bytes",
        selection
            .loaded
            .iter()
            .map(|skill| skill.content.len())
            .sum::<usize>(),
    );
    span.record("selection_status", selection.status.as_str());
    selection
}

async fn select<Svc: SkillService>(
    service: &Svc,
    cognition: Option<&Arc<dyn Cognition>>,
    user: &MacroUserIdStr<'static>,
    request: RoutingRequest<'_>,
    already_loaded: &[Uuid],
    cancel: &CancellationToken,
) -> SkillSelection {
    let Some(cognition) = cognition else {
        return SkillSelection::nothing(0, SelectionStatus::Unconfigured);
    };
    let skills = tokio::select! {
        biased;
        _ = cancel.cancelled() => return SkillSelection::nothing(0, SelectionStatus::Cancelled),
        // Boxed, like the read below: a production service's futures are deep
        // enough to overflow the layout of a caller's future that holds them.
        skills = Box::pin(service.list_routable_skills(user)) => skills,
    };
    let skills = match skills {
        Ok(skills) => skills,
        Err(error) => {
            tracing::warn!(error = %error, "could not list skills to route");
            return SkillSelection::nothing(0, SelectionStatus::ProviderError);
        }
    };
    let candidates = candidates(skills, request, already_loaded);
    if candidates.is_empty() {
        return SkillSelection::nothing(0, SelectionStatus::NoCandidates);
    }
    let scores = tokio::select! {
        biased;
        _ = cancel.cancelled() => {
            return SkillSelection::nothing(candidates.len(), SelectionStatus::Cancelled);
        }
        scores = score(cognition.as_ref(), user, request, &candidates) => scores,
    };
    let scores = match scores {
        Ok(scores) => scores,
        Err(status) => return SkillSelection::nothing(candidates.len(), status),
    };
    let top_score = scores.iter().map(|(_, score)| *score).reduce(f32::max);
    let (chosen, suggested) = choose(scores);
    let loaded = tokio::select! {
        biased;
        _ = cancel.cancelled() => {
            return SkillSelection::nothing(candidates.len(), SelectionStatus::Cancelled);
        }
        loaded = read(service, user, chosen) => loaded,
    };
    SkillSelection {
        candidates: candidates.len(),
        loaded,
        suggested,
        status: SelectionStatus::Selected,
        top_score,
    }
}

/// The routable skills not already in the conversation, in the order listed
/// (most recently updated first), up to what [`MAX_CALLS`] can ask about.
fn candidates(
    skills: Vec<SkillSummary>,
    request: RoutingRequest<'_>,
    already_loaded: &[Uuid],
) -> Vec<SkillSummary> {
    let mut candidates: Vec<SkillSummary> = skills
        .into_iter()
        .filter(|skill| !already_loaded.contains(&skill.document_id))
        .filter(|skill| !request.latest.contains(&skill.document_id.to_string()))
        .collect();
    candidates.truncate(MAX_CALLS * MAX_QUESTIONS);
    candidates
}

/// Every candidate's score from the calls that answered by the deadline, or
/// why none did.
async fn score(
    cognition: &dyn Cognition,
    user: &MacroUserIdStr<'static>,
    request: RoutingRequest<'_>,
    candidates: &[SkillSummary],
) -> Result<Vec<(SkillSummary, f32)>, SelectionStatus> {
    let input = request.decision_input("request");
    let questions: Vec<String> = candidates.iter().map(question).collect();
    let decision = decide_in_batches(&input, &questions, DECISION_DEADLINE, |request| {
        cognition.decide(user, request)
    })
    .await;

    match decision.outcome() {
        BatchedOutcome::Answered => {}
        BatchedOutcome::TimedOut => return Err(SelectionStatus::Timeout),
        BatchedOutcome::Failed => return Err(SelectionStatus::ProviderError),
    }

    Ok(candidates
        .iter()
        .zip(decision.answers)
        .filter_map(|(skill, answer)| match answer {
            Answer::Probability(score) if score.is_finite() => Some((skill.clone(), score)),
            Answer::Probability(_) | Answer::Failed | Answer::TimedOut => None,
        })
        .collect())
}

fn question(skill: &SkillSummary) -> String {
    let question = match &skill.description {
        Some(description) => format!(
            "Would the skill \"{}\" help with this request? {description}",
            skill.name
        ),
        None => format!("Would the skill \"{}\" help with this request?", skill.name),
    };
    clip(&question, MAX_QUESTION_CHARS)
}

fn clip(text: &str, chars: usize) -> String {
    text.chars().take(chars).collect()
}

/// The skills to load, and skills worth recording as suggested, each most
/// relevant first.
fn choose(mut scores: Vec<(SkillSummary, f32)>) -> (Vec<(SkillSummary, f32)>, Vec<SkillSummary>) {
    scores.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then_with(|| a.0.document_id.cmp(&b.0.document_id))
    });
    let mut chosen = Vec::new();
    let mut suggested = Vec::new();
    for (skill, score) in scores {
        let threshold = if skill.description.is_some() {
            LOAD_THRESHOLD
        } else {
            UNDESCRIBED_LOAD_THRESHOLD
        };
        if score >= threshold && chosen.len() < LOAD_LIMIT {
            chosen.push((skill, score));
        } else if score >= SUGGEST_THRESHOLD {
            suggested.push(skill);
        }
    }
    (chosen, suggested)
}

/// Read the chosen skills' instructions; a skill that cannot be read in time
/// is left out.
async fn read<Svc: SkillService>(
    service: &Svc,
    user: &MacroUserIdStr<'static>,
    chosen: Vec<(SkillSummary, f32)>,
) -> Vec<LoadedSkill> {
    let reads = chosen.iter().map(|(skill, _)| async {
        tokio::time::timeout(
            READ_DEADLINE,
            Box::pin(service.read_skill(user, skill.document_id)),
        )
        .await
        .unwrap_or_else(|_| {
            Err(SkillError::ReadFailed(anyhow::anyhow!(
                "reading the skill took too long"
            )))
        })
    });
    let contents = join_all(reads).await;
    chosen
        .into_iter()
        .zip(contents)
        .filter_map(|((skill, score), content)| match content {
            Ok(content) => Some(LoadedSkill {
                id: skill.document_id,
                name: content.name,
                score,
                content: content.content,
            }),
            Err(error) => {
                tracing::warn!(error = %error, skill_id = %skill.document_id, "could not read a routed skill");
                None
            }
        })
        .collect()
}

/// Loaded skills as one tagged block for the turn's context; empty when none
/// are loaded.
pub fn render_loaded(skills: &[LoadedSkill]) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let mut section = String::from(
        "<loaded_skills>\nThese of the user's skills were loaded because this request needs them. Follow each where the request calls for it, and only there.\n",
    );
    for skill in skills {
        section.push_str(&format!(
            "<skill name=\"{}\" id=\"{}\">\n{}\n</skill>\n",
            escape_attribute(&skill.name),
            skill.id,
            skill.content.trim_end()
        ));
    }
    section.push_str("</loaded_skills>");
    section
}

fn escape_attribute(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
