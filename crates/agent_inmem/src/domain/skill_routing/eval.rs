//! Routes evaluation prompts through the real Jev over a fixture set of user
//! skills and reports how often the expected skills load.
//!
//! ```text
//! doppler run --project agent-harness-service --config dev -- \
//!   cargo test -p agent_inmem --lib route_evaluation -- --ignored --nocapture
//! ```

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use cognition::domain::{
    Cognition, DecisionRequest, DecisionResponse, GenerateObjectRequest, GenerateObjectResponse,
};
use jev::domain::{JevProvider as _, YesNoQuestion};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use skills::domain::model::{SkillContent, SkillError, SkillMatchType, SkillSummary};
use skills::domain::ports::SkillService;
use skills::domain::selection::{SkillRequest, select_skills};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// A user's skills: name and description. One predates descriptions.
const SKILLS: &[(&str, Option<&str>)] = &[
    (
        "Release notes",
        Some(
            "Use when drafting release notes or a changelog for a product release; not internal status updates.",
        ),
    ),
    (
        "Weekly status update",
        Some(
            "Use when writing a weekly status or progress update for the team; not release notes.",
        ),
    ),
    (
        "Code review checklist",
        Some("Use when reviewing a pull request or code change; not writing new code."),
    ),
    (
        "Contract review",
        Some("Use when reviewing a contract, NDA or other legal agreement; not drafting emails."),
    ),
    (
        "Customer support reply",
        Some("Use when answering a customer's support question or ticket; not internal messages."),
    ),
    (
        "Sales follow-up email",
        Some(
            "Use when writing a follow-up email to a prospect after a sales call or demo; not support replies.",
        ),
    ),
    (
        "Meeting notes",
        Some(
            "Use when turning a meeting or call into notes with decisions and action items; not scheduling meetings.",
        ),
    ),
    (
        "Bug report",
        Some("Use when triaging or writing up a bug report; not fixing the bug."),
    ),
    (
        "Interview scorecard",
        Some("Use when evaluating a candidate after an interview; not scheduling interviews."),
    ),
    (
        "Blog post style",
        Some("Use when writing a post or article for the company blog; not social media posts."),
    ),
    (
        "Social post",
        Some("Use when writing a LinkedIn or X post; not blog articles."),
    ),
    ("Brand voice", None),
];

/// Each prompt and the skills it should load, by name.
const PROMPTS: &[(&str, &[&str])] = &[
    (
        "Draft release notes for v2.3 from the merged PRs",
        &["Release notes"],
    ),
    (
        "Write this week's status update for the platform team",
        &["Weekly status update"],
    ),
    (
        "Review PR 482 and leave comments",
        &["Code review checklist"],
    ),
    (
        "Can you check this NDA from Acme for anything unusual?",
        &["Contract review"],
    ),
    (
        "Reply to the customer asking why their export failed",
        &["Customer support reply"],
    ),
    (
        "Send a follow-up to Dana after today's demo",
        &["Sales follow-up email"],
    ),
    (
        "Turn the transcript of this morning's call into notes",
        &["Meeting notes"],
    ),
    ("Write up the login crash as a bug report", &["Bug report"]),
    (
        "Score yesterday's candidate for the backend role",
        &["Interview scorecard"],
    ),
    (
        "Write a blog post announcing the new API",
        &["Blog post style"],
    ),
    ("Draft a LinkedIn post about our launch", &["Social post"]),
    (
        "Write a blog post about the launch and a LinkedIn post to share it",
        &["Blog post style", "Social post"],
    ),
    (
        "Summarise the call with Acme and draft the follow-up email",
        &["Meeting notes", "Sales follow-up email"],
    ),
    ("Write it in our brand voice", &["Brand voice"]),
    (
        "Schedule a 30 minute interview with the candidate next week",
        &[],
    ),
    ("Fix the login crash", &[]),
    ("Move the launch doc into the Marketing folder", &[]),
    ("What did we decide about pricing last week?", &[]),
    ("What's 15% of 2,340?", &[]),
    ("Thanks, that's perfect!", &[]),
];

const RUNS: usize = 3;
const THRESHOLDS: [f32; 3] = [0.7, 0.8, 0.9];
const LOAD_LIMIT: usize = 2;

fn candidates() -> Vec<SkillSummary> {
    SKILLS
        .iter()
        .map(|(name, description)| SkillSummary {
            document_id: Uuid::new_v5(&Uuid::NAMESPACE_OID, name.as_bytes()),
            name: (*name).to_string(),
            description: description.map(str::to_string),
            updated_at: None,
        })
        .collect()
}

struct EvalSkills(Vec<SkillSummary>);

impl SkillService for EvalSkills {
    async fn read_skill(
        &self,
        _: &MacroUserIdStr<'_>,
        document_id: Uuid,
    ) -> Result<SkillContent, SkillError> {
        let skill = self
            .0
            .iter()
            .find(|skill| skill.document_id == document_id)
            .ok_or(SkillError::NotASkill)?;
        Ok(SkillContent {
            document_id,
            name: skill.name.clone(),
            content: String::new(),
        })
    }

    async fn search_skills(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &str,
        _: SkillMatchType,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        Ok(Vec::new())
    }

    async fn list_skills(&self, _: &MacroUserIdStr<'_>) -> Result<Vec<SkillSummary>, SkillError> {
        Ok(self.0.clone())
    }

    async fn list_routable_skills(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        Ok(self.0.clone())
    }
}

/// The real Jev, keeping every score it gives.
struct RecordingJev {
    jev: jev::outbound::SystemOneJev,
    scores: Mutex<BTreeMap<String, f32>>,
}

#[async_trait]
impl Cognition for RecordingJev {
    async fn generate_object(
        &self,
        _: &MacroUserIdStr<'static>,
        _: GenerateObjectRequest,
    ) -> Result<GenerateObjectResponse, Report> {
        Err(rootcause::report!("the evaluation only classifies"))
    }

    async fn decide(
        &self,
        _: &MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, Report> {
        let mut keys = Vec::new();
        let mut questions = Vec::new();
        for (key, question) in request.questions {
            keys.push(key);
            questions.push(
                YesNoQuestion::try_from(question).map_err(|error| rootcause::report!("{error}"))?,
            );
        }
        let evaluation = self
            .jev
            .evaluate(&request.input, &questions)
            .await
            .map_err(|error| rootcause::report!("{error}"))?;
        let probabilities: BTreeMap<String, f32> = keys
            .into_iter()
            .zip(evaluation.probabilities)
            .map(|(key, probability)| (key, probability.get()))
            .collect();
        self.scores.lock().unwrap().extend(probabilities.clone());
        Ok(DecisionResponse { probabilities })
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "calls TypeSafe's Jev; needs TYPESAFE_API_KEY"]
async fn route_evaluation() {
    let key = jev::outbound::TypesafeApiKey::new().expect("TYPESAFE_API_KEY is set");
    let jev = Arc::new(RecordingJev {
        jev: jev::outbound::SystemOneJev::typesafe(key.value().expect("TYPESAFE_API_KEY is set"))
            .unwrap(),
        scores: Mutex::new(BTreeMap::new()),
    });
    let cognition: Arc<dyn Cognition> = jev.clone();
    let skills = EvalSkills(candidates());
    let names: BTreeMap<String, String> = skills
        .0
        .iter()
        .map(|skill| (skill.document_id.to_string(), skill.name.clone()))
        .collect();
    let owner = MacroUserIdStr::parse_from_str("macro|eval@example.com").unwrap();

    let mut shipped_exact = 0usize;
    let mut exact = [0usize; THRESHOLDS.len()];
    let mut recalled = [0usize; THRESHOLDS.len()];
    let mut spurious = [0usize; THRESHOLDS.len()];
    let mut expected_total = 0usize;
    for (prompt, expected) in PROMPTS {
        for run in 0..RUNS {
            jev.scores.lock().unwrap().clear();
            let selection = select_skills(
                &skills,
                Some(&cognition),
                &owner,
                SkillRequest {
                    latest: prompt,
                    previous: None,
                },
                &[],
                &CancellationToken::new(),
            )
            .await;
            let loaded: Vec<&str> = selection
                .loaded
                .iter()
                .map(|skill| skill.name.as_str())
                .collect();
            shipped_exact += usize::from(same_set(&loaded, expected));
            let mut ranked: Vec<(String, f32)> = jev
                .scores
                .lock()
                .unwrap()
                .iter()
                .map(|(key, score)| (names[key].clone(), *score))
                .collect();
            ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
            expected_total += expected.len();
            for (index, threshold) in THRESHOLDS.iter().enumerate() {
                let swept: Vec<&str> = ranked
                    .iter()
                    .filter(|(_, score)| score >= threshold)
                    .take(LOAD_LIMIT)
                    .map(|(name, _)| name.as_str())
                    .collect();
                exact[index] += usize::from(same_set(&swept, expected));
                recalled[index] += expected.iter().filter(|name| swept.contains(name)).count();
                spurious[index] += usize::from(expected.is_empty() && !swept.is_empty());
            }
            if run == 0 {
                let top: Vec<String> = ranked
                    .iter()
                    .take(3)
                    .map(|(name, score)| format!("{name} {score:.2}"))
                    .collect();
                println!(
                    "{prompt:<68} expected {expected:?} loaded {loaded:?} top [{}]",
                    top.join(", ")
                );
            }
        }
    }
    let runs = PROMPTS.len() * RUNS;
    let none_runs = PROMPTS
        .iter()
        .filter(|(_, expected)| expected.is_empty())
        .count()
        * RUNS;
    println!(
        "\n{} prompts x {RUNS} runs over {} skills",
        PROMPTS.len(),
        SKILLS.len()
    );
    println!(
        "as shipped (0.8, or 0.95 without a description; at most 2): exact set {shipped_exact}/{runs}"
    );
    for (index, threshold) in THRESHOLDS.iter().enumerate() {
        println!(
            "at {threshold}: exact set {}/{runs}, recall {}/{expected_total}, loads on prompts needing none {}/{none_runs}",
            exact[index], recalled[index], spurious[index]
        );
    }
}

fn same_set(loaded: &[&str], expected: &[&str]) -> bool {
    loaded.len() == expected.len() && expected.iter().all(|name| loaded.contains(name))
}
