//! Routes the design's evaluation prompts through the real Jev and reports how
//! often the expected skills load. Area skills not built yet are routed by
//! the description the design gives them; each moves to `system_skills` as it
//! is built.
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

/// Area skills the design plans and `system_skills` does not have yet.
const PLANNED: &[(&str, &str)] = &[
    (
        "Finding Things",
        "Use when the user asks to find, look up or list their own Macro content (documents, emails, messages, tasks, people), or asks something their workspace answers; not for the web.",
    ),
    (
        "Documents",
        "Use when creating, writing into or editing a document, canvas, spreadsheet, Word document or deck; not databases.",
    ),
    (
        "Routines",
        "Use when something should happen later, on a schedule, or whenever an event occurs, such as every Monday, a reminder, or when an email arrives.",
    ),
    (
        "Email",
        "Use when reading, searching, labelling, drafting or sending email, or working across inboxes.",
    ),
    (
        "Calendar",
        "Use when working with calendar events, availability, scheduling a meeting or booking links.",
    ),
    (
        "Channels",
        "Use when posting, reacting, running a poll or managing members in a channel or direct message; not reading a thread already in context.",
    ),
    (
        "Tasks",
        "Use when creating, assigning or updating tasks or initiatives.",
    ),
    (
        "Coding",
        "Use when changing code, a repository, a pull request or a coding agent.",
    ),
];

/// Each prompt and the skills it should load, by name.
const PROMPTS: &[(&str, &[&str])] = &[
    (
        "What did the design team decide about the Q3 launch?",
        &["Finding Things"],
    ),
    (
        "Find the contract we sent Acme last month",
        &["Finding Things"],
    ),
    (
        "Every Monday at 9, send me a summary of my open tasks",
        &["Routines", "Tasks"],
    ),
    ("Remind me tomorrow at 3pm to call the bank", &["Routines"]),
    (
        "Add a Status column to the Hiring table and mark the first three rows done",
        &["Databases"],
    ),
    (
        "How many rows in Leads have revenue over 10k?",
        &["Databases"],
    ),
    ("Move Acme to Negotiation", &["CRM"]),
    ("Which deals in the pipeline are owned by Sam?", &["CRM"]),
    (
        "Draft a reply to the latest email from our landlord",
        &["Email"],
    ),
    (
        "Label every newsletter in my work inbox as Later",
        &["Email"],
    ),
    (
        "Find 30 minutes next week with Priya and Leo",
        &["Calendar"],
    ),
    ("Send me my booking link", &["Calendar"]),
    (
        "Write a project brief for the onboarding revamp",
        &["Documents"],
    ),
    ("Fix the formulas in the budget spreadsheet", &["Documents"]),
    (
        "Post a poll in #design about the two logo options",
        &["Channels"],
    ),
    (
        "Create a task for Sam to review the deck by Friday",
        &["Tasks"],
    ),
    ("Fix the flaky login test and open a PR", &["Coding"]),
    (
        "Make my agent always answer in French",
        &["Configure Agent"],
    ),
    (
        "When a new row is added to Leads, email me",
        &["Routines", "Databases"],
    ),
    ("Thanks, that's perfect!", &[]),
    ("What's 15% of 2,340?", &[]),
];

const RUNS: usize = 3;
const THRESHOLDS: [f32; 3] = [0.5, 0.7, 0.8];
/// The most skills one request loads in the sweep, as for built-ins.
const LOAD_LIMIT: usize = 3;

fn planned_id(name: &str) -> Uuid {
    Uuid::new_v5(&Uuid::NAMESPACE_OID, name.as_bytes())
}

fn candidates() -> Vec<SkillSummary> {
    system_skills::SYSTEM_SKILLS
        .iter()
        .map(|skill| SkillSummary {
            document_id: skill.id(),
            name: skill.name.to_string(),
            description: Some(skill.description.to_string()),
            updated_at: None,
        })
        .chain(PLANNED.iter().map(|(name, description)| SkillSummary {
            document_id: planned_id(name),
            name: (*name).to_string(),
            description: Some((*description).to_string()),
            updated_at: None,
        }))
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
        unreachable!()
    }

    async fn list_skills(&self, _: &MacroUserIdStr<'_>) -> Result<Vec<SkillSummary>, SkillError> {
        unreachable!()
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
        unreachable!()
    }

    async fn decide(
        &self,
        _: &MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, Report> {
        let (keys, questions): (Vec<String>, Vec<YesNoQuestion>) = request
            .questions
            .into_iter()
            .map(|(key, question)| (key, YesNoQuestion::try_from(question).unwrap()))
            .unzip();
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

    // Exact-set hits per threshold, and loads on prompts that expect none.
    let mut exact = [0usize; THRESHOLDS.len()];
    let mut expected_loaded = [0usize; THRESHOLDS.len()];
    let mut expected_total = 0usize;
    let mut spurious = [0usize; THRESHOLDS.len()];
    let mut routed_exact = 0usize;
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
            let routed: Vec<&str> = selection
                .loaded
                .iter()
                .map(|skill| skill.name.as_str())
                .collect();
            if same_set(&routed, expected) {
                routed_exact += 1;
            }
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
                let loaded: Vec<&str> = ranked
                    .iter()
                    .filter(|(_, score)| score >= threshold)
                    .take(LOAD_LIMIT)
                    .map(|(name, _)| name.as_str())
                    .collect();
                if same_set(&loaded, expected) {
                    exact[index] += 1;
                }
                expected_loaded[index] +=
                    expected.iter().filter(|name| loaded.contains(name)).count();
                if expected.is_empty() && !loaded.is_empty() {
                    spurious[index] += 1;
                }
            }
            if run == 0 {
                let top: Vec<String> = ranked
                    .iter()
                    .take(3)
                    .map(|(name, score)| format!("{name} {score:.2}"))
                    .collect();
                println!(
                    "{prompt:<75} expected {expected:?} routed {routed:?} top [{}]",
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
    println!("\n{} prompts x {RUNS} runs", PROMPTS.len());
    println!(
        "router as shipped (planned skills routed as user skills): exact set {routed_exact}/{runs}"
    );
    for (index, threshold) in THRESHOLDS.iter().enumerate() {
        println!(
            "all as built-ins at {threshold}: exact set {}/{runs}, recall {}/{expected_total}, loads on irrelevant prompts {}/{none_runs}",
            exact[index], expected_loaded[index], spurious[index]
        );
    }
}

fn same_set(loaded: &[&str], expected: &[&str]) -> bool {
    loaded.len() == expected.len() && expected.iter().all(|name| loaded.contains(name))
}
