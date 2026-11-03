use super::*;
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

fn skill(id: u128) -> LoadedSkill {
    LoadedSkill {
        id: Uuid::from_u128(id),
        name: format!("Skill {id}"),
        builtin: false,
        score: 0.9,
        content: format!("Instructions {id}."),
    }
}

fn ids(skills: &[LoadedSkill]) -> Vec<u128> {
    skills.iter().map(|skill| skill.id.as_u128()).collect()
}

#[tokio::test]
async fn only_flagged_owners_route_and_failures_do_not() {
    let owners: Vec<_> = ["enabled", "disabled", "failure"]
        .map(|name| MacroUserIdStr::try_from(format!("macro|{name}@example.com")).unwrap())
        .into();
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        owners[0].clone(),
        Ok(FlagSnapshot::new([(
            AUTO_SKILLS.into(),
            FlagValue::Boolean(true),
        )])),
    );
    flags.set(
        owners[1].clone(),
        Ok(FlagSnapshot::new([(
            AUTO_SKILLS.into(),
            FlagValue::Boolean(false),
        )])),
    );
    flags.set(owners[2].clone(), Err("provider unavailable".into()));
    let policy = FlaggedSkillRouting::new(flags);

    assert!(policy.routes(&owners[0]).await);
    assert!(!policy.routes(&owners[1]).await);
    assert!(!policy.routes(&owners[2]).await);
    assert!(!NoSkillRouting.routes(&owners[0]).await);
}

#[test]
fn a_session_keeps_every_skill_it_loaded_in_load_order() {
    let sessions = SessionSkills::default();
    let session = AgentSessionId::new();

    assert!(sessions.loaded(session).is_empty());
    assert_eq!(ids(&sessions.add(session, vec![skill(1)])), [1]);
    assert_eq!(
        ids(&sessions.add(session, vec![skill(2), skill(1)])),
        [1, 2]
    );
    assert_eq!(ids(&sessions.loaded(session)), [1, 2]);
    assert!(sessions.loaded(AgentSessionId::new()).is_empty());
}

#[test]
fn a_session_keeps_its_newest_skills_past_the_limit() {
    let sessions = SessionSkills::default();
    let session = AgentSessionId::new();

    for id in 1..=(SKILLS_PER_SESSION as u128 + 2) {
        sessions.add(session, vec![skill(id)]);
    }

    let kept = ids(&sessions.loaded(session));
    assert_eq!(kept.len(), SKILLS_PER_SESSION);
    assert_eq!(kept.first(), Some(&3));
}

#[tokio::test(start_paused = true)]
async fn idle_sessions_are_forgotten() {
    let sessions = SessionSkills::default();
    let idle = AgentSessionId::new();
    sessions.add(idle, vec![skill(1)]);

    tokio::time::advance(SESSION_IDLE + Duration::from_secs(1)).await;
    sessions.add(AgentSessionId::new(), vec![skill(2)]);

    assert!(sessions.loaded(idle).is_empty());
}
