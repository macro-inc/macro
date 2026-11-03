use std::collections::BTreeMap;
use std::sync::Mutex;

use async_trait::async_trait;
use cognition::domain::{DecisionResponse, GenerateObjectRequest, GenerateObjectResponse};
use rootcause::Report;

use super::*;
use crate::domain::model::{SkillContent, SkillMatchType};

/// Answers each question with the score its skill was given, 0.1 otherwise.
struct Jev {
    scores: BTreeMap<Uuid, f32>,
    delay: Duration,
    fail: bool,
    calls: Mutex<Vec<Vec<String>>>,
}

impl Jev {
    fn scoring(scores: &[(Uuid, f32)]) -> Arc<Self> {
        Arc::new(Self {
            scores: scores.iter().copied().collect(),
            delay: Duration::ZERO,
            fail: false,
            calls: Mutex::new(Vec::new()),
        })
    }

    fn asked(&self) -> Vec<Vec<String>> {
        self.calls.lock().unwrap().clone()
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
        self.calls
            .lock()
            .unwrap()
            .push(request.questions.keys().cloned().collect());
        tokio::time::sleep(self.delay).await;
        if self.fail {
            return Err(rootcause::report!("unavailable"));
        }
        Ok(DecisionResponse {
            probabilities: request
                .questions
                .keys()
                .map(|key| {
                    let id: Uuid = key.parse().unwrap();
                    (key.clone(), self.scores.get(&id).copied().unwrap_or(0.1))
                })
                .collect(),
        })
    }
}

/// The user's skills plus the built-ins, with every body readable unless
/// listed as unreadable.
struct Skills {
    user: Vec<SkillSummary>,
    unreadable: Vec<Uuid>,
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
        if let Some(skill) = system_skills::system_skill(document_id) {
            return Ok(SkillContent {
                document_id,
                name: skill.name.to_string(),
                content: skill.render_content(),
            });
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
        Ok(self
            .user
            .iter()
            .cloned()
            .chain(
                system_skills::SYSTEM_SKILLS
                    .iter()
                    .map(|skill| SkillSummary {
                        document_id: skill.id(),
                        name: skill.name.to_string(),
                        description: Some(skill.description.to_string()),
                        updated_at: None,
                    }),
            )
            .collect())
    }
}

fn user_skills(count: usize) -> Vec<SkillSummary> {
    (0..count)
        .map(|index| SkillSummary {
            document_id: Uuid::from_u128(index as u128 + 1),
            name: format!("Skill {index}"),
            description: None,
            updated_at: None,
        })
        .collect()
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|fixture@example.com").unwrap()
}

fn catch_me_up() -> Uuid {
    system_skills::catch_me_up::SKILL.id()
}

fn configure_agent() -> Uuid {
    system_skills::configure_agent::SKILL.id()
}

async fn select(
    skills: &Skills,
    jev: Option<Arc<Jev>>,
    latest: &str,
    already_loaded: &[Uuid],
) -> SkillSelection {
    let jev = jev.map(|jev| jev as Arc<dyn Cognition>);
    select_skills(
        skills,
        jev.as_ref(),
        &owner(),
        SkillRequest {
            latest,
            previous: None,
        },
        already_loaded,
        &CancellationToken::new(),
    )
    .await
}

#[tokio::test]
async fn an_irrelevant_request_loads_nothing() {
    let skills = Skills {
        user: user_skills(3),
        unreadable: Vec::new(),
    };
    let jev = Jev::scoring(&[]);

    let selection = select(&skills, Some(jev.clone()), "Thanks, that's perfect!", &[]).await;

    assert_eq!(selection.status, SelectionStatus::Selected);
    assert!(selection.loaded.is_empty());
    assert!(selection.suggested.is_empty());
    assert_eq!(selection.candidates, 3 + system_skills::SYSTEM_SKILLS.len());
    assert_eq!(jev.asked().len(), 1);
}

#[tokio::test]
async fn a_matching_request_loads_that_skill_with_its_instructions() {
    let skills = Skills {
        user: user_skills(3),
        unreadable: Vec::new(),
    };
    let jev = Jev::scoring(&[(catch_me_up(), 0.9)]);

    let selection = select(&skills, Some(jev), "What did I miss?", &[]).await;

    assert_eq!(selection.loaded.len(), 1);
    let loaded = &selection.loaded[0];
    assert_eq!(loaded.id, catch_me_up());
    assert!(loaded.builtin);
    assert_eq!(
        loaded.content,
        system_skills::catch_me_up::SKILL.render_content()
    );
}

#[tokio::test]
async fn independent_matches_load_together_most_relevant_first() {
    let skills = Skills {
        user: user_skills(3),
        unreadable: Vec::new(),
    };
    let release_notes = Uuid::from_u128(2);
    let jev = Jev::scoring(&[(catch_me_up(), 0.75), (release_notes, 0.95)]);

    let selection = select(
        &skills,
        Some(jev),
        "Catch me up, then draft release notes",
        &[],
    )
    .await;

    let loaded: Vec<Uuid> = selection.loaded.iter().map(|skill| skill.id).collect();
    assert_eq!(loaded, [release_notes, catch_me_up()]);
}

#[tokio::test]
async fn user_skills_need_more_confidence_than_built_ins() {
    let skills = Skills {
        user: user_skills(3),
        unreadable: Vec::new(),
    };
    let unsure = Uuid::from_u128(1);
    let jev = Jev::scoring(&[(catch_me_up(), 0.75), (unsure, 0.75)]);

    let selection = select(&skills, Some(jev), "request", &[]).await;

    let loaded: Vec<Uuid> = selection.loaded.iter().map(|skill| skill.id).collect();
    assert_eq!(loaded, [catch_me_up()]);
    let suggested: Vec<Uuid> = selection
        .suggested
        .iter()
        .map(|skill| skill.document_id)
        .collect();
    assert_eq!(suggested, [unsure]);
}

#[tokio::test]
async fn at_most_two_user_skills_load_and_the_rest_are_suggested() {
    let skills = Skills {
        user: user_skills(4),
        unreadable: Vec::new(),
    };
    let jev = Jev::scoring(&[
        (Uuid::from_u128(1), 0.85),
        (Uuid::from_u128(2), 0.99),
        (Uuid::from_u128(3), 0.9),
    ]);

    let selection = select(&skills, Some(jev), "request", &[]).await;

    let loaded: Vec<Uuid> = selection.loaded.iter().map(|skill| skill.id).collect();
    assert_eq!(loaded, [Uuid::from_u128(2), Uuid::from_u128(3)]);
    let suggested: Vec<Uuid> = selection
        .suggested
        .iter()
        .map(|skill| skill.document_id)
        .collect();
    assert_eq!(suggested, [Uuid::from_u128(1)]);
}

#[tokio::test]
async fn loaded_and_mentioned_skills_are_not_asked_about() {
    let skills = Skills {
        user: user_skills(3),
        unreadable: Vec::new(),
    };
    let mentioned = Uuid::from_u128(3);
    let jev = Jev::scoring(&[(catch_me_up(), 0.9), (mentioned, 0.9)]);
    let request = format!(
        "Use <m-document-mention>{{\"documentId\":\"{mentioned}\",\"documentName\":\"\",\"blockName\":\"skill\",\"blockParams\":{{}}}}</m-document-mention> on this"
    );

    let selection = select(&skills, Some(jev.clone()), &request, &[catch_me_up()]).await;

    assert!(selection.loaded.is_empty());
    let asked: Vec<String> = jev.asked().concat();
    assert!(!asked.contains(&catch_me_up().to_string()));
    assert!(!asked.contains(&mentioned.to_string()));
    assert_eq!(
        selection.candidates,
        2 + system_skills::SYSTEM_SKILLS.len() - 1
    );
}

#[tokio::test]
async fn candidates_split_into_calls_of_at_most_32_questions() {
    let skills = Skills {
        user: user_skills(70 - system_skills::SYSTEM_SKILLS.len()),
        unreadable: Vec::new(),
    };
    let jev = Jev::scoring(&[]);

    select(&skills, Some(jev.clone()), "request", &[]).await;

    let sizes: Vec<usize> = jev.asked().iter().map(Vec::len).collect();
    assert_eq!(sizes.len(), 3);
    assert!(sizes.iter().all(|size| *size <= 32));
    assert_eq!(sizes.iter().sum::<usize>(), 70);
}

#[tokio::test]
async fn at_most_eight_calls_route_the_first_256_candidates_built_ins_first() {
    let skills = Skills {
        user: user_skills(300),
        unreadable: Vec::new(),
    };
    let jev = Jev::scoring(&[]);

    let selection = select(&skills, Some(jev.clone()), "request", &[]).await;

    let asked = jev.asked();
    assert_eq!(asked.len(), 8);
    let asked: Vec<String> = asked.concat();
    assert_eq!(asked.len(), 256);
    assert_eq!(selection.candidates, 256);
    for skill in system_skills::SYSTEM_SKILLS {
        assert!(asked.contains(&skill.id().to_string()));
    }
    assert!(!asked.contains(&Uuid::from_u128(300).to_string()));
}

#[tokio::test]
async fn an_unreadable_skill_is_not_loaded() {
    let skills = Skills {
        user: user_skills(2),
        unreadable: vec![Uuid::from_u128(1)],
    };
    let jev = Jev::scoring(&[(Uuid::from_u128(1), 0.95), (Uuid::from_u128(2), 0.9)]);

    let selection = select(&skills, Some(jev), "request", &[]).await;

    let loaded: Vec<Uuid> = selection.loaded.iter().map(|skill| skill.id).collect();
    assert_eq!(loaded, [Uuid::from_u128(2)]);
}

#[tokio::test(start_paused = true)]
async fn a_slow_classifier_loads_nothing_after_the_deadline() {
    let skills = Skills {
        user: user_skills(2),
        unreadable: Vec::new(),
    };
    let jev = Arc::new(Jev {
        scores: [(catch_me_up(), 0.9)].into_iter().collect(),
        delay: Duration::from_secs(5),
        fail: false,
        calls: Mutex::new(Vec::new()),
    });

    let selection = select(&skills, Some(jev), "request", &[]).await;

    assert_eq!(selection.status, SelectionStatus::Timeout);
    assert!(selection.loaded.is_empty());
}

#[tokio::test]
async fn a_failing_or_absent_classifier_loads_nothing() {
    let skills = Skills {
        user: user_skills(2),
        unreadable: Vec::new(),
    };
    let failing = Arc::new(Jev {
        scores: [(configure_agent(), 0.9)].into_iter().collect(),
        delay: Duration::ZERO,
        fail: true,
        calls: Mutex::new(Vec::new()),
    });

    let failed = select(&skills, Some(failing), "request", &[]).await;
    let absent = select(&skills, None, "request", &[]).await;

    assert_eq!(failed.status, SelectionStatus::ProviderError);
    assert!(failed.loaded.is_empty());
    assert_eq!(absent.status, SelectionStatus::Unconfigured);
    assert!(absent.loaded.is_empty());
}

#[tokio::test]
async fn the_classifier_sees_the_request_and_each_skill_description() {
    struct Recording(Mutex<Option<DecisionRequest>>);
    #[async_trait]
    impl Cognition for Recording {
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
            let probabilities = request
                .questions
                .keys()
                .map(|key| (key.clone(), 0.0))
                .collect();
            *self.0.lock().unwrap() = Some(request);
            Ok(DecisionResponse { probabilities })
        }
    }
    let skills = Skills {
        user: Vec::new(),
        unreadable: Vec::new(),
    };
    let recording = Arc::new(Recording(Mutex::new(None)));
    let cognition: Arc<dyn Cognition> = recording.clone();

    select_skills(
        &skills,
        Some(&cognition),
        &owner(),
        SkillRequest {
            latest: "now do it for Q3",
            previous: Some("summarise Q2 revenue"),
        },
        &[],
        &CancellationToken::new(),
    )
    .await;

    let request = recording.0.lock().unwrap().take().unwrap();
    assert_eq!(
        request.input,
        serde_json::json!({"request": "now do it for Q3", "previousRequest": "summarise Q2 revenue"})
    );
    let question = &request.questions[&catch_me_up().to_string()];
    assert!(question.contains("Catch Me Up"));
    assert!(question.contains(system_skills::catch_me_up::SKILL.description));
}

#[test]
fn loaded_skills_render_as_one_tagged_section() {
    let rendered = render_loaded(&[LoadedSkill {
        id: Uuid::from_u128(7),
        name: "Release notes".to_string(),
        builtin: false,
        score: 0.9,
        content: "Write release notes as bullet points.".to_string(),
    }]);

    assert!(rendered.starts_with("\n<loaded_skills>\n"));
    assert!(rendered.contains(&format!(
        "<skill name=\"Release notes\" id=\"{}\">\nWrite release notes as bullet points.\n</skill>",
        Uuid::from_u128(7)
    )));
    assert!(rendered.ends_with("</loaded_skills>\n"));
    assert_eq!(render_loaded(&[]), "");
}
