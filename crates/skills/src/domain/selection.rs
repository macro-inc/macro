//! Which skills a request needs, decided by Jev before an agent's turn.
//!
//! Every skill the user can read is a candidate, built-ins first. Jev answers
//! one yes/no question per candidate, at most 32 per call, so candidates are
//! split into parallel calls, at most [`MAX_CALLS`]. Built-ins load on less
//! confidence than user skills: they are reviewed text, while a user skill
//! redirects the agent and costs more when loaded by mistake.

#[cfg(test)]
mod test;

use std::sync::Arc;
use std::time::Duration;

use cognition::domain::{Cognition, DecisionRequest};
use futures::future::join_all;
use macro_user_id::user_id::MacroUserIdStr;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::domain::model::{SkillError, SkillSummary};
use crate::domain::ports::SkillService;

/// Questions Jev answers in one call.
const QUESTIONS_PER_CALL: usize = 32;
/// Parallel Jev calls per turn; candidates past `MAX_CALLS * 32` are not
/// routed, and stay reachable through `ReadSkill`.
pub const MAX_CALLS: usize = 8;
/// How long the turn waits for Jev.
const DECISION_DEADLINE: Duration = Duration::from_secs(1);
/// How long the turn waits for the chosen skills' instructions.
const READ_DEADLINE: Duration = Duration::from_secs(1);
/// Built-ins scoring at least this load, at most [`BUILTIN_LIMIT`]. 0.7 kept
/// recall at 0.5's (90%) on the evaluation while loading the exact expected
/// set almost twice as often (`agent_inmem` `route_evaluation`).
const BUILTIN_THRESHOLD: f32 = 0.7;
const BUILTIN_LIMIT: usize = 3;
/// User skills scoring at least this load, at most [`USER_LIMIT`].
const USER_THRESHOLD: f32 = 0.8;
const USER_LIMIT: usize = 2;
/// User skills scoring at least this, but not loaded, are suggested by name.
const SUGGEST_THRESHOLD: f32 = 0.5;
/// Jev's limits on one question and on the request text it reads.
const MAX_QUESTION_CHARS: usize = 500;
const MAX_REQUEST_CHARS: usize = 8000;

/// The user's words the turn answers.
#[derive(Debug, Clone, Copy)]
pub struct SkillRequest<'a> {
    /// The newest user message.
    pub latest: &'a str,
    /// The user message before it, so a follow-up such as "now do it for Q3"
    /// keeps the skill the conversation is using.
    pub previous: Option<&'a str>,
}

/// A skill chosen for a turn, with its instructions.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedSkill {
    /// The skill document id, or built-in skill id.
    pub id: Uuid,
    /// The skill's display name.
    pub name: String,
    /// Whether it is a built-in skill.
    pub builtin: bool,
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
    /// Jev did not answer before the deadline.
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
    /// User skills that may help but fell short of loading.
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
        loaded_builtin = tracing::field::Empty,
        loaded_user = tracing::field::Empty,
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
    request: SkillRequest<'_>,
    already_loaded: &[Uuid],
    cancel: &CancellationToken,
) -> SkillSelection {
    let selection = select(service, cognition, user, request, already_loaded, cancel).await;
    let span = tracing::Span::current();
    let ids = |builtin: bool| {
        selection
            .loaded
            .iter()
            .filter(|skill| skill.builtin == builtin)
            .map(|skill| skill.id.to_string())
            .collect::<Vec<_>>()
            .join(",")
    };
    span.record("candidates", selection.candidates);
    span.record("loaded_builtin", ids(true));
    span.record("loaded_user", ids(false));
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
    request: SkillRequest<'_>,
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
    let scored = tokio::select! {
        biased;
        _ = cancel.cancelled() => {
            return SkillSelection::nothing(candidates.len(), SelectionStatus::Cancelled);
        }
        scored = tokio::time::timeout(DECISION_DEADLINE, score(cognition.as_ref(), user, request, &candidates)) => scored,
    };
    let scores = match scored {
        Ok(Some(scores)) => scores,
        Ok(None) => {
            return SkillSelection::nothing(candidates.len(), SelectionStatus::ProviderError);
        }
        Err(_) => return SkillSelection::nothing(candidates.len(), SelectionStatus::Timeout),
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

/// Routable skills, built-ins first, then the user's most recently updated,
/// without those already in the conversation, up to what [`MAX_CALLS`] can
/// ask about.
fn candidates(
    skills: Vec<SkillSummary>,
    request: SkillRequest<'_>,
    already_loaded: &[Uuid],
) -> Vec<SkillSummary> {
    let (mut builtins, users): (Vec<_>, Vec<_>) = skills
        .into_iter()
        .filter(|skill| !already_loaded.contains(&skill.document_id))
        .filter(|skill| {
            let id = skill.document_id.to_string();
            !request.latest.contains(&id)
        })
        .partition(|skill| system_skills::is_system_skill(skill.document_id));
    builtins.extend(users);
    builtins.truncate(MAX_CALLS * QUESTIONS_PER_CALL);
    builtins
}

/// Every candidate's score, or `None` when no call succeeded.
async fn score(
    cognition: &dyn Cognition,
    user: &MacroUserIdStr<'static>,
    request: SkillRequest<'_>,
    candidates: &[SkillSummary],
) -> Option<Vec<(SkillSummary, f32)>> {
    let mut input = serde_json::json!({ "request": clip(request.latest, MAX_REQUEST_CHARS) });
    if let Some(previous) = request.previous {
        input["previousRequest"] = clip(previous, MAX_REQUEST_CHARS).into();
    }
    let calls = candidates.chunks(QUESTIONS_PER_CALL).map(|chunk| {
        let request = DecisionRequest {
            input: input.clone(),
            questions: chunk
                .iter()
                .map(|skill| (skill.document_id.to_string(), question(skill)))
                .collect(),
        };
        cognition.decide(user, request)
    });
    let answers = join_all(calls).await;
    let mut scores = Vec::new();
    let mut answered = false;
    for answer in answers {
        match answer {
            Ok(answer) => {
                answered = true;
                scores.extend(answer.probabilities.into_iter().filter_map(|(key, score)| {
                    let skill = candidates
                        .iter()
                        .find(|skill| skill.document_id.to_string() == key)?;
                    score.is_finite().then(|| (skill.clone(), score))
                }));
            }
            Err(error) => tracing::warn!(error = %error, "Jev could not route skills"),
        }
    }
    answered.then_some(scores)
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

/// The skills to load, and user skills worth suggesting instead, each most
/// relevant first.
fn choose(mut scores: Vec<(SkillSummary, f32)>) -> (Vec<(SkillSummary, f32)>, Vec<SkillSummary>) {
    scores.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then_with(|| a.0.document_id.cmp(&b.0.document_id))
    });
    let mut chosen = Vec::new();
    let mut suggested = Vec::new();
    let (mut builtins, mut users) = (0, 0);
    for (skill, score) in scores {
        if system_skills::is_system_skill(skill.document_id) {
            if score >= BUILTIN_THRESHOLD && builtins < BUILTIN_LIMIT {
                builtins += 1;
                chosen.push((skill, score));
            }
        } else if score >= USER_THRESHOLD && users < USER_LIMIT {
            users += 1;
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
                builtin: system_skills::is_system_skill(skill.document_id),
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

/// Loaded skills as one prompt section; empty when none are loaded.
pub fn render_loaded(skills: &[LoadedSkill]) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let mut section = String::from(
        "\n<loaded_skills>\nThese skills were loaded because this conversation needs them. Follow each where the user's request calls for it, and only there.\n",
    );
    for skill in skills {
        section.push_str(&format!(
            "<skill name=\"{}\" id=\"{}\">\n{}\n</skill>\n",
            skill.name,
            skill.id,
            skill.content.trim_end()
        ));
    }
    section.push_str("</loaded_skills>\n");
    section
}
