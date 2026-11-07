use super::*;
use crate::testing::{InMemoryAgentSessionRepo, test_agent_session};
use agent_fold::testing::{TURN, parse_log_as};
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission};
use macro_user_id::user_id::MacroUserIdStr;

#[tokio::test]
async fn reads_only_the_authorized_session_and_folds_streamed_chunks() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = AgentSessionId::TEST_A;
    repo.insert_session(test_agent_session(session));
    repo.extend_log(parse_log_as(session, TURN));
    repo.extend_log(parse_log_as(
        AgentSessionId::TEST_B,
        &TURN.replace("list the examples", "PRIVATE OTHER SESSION"),
    ));
    let access = EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::try_from_email("viewer@example.com").expect("viewer"),
        Entity {
            entity_id: session.to_string(),
            entity_type: EntityType::AgentSession,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .expect("view receipt");
    let result = SessionReader::new(repo)
        .read(access, None)
        .await
        .expect("conversation");
    assert_eq!(result.messages.len(), 2);
    assert_eq!(
        result.messages[0].content,
        "list the examples and write a file"
    );
    assert!(result.messages[1].content.contains("Sure, "));
    assert!(
        !serde_json::to_string(&result)
            .expect("json")
            .contains("PRIVATE OTHER SESSION")
    );
    assert!(!result.truncated);
}

#[tokio::test]
async fn refuses_a_receipt_for_another_entity_type_before_reading_storage() {
    let repo = InMemoryAgentSessionRepo::new();
    let access = EntityAccessReceipt::try_new_authenticated_user(
        MacroUserIdStr::try_from_email("viewer@example.com").expect("viewer"),
        Entity {
            entity_id: AgentSessionId::TEST_A.to_string(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .expect("view receipt");
    let result = SessionReader::new(repo.clone()).read(access, None).await;
    assert!(matches!(result, Err(AgentSessionError::Forbidden)));
    assert_eq!(repo.session_reads(), 0);
    assert_eq!(repo.log_reads(), 0);
}

#[test]
fn keeps_recent_history_and_allows_selecting_an_earlier_turn() {
    let mut messages = Vec::new();
    for turn in 0..15 {
        let mut pair = fold(parse_log_as(AgentSessionId::TEST_A, TURN));
        for message in &mut pair {
            message.id.0 = turn;
        }
        messages.extend(pair);
    }
    let recent = conversation(
        &test_agent_session(AgentSessionId::TEST_A),
        messages.clone(),
        None,
    );
    assert_eq!(recent.total_messages, 30);
    assert_eq!(recent.messages.len(), 20);
    assert_eq!(recent.messages[0].turn, 5);
    assert_eq!(recent.messages[19].turn, 14);
    assert!(recent.truncated);
    let earlier = conversation(
        &test_agent_session(AgentSessionId::TEST_A),
        messages,
        Some(2),
    );
    assert_eq!(earlier.messages.len(), 2);
    assert!(earlier.messages.iter().all(|message| message.turn == 2));
    assert!(!earlier.truncated);
}

#[test]
fn preserves_failures_and_bounds_unicode_text_without_splitting_characters() {
    let mut messages = fold(parse_log_as(AgentSessionId::TEST_A, TURN));
    messages[1].parts =
        non_empty::NonEmpty::new(vec![agent_fold::domain::model::MessagePart::Text {
            text: "🦀".repeat(4_001),
        }])
        .expect("one part");
    messages[1].stop = Some(agent_fold::domain::model::StopReason::Failed {
        message: "Unknown tool mcp__missing".into(),
        notice: None,
    });
    let result = conversation(&test_agent_session(AgentSessionId::TEST_A), messages, None);
    assert_eq!(
        result.messages[1].failure.as_deref(),
        Some("Unknown tool mcp__missing")
    );
    assert!(result.messages[1].truncated);
    let text = TURN.replace("list the examples and write a file", &"🦀".repeat(4_001));
    let result = conversation(
        &test_agent_session(AgentSessionId::TEST_A),
        fold(parse_log_as(AgentSessionId::TEST_A, &text)),
        None,
    );
    assert_eq!(result.messages[0].content.chars().count(), 4_000);
    assert!(result.messages[0].truncated);
    assert!(result.truncated);
}

#[test]
fn reports_truncated_failures_even_when_search_text_omits_them() {
    let mut messages = fold(parse_log_as(AgentSessionId::TEST_A, TURN));
    messages[1].stop = Some(agent_fold::domain::model::StopReason::Failed {
        message: " ".repeat(MAX_MESSAGE_CHARS + 1),
        notice: None,
    });
    let result = conversation(&test_agent_session(AgentSessionId::TEST_A), messages, None);
    assert_eq!(
        result.messages[1].failure.as_deref(),
        Some(" ".repeat(MAX_MESSAGE_CHARS).as_str())
    );
    assert!(result.messages[1].truncated);
    assert!(result.truncated);
}
