use super::*;
use agent::types::{ChatMessage, ChatMessageContent, Role};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

fn skill(id: u128) -> LoadedSkill {
    LoadedSkill {
        id: Uuid::from_u128(id),
        name: format!("Skill {id}"),
        score: 0.9,
        content: format!("Instructions {id}."),
    }
}

fn ids(skills: &[(usize, LoadedSkill)]) -> Vec<(usize, u128)> {
    skills
        .iter()
        .map(|(turn, skill)| (*turn, skill.id.as_u128()))
        .collect()
}

fn message(role: Role, text: &str) -> ChatMessage {
    ChatMessage {
        content: ChatMessageContent::Text(text.to_owned()),
        role,
        attachments: None,
    }
}

fn text(message: &ChatMessage) -> &str {
    match &message.content {
        ChatMessageContent::Text(text) => text,
        ChatMessageContent::AssistantMessageParts(_) => panic!("not text"),
    }
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
fn a_session_keeps_each_skill_with_the_request_that_loaded_it() {
    let sessions = SessionSkills::default();
    let session = AgentSessionId::new();

    assert!(sessions.loaded(session).is_empty());
    sessions.add(session, 0, vec![skill(1)]);
    sessions.add(session, 2, vec![skill(2), skill(1)]);

    assert_eq!(ids(&sessions.loaded(session)), [(0, 1), (2, 2)]);
    assert_eq!(
        sessions.loaded_ids(session),
        [Uuid::from_u128(1), Uuid::from_u128(2)]
    );
    assert!(sessions.loaded(AgentSessionId::new()).is_empty());
}

#[test]
fn a_session_keeps_its_newest_skills_past_the_limit() {
    let sessions = SessionSkills::default();
    let session = AgentSessionId::new();

    for id in 1..=(SKILLS_PER_SESSION as u128 + 2) {
        sessions.add(session, id as usize, vec![skill(id)]);
    }

    let kept = ids(&sessions.loaded(session));
    assert_eq!(kept.len(), SKILLS_PER_SESSION);
    assert_eq!(kept.first(), Some(&(3, 3)));
}

#[tokio::test(start_paused = true)]
async fn idle_sessions_are_forgotten() {
    let sessions = SessionSkills::default();
    let idle = AgentSessionId::new();
    sessions.add(idle, 0, vec![skill(1)]);

    tokio::time::advance(SESSION_IDLE + Duration::from_secs(1)).await;
    sessions.add(AgentSessionId::new(), 0, vec![skill(2)]);

    assert!(sessions.loaded(idle).is_empty());
}

#[test]
fn loaded_skills_follow_the_request_that_loaded_them_in_the_context() {
    let mut messages = vec![
        message(Role::User, "first"),
        message(Role::Assistant, "reply"),
        message(Role::User, "second"),
        message(Role::User, "third"),
    ];

    inject(
        &mut messages,
        &[(0, skill(1)), (2, skill(2)), (2, skill(3)), (9, skill(4))],
    );

    let first = text(&messages[0]);
    assert!(first.starts_with("first\n\n<loaded_skills>\n"));
    assert!(first.contains("Instructions 1."));
    assert_eq!(text(&messages[1]), "reply");
    assert_eq!(text(&messages[2]), "second");
    let third = text(&messages[3]);
    assert!(third.contains("Instructions 2.") && third.contains("Instructions 3."));
    assert!(!third.contains("Instructions 4."));
}

#[test]
fn nothing_loaded_leaves_the_context_unchanged() {
    let mut messages = vec![message(Role::User, "only")];
    inject(&mut messages, &[]);
    assert_eq!(text(&messages[0]), "only");
}
