//! Routes evaluation prompts through the real Jev over every SDK entity's
//! routing sentence, and reports how often the expected entities load.
//!
//! ```text
//! doppler run --project agent-harness-service --config dev -- \
//!   cargo test -p agent_code_mode --lib entity_route_evaluation -- --ignored --nocapture
//! ```

use super::*;
use async_trait::async_trait;
use cognition::domain::{
    DecisionRequest, DecisionResponse, GenerateObjectRequest, GenerateObjectResponse,
};
use jev::domain::{JevProvider as _, YesNoQuestion};
use rootcause::Report;

/// Each prompt and the entities it should load.
const PROMPTS: &[(&str, &[&str])] = &[
    (
        "What did the design team decide about the Q3 launch?",
        &["search"],
    ),
    ("Find the contract we sent Acme last month", &["search"]),
    (
        "Search everything tagged Launch for the pricing decision",
        &["search"],
    ),
    (
        "Catch me up on what changed in my workspace today",
        &["workspace"],
    ),
    (
        "What did I ask Macro in my AI chat about the offsite?",
        &["chats"],
    ),
    (
        "Every Monday at 9, send me a summary of my open tasks",
        &["routines", "tasks"],
    ),
    ("Remind me tomorrow at 3pm to call the bank", &["routines"]),
    (
        "Add a Status column to the Hiring table and mark the first three rows done",
        &["databases"],
    ),
    (
        "How many rows in Leads have revenue over 10k?",
        &["databases"],
    ),
    ("Move Acme to Negotiation", &["crm"]),
    ("Which deals in the pipeline are owned by Sam?", &["crm"]),
    (
        "Draft a reply to the latest email from our landlord",
        &["email"],
    ),
    (
        "Label every newsletter in my work inbox as Later",
        &["email"],
    ),
    (
        "Find 30 minutes next week with Priya and Leo",
        &["calendar"],
    ),
    ("Send me my booking link", &["calendar"]),
    (
        "Write a project brief for the onboarding revamp",
        &["documents"],
    ),
    (
        "Fix the formulas in the budget spreadsheet",
        &["documents", "spreadsheets"],
    ),
    (
        "Arrange the boxes on the roadmap canvas into a flowchart",
        &["canvases"],
    ),
    (
        "Post a poll in the design channel about the two logo options",
        &["channels"],
    ),
    (
        "Create a task for Sam to review the deck by Friday",
        &["tasks"],
    ),
    ("Fix the flaky login test and open a PR", &["agentSessions"]),
    ("Make my agent always answer in French", &["agents"]),
    (
        "When a new row is added to Leads, email me",
        &["routines", "databases"],
    ),
    ("Thanks, that's perfect!", &[]),
    ("What's 15% of 2,340?", &[]),
    ("Pin the roadmap doc to my home view", &["pins"]),
    ("Add the Q3 plan to my favorites", &["favorites"]),
    (
        "What title and preview image does https://example.com/launch show?",
        &["unfurls"],
    ),
];

const RUNS: usize = 3;
/// What a turn loads: entities at 0.5 or higher, at most four.
const LOADED: usize = 4;

/// The real Jev behind the cognition port, counting its calls and the input
/// tokens they bill.
struct RealJev {
    jev: jev::outbound::SystemOneJev,
    calls: std::sync::atomic::AtomicU64,
    input_tokens: std::sync::atomic::AtomicU64,
}

#[async_trait]
impl Cognition for RealJev {
    async fn generate_object(
        &self,
        _: &MacroUserIdStr<'static>,
        _: GenerateObjectRequest,
    ) -> Result<GenerateObjectResponse, Report> {
        unreachable!("routing never generates text")
    }

    async fn decide(
        &self,
        _: &MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, Report> {
        let (keys, questions): (Vec<String>, Vec<YesNoQuestion>) = request
            .questions
            .into_iter()
            .map(|(key, question)| {
                (
                    key,
                    YesNoQuestion::try_from(question).expect("questions fit Jev"),
                )
            })
            .unzip();
        let evaluation = self
            .jev
            .evaluate(&request.input, &questions)
            .await
            .map_err(|error| rootcause::report!("{error}"))?;
        self.calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.input_tokens.fetch_add(
            evaluation.input_tokens,
            std::sync::atomic::Ordering::Relaxed,
        );
        Ok(DecisionResponse {
            probabilities: keys
                .into_iter()
                .zip(evaluation.probabilities)
                .map(|(key, probability)| (key, probability.get()))
                .collect(),
        })
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "calls TypeSafe's Jev; needs TYPESAFE_API_KEY"]
async fn entity_route_evaluation() {
    let key = jev::outbound::TypesafeApiKey::new().expect("TYPESAFE_API_KEY is set");
    let jev = Arc::new(RealJev {
        jev: jev::outbound::SystemOneJev::typesafe(key.value().expect("TYPESAFE_API_KEY is set"))
            .expect("a valid TypeSafe key"),
        calls: std::sync::atomic::AtomicU64::new(0),
        input_tokens: std::sync::atomic::AtomicU64::new(0),
    });
    let cognition: Arc<dyn Cognition> = jev.clone();
    let owner = MacroUserIdStr::parse_from_str("macro|eval@example.com").expect("a user id");
    let docs = sdk_documentation();
    let (mut recalled, mut expected_total, mut exact, mut spurious, mut loaded_total) =
        (0, 0, 0, 0, 0);
    for (prompt, expected) in PROMPTS {
        for run in 0..RUNS {
            let ranking = rank_entities(
                &owner,
                prompt,
                None,
                docs,
                Some(&cognition),
                Duration::from_secs(5),
                &CancellationToken::new(),
            )
            .await;
            assert_eq!(ranking.status, SelectionStatus::Selected, "{prompt}");
            let loaded: Vec<&str> = ranking
                .entities
                .iter()
                .take(LOADED)
                .map(|doc| doc.name.as_str())
                .collect();
            loaded_total += loaded.len();
            expected_total += expected.len();
            recalled += expected.iter().filter(|name| loaded.contains(name)).count();
            if loaded.len() == expected.len() && expected.iter().all(|name| loaded.contains(name)) {
                exact += 1;
            }
            if expected.is_empty() && !loaded.is_empty() {
                spurious += 1;
            }
            if run == 0 {
                println!("{prompt:<70} expected {expected:?} loaded {loaded:?}");
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
        "\n{} prompts x {RUNS} runs over {} entities",
        PROMPTS.len(),
        docs.len()
    );
    println!(
        "recall {recalled}/{expected_total}, exact set {exact}/{runs}, loads on prompts needing none {spurious}/{none_runs}, mean entities loaded {:.2}",
        loaded_total as f64 / runs as f64
    );
    let calls = jev.calls.load(std::sync::atomic::Ordering::Relaxed);
    let input_tokens = jev.input_tokens.load(std::sync::atomic::Ordering::Relaxed);
    println!(
        "Jev calls {calls} ({:.2} per routing), input tokens {input_tokens} ({:.0} per routing)",
        calls as f64 / runs as f64,
        input_tokens as f64 / runs as f64
    );
}
