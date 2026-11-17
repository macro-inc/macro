use std::collections::BTreeMap;
use std::sync::Mutex;

use async_trait::async_trait;
use cognition::domain::{
    DecisionRequest, DecisionResponse, GenerateObjectRequest, GenerateObjectResponse,
};
use rootcause::Report;

use super::*;
use crate::domain::model::{SkillContent, SkillMatchType};

/// The numbered skill a question asks about (`Skills::numbered` names them
/// "Skill <id>").
fn asked_about(question: &str) -> Option<Uuid> {
    let id = question.split("\"Skill ").nth(1)?.split('"').next()?;
    Some(Uuid::from_u128(id.parse().ok()?))
}

/// Answers each question with the score its skill was given, 0.1 otherwise.
struct Jev {
    scores: BTreeMap<Uuid, f32>,
    delay: Duration,
    fail: bool,
    calls: Mutex<Vec<DecisionRequest>>,
}

impl Jev {
    fn scoring(scores: &[(u128, f32)]) -> Arc<Self> {
        Arc::new(Self {
            scores: scores
                .iter()
                .map(|(id, score)| (Uuid::from_u128(*id), *score))
                .collect(),
            delay: Duration::ZERO,
            fail: false,
            calls: Mutex::new(Vec::new()),
        })
    }

    fn asked(&self) -> Vec<Vec<String>> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|request| {
                request
                    .questions
                    .values()
                    .map(|question| asked_about(question).unwrap().to_string())
                    .collect()
            })
            .collect()
    }
}

#[async_trait]
impl Cognition for Jev {
    async fn generate_object(
        &self,
        _: &MacroUserIdStr<'static>,
        _: GenerateObjectRequest,
    ) -> Result<GenerateObjectResponse, Report> {
        panic!("skill selection must not generate text")
    }

    async fn decide(
        &self,
        _: &MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, Report> {
        let probabilities = request
            .questions
            .iter()
            .map(|(key, question)| {
                let score = asked_about(question)
                    .and_then(|id| self.scores.get(&id).copied())
                    .unwrap_or(0.1);
                (key.clone(), score)
            })
            .collect();
        self.calls.lock().unwrap().push(request);
        tokio::time::sleep(self.delay).await;
        if self.fail {
            return Err(rootcause::report!("unavailable"));
        }
        Ok(DecisionResponse { probabilities })
    }
}

/// The user's skills, every body readable unless listed as unreadable.
struct Skills {
    user: Vec<SkillSummary>,
    unreadable: Vec<Uuid>,
}

impl Skills {
    fn numbered(count: usize) -> Self {
        Self {
            user: (1..=count as u128)
                .map(|id| SkillSummary {
                    document_id: Uuid::from_u128(id),
                    name: format!("Skill {id}"),
                    description: Some(format!("Use when doing thing {id}")),
                    updated_at: None,
                })
                .collect(),
            unreadable: Vec::new(),
        }
    }
}

impl SkillService for Skills {
    async fn read_skill(
        &self,
        _: &MacroUserIdStr<'_>,
        document_id: Uuid,
    ) -> Result<SkillContent, SkillError> {
        if self.unreadable.contains(&document_id) {
            return Err(SkillError::NotASkill);
        }
        let skill = self
            .user
            .iter()
            .find(|skill| skill.document_id == document_id)
            .expect("only listed skills are read");
        Ok(SkillContent {
            document_id,
            name: skill.name.clone(),
            content: format!("Instructions for {}.", skill.name),
        })
    }

    async fn search_skills(
        &self,
        _: &MacroUserIdStr<'_>,
        _: &str,
        _: SkillMatchType,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        panic!("skill selection must not search")
    }

    async fn list_skills(&self, _: &MacroUserIdStr<'_>) -> Result<Vec<SkillSummary>, SkillError> {
        panic!("skill selection lists routable skills")
    }

    async fn list_routable_skills(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        Ok(self.user.clone())
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|fixture@example.com").unwrap()
}

fn ids(selection: &SkillSelection) -> Vec<u128> {
    selection
        .loaded
        .iter()
        .map(|skill| skill.id.as_u128())
        .collect()
}

async fn select(
    skills: &Skills,
    jev: Option<Arc<Jev>>,
    latest: &str,
    loaded: &[Uuid],
) -> SkillSelection {
    let jev = jev.map(|jev| jev as Arc<dyn Cognition>);
    select_skills(
        skills,
        jev.as_ref(),
        &owner(),
        RoutingRequest {
            latest,
            previous: None,
        },
        loaded,
        &CancellationToken::new(),
    )
    .await
}

#[tokio::test]
async fn an_irrelevant_request_loads_nothing() {
    let jev = Jev::scoring(&[]);

    let selection = select(
        &Skills::numbered(3),
        Some(jev.clone()),
        "Thanks, that's perfect!",
        &[],
    )
    .await;

    assert_eq!(selection.status, SelectionStatus::Selected);
    assert!(selection.loaded.is_empty());
    assert!(selection.suggested.is_empty());
    assert_eq!(selection.candidates, 3);
    assert_eq!(jev.asked().len(), 1);
}

#[tokio::test]
async fn a_matching_request_loads_that_skill_with_its_instructions() {
    let selection = select(
        &Skills::numbered(3),
        Some(Jev::scoring(&[(2, 0.9)])),
        "request",
        &[],
    )
    .await;

    assert_eq!(ids(&selection), [2]);
    assert_eq!(selection.loaded[0].content, "Instructions for Skill 2.");
    assert_eq!(selection.top_score, Some(0.9));
}

#[tokio::test]
async fn at_most_two_load_most_relevant_first_and_unsure_ones_are_suggested() {
    let jev = Jev::scoring(&[(1, 0.85), (2, 0.99), (3, 0.9), (4, 0.6), (5, 0.79)]);

    let selection = select(&Skills::numbered(5), Some(jev), "request", &[]).await;

    assert_eq!(ids(&selection), [2, 3]);
    let suggested: Vec<u128> = selection
        .suggested
        .iter()
        .map(|skill| skill.document_id.as_u128())
        .collect();
    assert_eq!(suggested, [1, 5, 4]);
}

#[tokio::test]
async fn loaded_and_mentioned_skills_are_not_asked_about() {
    let jev = Jev::scoring(&[(1, 0.9), (3, 0.9)]);
    let mentioned = Uuid::from_u128(3);
    let request = format!(
        "Use <m-document-mention>{{\"documentId\":\"{mentioned}\",\"documentName\":\"\",\"blockName\":\"skill\",\"blockParams\":{{}}}}</m-document-mention> on this"
    );

    let selection = select(
        &Skills::numbered(3),
        Some(jev.clone()),
        &request,
        &[Uuid::from_u128(1)],
    )
    .await;

    assert!(selection.loaded.is_empty());
    assert_eq!(jev.asked().concat(), [Uuid::from_u128(2).to_string()]);
    assert_eq!(selection.candidates, 1);
}

#[tokio::test]
async fn candidates_split_into_calls_of_at_most_32_questions() {
    let jev = Jev::scoring(&[]);

    select(&Skills::numbered(70), Some(jev.clone()), "request", &[]).await;

    let sizes: Vec<usize> = jev.asked().iter().map(Vec::len).collect();
    assert_eq!(sizes.len(), 3);
    assert!(sizes.iter().all(|size| *size <= 32));
    assert_eq!(sizes.iter().sum::<usize>(), 70);
}

#[tokio::test]
async fn at_most_eight_calls_route_the_256_most_recent_skills() {
    let jev = Jev::scoring(&[]);

    let selection = select(&Skills::numbered(300), Some(jev.clone()), "request", &[]).await;

    let asked = jev.asked();
    assert_eq!(asked.len(), 8);
    let asked = asked.concat();
    assert_eq!(asked.len(), 256);
    assert_eq!(selection.candidates, 256);
    assert!(asked.contains(&Uuid::from_u128(256).to_string()));
    assert!(!asked.contains(&Uuid::from_u128(257).to_string()));
}

#[tokio::test]
async fn an_unreadable_skill_is_not_loaded() {
    let skills = Skills {
        unreadable: vec![Uuid::from_u128(1)],
        ..Skills::numbered(2)
    };

    let selection = select(
        &skills,
        Some(Jev::scoring(&[(1, 0.95), (2, 0.9)])),
        "request",
        &[],
    )
    .await;

    assert_eq!(ids(&selection), [2]);
}

#[tokio::test(start_paused = true)]
async fn a_slow_classifier_loads_nothing_after_the_deadline() {
    let jev = Arc::new(Jev {
        scores: [(Uuid::from_u128(1), 0.9)].into_iter().collect(),
        delay: Duration::from_secs(5),
        fail: false,
        calls: Mutex::new(Vec::new()),
    });

    let selection = select(&Skills::numbered(2), Some(jev), "request", &[]).await;

    assert_eq!(selection.status, SelectionStatus::Timeout);
    assert!(selection.loaded.is_empty());
}

#[tokio::test]
async fn a_failing_or_absent_classifier_or_no_skills_load_nothing() {
    let failing = Arc::new(Jev {
        scores: [(Uuid::from_u128(1), 0.9)].into_iter().collect(),
        delay: Duration::ZERO,
        fail: true,
        calls: Mutex::new(Vec::new()),
    });

    let failed = select(&Skills::numbered(2), Some(failing), "request", &[]).await;
    let absent = select(&Skills::numbered(2), None, "request", &[]).await;
    let none = select(
        &Skills::numbered(0),
        Some(Jev::scoring(&[])),
        "request",
        &[],
    )
    .await;

    assert_eq!(failed.status, SelectionStatus::ProviderError);
    assert_eq!(absent.status, SelectionStatus::Unconfigured);
    assert_eq!(none.status, SelectionStatus::NoCandidates);
    for selection in [failed, absent, none] {
        assert!(selection.loaded.is_empty());
    }
}

#[tokio::test]
async fn the_classifier_sees_the_request_and_each_description() {
    let jev = Jev::scoring(&[]);
    let skills = Skills {
        user: vec![
            SkillSummary {
                document_id: Uuid::from_u128(1),
                name: "Release notes".into(),
                description: Some("Use when drafting release notes; not changelogs".into()),
                updated_at: None,
            },
            SkillSummary {
                document_id: Uuid::from_u128(2),
                name: "Old skill".into(),
                description: None,
                updated_at: None,
            },
        ],
        unreadable: Vec::new(),
    };
    let cognition: Arc<dyn Cognition> = jev.clone();

    select_skills(
        &skills,
        Some(&cognition),
        &owner(),
        RoutingRequest {
            latest: "now do it for Q3",
            previous: Some("summarise Q2 revenue"),
        },
        &[],
        &CancellationToken::new(),
    )
    .await;

    let request = jev.calls.lock().unwrap().remove(0);
    assert_eq!(
        request.input,
        serde_json::json!({"request": "now do it for Q3", "previousRequest": "summarise Q2 revenue"})
    );
    let questions: Vec<&String> = request.questions.values().collect();
    assert_eq!(
        questions,
        [
            "Would the skill \"Release notes\" help with this request? Use when drafting release notes; not changelogs",
            // A skill made before descriptions existed routes on its name.
            "Would the skill \"Old skill\" help with this request?",
        ]
    );
}

#[test]
fn loaded_skills_render_as_one_tagged_section() {
    let rendered = render_loaded(&[LoadedSkill {
        id: Uuid::from_u128(7),
        name: "Release notes".to_string(),
        score: 0.9,
        content: "Write release notes as bullet points.".to_string(),
    }]);

    assert!(rendered.starts_with("<loaded_skills>\n"));
    assert!(rendered.contains(&format!(
        "<skill name=\"Release notes\" id=\"{}\">\nWrite release notes as bullet points.\n</skill>",
        Uuid::from_u128(7)
    )));
    assert!(rendered.ends_with("</loaded_skills>"));
    assert_eq!(render_loaded(&[]), "");
}

#[tokio::test]
async fn a_skill_without_a_description_needs_near_certainty_to_load() {
    let mut skills = Skills::numbered(2);
    skills.user[0].description = None;
    skills.user[1].description = None;

    let selection = select(
        &skills,
        Some(Jev::scoring(&[(1, 0.93), (2, 0.96)])),
        "request",
        &[],
    )
    .await;

    assert_eq!(ids(&selection), [2]);
    let suggested: Vec<u128> = selection
        .suggested
        .iter()
        .map(|skill| skill.document_id.as_u128())
        .collect();
    assert_eq!(suggested, [1]);
}
