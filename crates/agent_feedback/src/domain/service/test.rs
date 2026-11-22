use std::collections::{HashMap, HashSet};

use bot_id::{BotId, MACRO_NEW_BOT_ID};
use channel_sender::ChannelSender;
use entity_access::domain::models::ViewAccessLevel;

use super::*;
use crate::domain::model::{AgentKind, SubjectKind};
use crate::domain::ports::{RunFacts, SessionFacts, SuggestionFacts};
use crate::test_support::{
    FLAG_OFF, FLAGS_DOWN, PERSON, RATER, TEAMMATE, World, message, receipt, user,
};

const SESSION: Uuid = Uuid::from_u128(0x5E55);
const OTHER_SESSION: Uuid = Uuid::from_u128(0x5E56);
const CHANNEL: Uuid = Uuid::from_u128(0xC4A7);
const OTHER_CHANNEL: Uuid = Uuid::from_u128(0xC4A8);
const ROUTINE: Uuid = Uuid::from_u128(0x2007);
const OTHER_ROUTINE: Uuid = Uuid::from_u128(0x2008);
const RUN: Uuid = Uuid::from_u128(0x2017);
const BOT_MESSAGE: Uuid = Uuid::from_u128(0xB0B0);
const TEAMMATE_MESSAGE: Uuid = Uuid::from_u128(0x7EA7);
const PERSON_MESSAGE: Uuid = Uuid::from_u128(0x9E50);

fn turn(user_id: &str, turn: u32) -> RatedResponse {
    RatedResponse::AgentSessionTurn {
        session: receipt::<ViewAccessLevel>(
            user_id,
            &SESSION.to_string(),
            EntityType::AgentSession,
        ),
        turn,
    }
}

fn in_channel(user_id: &str, message_id: Uuid) -> RatedResponse {
    RatedResponse::Message {
        parent: MessageParent::Channel(CHANNEL),
        access: receipt(user_id, &CHANNEL.to_string(), EntityType::Channel),
        message_id,
    }
}

fn run_of(routine: Uuid, run_id: Uuid) -> RatedResponse {
    RatedResponse::RoutineRun {
        routine: receipt::<ViewAccessLevel>(
            RATER,
            &routine.to_string(),
            EntityType::ScheduledAction,
        ),
        run_id,
    }
}

fn up(id: u128) -> RateRequest {
    RateRequest {
        rater: Rater::Person,
        id: Uuid::from_u128(id),
        rating: Rating::Up,
        note: None,
        surface: Surface::AgentsView,
        trace_id: Some("4bf92f3577b34da6a3ce929d0e0e4736".to_owned()),
    }
}

fn down(id: u128, note: &str) -> RateRequest {
    RateRequest {
        rater: Rater::Person,
        id: Uuid::from_u128(id),
        rating: Rating::Down,
        note: Some(note.to_owned()),
        surface: Surface::AgentsView,
        trace_id: None,
    }
}

fn retraction(id: u128) -> RetractRequest {
    RetractRequest {
        rater: Rater::Person,
        id: Uuid::from_u128(id),
        surface: Surface::AgentsView,
        trace_id: None,
    }
}

/// `request`, from where `surface` shows the response.
fn seen_in(request: RateRequest, surface: Surface) -> RateRequest {
    RateRequest { surface, ..request }
}

/// A session run by the in-process Macro bot.
fn world_with_session() -> World {
    World {
        sessions: crate::test_support::FakeSessions(HashMap::from([(
            SESSION,
            SessionFacts {
                bot_id: MACRO_NEW_BOT_ID,
                harness: "macro".to_owned(),
                model: "claude-opus-5-5".to_owned(),
            },
        )])),
        ..World::default()
    }
}

#[tokio::test]
async fn flag_off_is_not_found_and_writes_nothing() {
    let (service, repo) = world_with_session().service();

    let rated = service.rate(turn(FLAG_OFF, 0), up(1)).await;
    let retracted = service.retract(turn(FLAG_OFF, 0), retraction(2)).await;
    let mine = service
        .mine(FeedbackContainer::AgentSession(receipt(
            FLAG_OFF,
            &SESSION.to_string(),
            EntityType::AgentSession,
        )))
        .await;

    assert!(matches!(rated, Err(FeedbackError::NotFound)));
    assert!(matches!(retracted, Err(FeedbackError::NotFound)));
    assert!(matches!(mine, Err(FeedbackError::NotFound)));
    assert!(repo.rows().is_empty());
}

#[tokio::test]
async fn unreadable_flags_or_no_flag_client_leave_the_feature_off() {
    let (service, repo) = world_with_session().service();
    let unreadable = service.rate(turn(FLAGS_DOWN, 0), up(1)).await;

    let mut world = world_with_session();
    world.flags = None;
    let (no_client, _) = world.service();
    let without_client = no_client.rate(turn(RATER, 0), up(2)).await;

    assert!(matches!(unreadable, Err(FeedbackError::NotFound)));
    assert!(matches!(without_client, Err(FeedbackError::NotFound)));
    assert!(repo.rows().is_empty());
}

#[tokio::test]
async fn a_rating_records_the_session_agent_and_the_trace() {
    let (service, repo) = world_with_session().service();

    let state = service.rate(turn(RATER, 3), up(1)).await.unwrap();

    assert_eq!(state.rating, Some(Rating::Up));
    let rows = repo.rows();
    assert_eq!(rows.len(), 1);
    let event = &rows[0].event;
    assert_eq!(event.subject_kind, SubjectKind::AgentSessionTurn);
    assert_eq!(event.container_id, SESSION.to_string());
    assert_eq!(event.subject_id, SESSION);
    assert_eq!(event.turn, Some(3));
    assert_eq!(event.agent_session_id, Some(SESSION));
    assert_eq!(event.agent_bot_id, Some(MACRO_NEW_BOT_ID.as_uuid()));
    assert_eq!(event.agent_kind, Some(AgentKind::SystemBot));
    assert_eq!(event.harness.as_deref(), Some("macro"));
    assert_eq!(event.model.as_deref(), Some("claude-opus-5-5"));
    assert_eq!(
        event.trace_id.as_deref(),
        Some("4bf92f3577b34da6a3ce929d0e0e4736")
    );
}

#[tokio::test]
async fn a_retried_rating_writes_one_row() {
    let (service, repo) = world_with_session().service();

    let first = service.rate(turn(RATER, 0), up(1)).await.unwrap();
    let retried = service.rate(turn(RATER, 0), up(1)).await.unwrap();

    assert_eq!(first, retried);
    assert_eq!(repo.rows().len(), 1);
}

#[tokio::test]
async fn rating_the_same_again_writes_nothing() {
    let (service, repo) = world_with_session().service();

    service.rate(turn(RATER, 0), up(1)).await.unwrap();
    let again = service.rate(turn(RATER, 0), up(2)).await.unwrap();

    assert_eq!(again.rating, Some(Rating::Up));
    assert_eq!(repo.rows().len(), 1);
}

#[tokio::test]
async fn changing_a_rating_or_its_note_appends_a_row() {
    let (service, repo) = world_with_session().service();

    service.rate(turn(RATER, 0), up(1)).await.unwrap();
    let changed = service
        .rate(turn(RATER, 0), down(2, "missed the question"))
        .await
        .unwrap();
    let renoted = service
        .rate(turn(RATER, 0), down(3, "missed the point"))
        .await
        .unwrap();

    assert_eq!(changed.rating, Some(Rating::Down));
    assert_eq!(renoted.note.as_deref(), Some("missed the point"));
    let rows = repo.rows();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[2].event.note.as_deref(), Some("missed the point"));
}

#[tokio::test]
async fn retracting_appends_a_row_without_a_rating_and_mine_leaves_it_out() {
    let (service, repo) = world_with_session().service();
    service.rate(turn(RATER, 0), up(1)).await.unwrap();
    service.rate(turn(RATER, 1), up(2)).await.unwrap();

    service
        .retract(turn(RATER, 0), retraction(3))
        .await
        .unwrap();
    let mine = service
        .mine(FeedbackContainer::AgentSession(receipt(
            RATER,
            &SESSION.to_string(),
            EntityType::AgentSession,
        )))
        .await
        .unwrap();

    let rows = repo.rows();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[2].event.rating, None);
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].turn, Some(1));
}

#[tokio::test]
async fn retracting_with_nothing_rated_writes_nothing() {
    let (service, repo) = world_with_session().service();

    service
        .retract(turn(RATER, 0), retraction(1))
        .await
        .unwrap();

    assert!(repo.rows().is_empty());
}

#[tokio::test]
async fn an_id_used_for_another_response_is_refused() {
    let (service, repo) = world_with_session().service();
    service.rate(turn(RATER, 0), up(1)).await.unwrap();

    let reused = service.rate(turn(RATER, 1), down(1, "")).await;

    assert!(matches!(reused, Err(FeedbackError::IdTaken)));
    assert_eq!(repo.rows().len(), 1);
}

#[tokio::test]
async fn notes_are_at_most_4000_characters_and_blank_is_none() {
    let (service, repo) = world_with_session().service();

    let too_long = service
        .rate(turn(RATER, 0), down(1, &"é".repeat(4001)))
        .await;
    let longest = service
        .rate(turn(RATER, 0), down(2, &"é".repeat(4000)))
        .await;
    let blank = service.rate(turn(RATER, 1), down(3, "  ")).await.unwrap();

    assert!(matches!(too_long, Err(FeedbackError::Invalid(_))));
    assert!(longest.is_ok());
    assert_eq!(blank.note, None);
    assert_eq!(repo.rows().len(), 2);
}

#[tokio::test]
async fn a_turn_past_what_postgres_stores_is_invalid() {
    let (service, repo) = world_with_session().service();

    let rated = service.rate(turn(RATER, u32::MAX), up(1)).await;

    assert!(matches!(rated, Err(FeedbackError::Invalid(_))));
    assert!(repo.rows().is_empty());
}

#[tokio::test]
async fn a_receipt_for_another_kind_of_entity_or_no_person_is_forbidden() {
    let (service, repo) = world_with_session().service();

    let wrong_kind = service
        .rate(
            RatedResponse::AgentSessionTurn {
                session: receipt(RATER, &SESSION.to_string(), EntityType::Document),
                turn: 0,
            },
            up(1),
        )
        .await;
    let internal = service
        .rate(
            RatedResponse::AgentSessionTurn {
                session: EntityAccessReceipt::dangerously_assert_internal_user(
                    &SESSION.to_string(),
                    EntityType::AgentSession,
                ),
                turn: 0,
            },
            up(2),
        )
        .await;
    let other_parent = service
        .rate(
            RatedResponse::Message {
                parent: MessageParent::Channel(OTHER_CHANNEL),
                access: receipt(RATER, &CHANNEL.to_string(), EntityType::Channel),
                message_id: BOT_MESSAGE,
            },
            up(3),
        )
        .await;

    assert!(matches!(wrong_kind, Err(FeedbackError::Forbidden)));
    assert!(matches!(internal, Err(FeedbackError::Forbidden)));
    assert!(matches!(other_parent, Err(FeedbackError::Forbidden)));
    assert!(repo.rows().is_empty());
}

/// A channel with an owned bot's reply linked to its session, a teammate's
/// message, and a person's message.
fn world_with_channel() -> World {
    let parent = MessageParent::Channel(CHANNEL);
    World {
        sessions: crate::test_support::FakeSessions(HashMap::from([(
            OTHER_SESSION,
            SessionFacts {
                bot_id: BotId::TEST_A,
                harness: "claude_code".to_owned(),
                model: "claude-sonnet-5-5".to_owned(),
            },
        )])),
        accounts: crate::test_support::FakeAccounts(HashSet::from([TEAMMATE.to_owned()])),
        messages: crate::test_support::FakeMessages(HashMap::from([
            (
                BOT_MESSAGE,
                message(
                    BOT_MESSAGE,
                    parent.clone(),
                    ChannelSender::new_from_bot(BotId::TEST_A),
                    &format!(
                        "<m-agent-session-mention>{{\"id\":\"{OTHER_SESSION}\",\"label\":\"\"}}</m-agent-session-mention>\nDone: the PR is up."
                    ),
                ),
            ),
            (
                TEAMMATE_MESSAGE,
                message(
                    TEAMMATE_MESSAGE,
                    parent.clone(),
                    ChannelSender::new_from_user(user(TEAMMATE)),
                    "I filed the ticket.",
                ),
            ),
            (
                PERSON_MESSAGE,
                message(
                    PERSON_MESSAGE,
                    parent,
                    ChannelSender::new_from_user(user(PERSON)),
                    "thanks!",
                ),
            ),
        ])),
        ..World::default()
    }
}

#[tokio::test]
async fn a_bots_message_records_the_bot_and_its_linked_session() {
    let (service, repo) = world_with_channel().service();

    service
        .rate(
            in_channel(RATER, BOT_MESSAGE),
            seen_in(up(1), Surface::MessageTimeline),
        )
        .await
        .unwrap();

    let event = &repo.rows()[0].event;
    assert_eq!(event.subject_kind, SubjectKind::Message);
    assert_eq!(event.container_id, CHANNEL.to_string());
    assert_eq!(event.subject_id, BOT_MESSAGE);
    assert_eq!(event.message_parent_type.as_deref(), Some("channel"));
    assert_eq!(event.agent_bot_id, Some(BotId::TEST_A.as_uuid()));
    assert_eq!(event.agent_kind, Some(AgentKind::OwnedBot));
    assert_eq!(event.agent_session_id, Some(OTHER_SESSION));
    assert_eq!(event.harness.as_deref(), Some("claude_code"));
    assert_eq!(event.model.as_deref(), Some("claude-sonnet-5-5"));
}

#[tokio::test]
async fn a_teammates_message_records_the_teammate() {
    let (service, repo) = world_with_channel().service();

    service
        .rate(
            in_channel(RATER, TEAMMATE_MESSAGE),
            seen_in(up(1), Surface::MessageThread),
        )
        .await
        .unwrap();

    let event = &repo.rows()[0].event;
    assert_eq!(event.agent_kind, Some(AgentKind::Teammate));
    assert_eq!(event.agent_user_id.as_deref(), Some(TEAMMATE));
    assert_eq!(event.agent_session_id, None);
}

#[tokio::test]
async fn a_persons_message_or_one_outside_the_parent_is_refused() {
    let (service, repo) = world_with_channel().service();

    let person = service
        .rate(
            in_channel(RATER, PERSON_MESSAGE),
            seen_in(up(1), Surface::MessageTimeline),
        )
        .await;
    let elsewhere = service
        .rate(
            RatedResponse::Message {
                parent: MessageParent::Channel(OTHER_CHANNEL),
                access: receipt(RATER, &OTHER_CHANNEL.to_string(), EntityType::Channel),
                message_id: BOT_MESSAGE,
            },
            seen_in(up(2), Surface::MessageTimeline),
        )
        .await;

    assert!(matches!(person, Err(FeedbackError::NotAgentAuthored)));
    assert!(matches!(
        elsewhere,
        Err(FeedbackError::SubjectNotInContainer)
    ));
    assert!(repo.rows().is_empty());
}

#[tokio::test]
async fn a_run_records_its_session_and_a_run_of_another_routine_is_refused() {
    let mut world = world_with_session();
    world.runs = crate::test_support::FakeRuns(HashMap::from([(
        (ROUTINE, RUN),
        RunFacts {
            agent_session_id: Some(AgentSessionId::new_from_uuid(SESSION)),
        },
    )]));
    let (service, repo) = world.service();

    service
        .rate(run_of(ROUTINE, RUN), seen_in(up(1), Surface::RoutineRun))
        .await
        .unwrap();
    let elsewhere = service
        .rate(
            run_of(OTHER_ROUTINE, RUN),
            seen_in(up(2), Surface::RoutineRun),
        )
        .await;

    assert!(matches!(
        elsewhere,
        Err(FeedbackError::SubjectNotInContainer)
    ));
    let rows = repo.rows();
    assert_eq!(rows.len(), 1);
    let event = &rows[0].event;
    assert_eq!(event.subject_kind, SubjectKind::RoutineRun);
    assert_eq!(event.container_id, ROUTINE.to_string());
    assert_eq!(event.subject_id, RUN);
    assert_eq!(event.agent_session_id, Some(SESSION));
    assert_eq!(event.model.as_deref(), Some("claude-opus-5-5"));
}

#[tokio::test]
async fn export_pages_say_where_the_next_starts_until_the_last() {
    let (service, _) = world_with_session().service();
    for id in 1..=3 {
        service
            .rate(turn(RATER, id), up(u128::from(id)))
            .await
            .unwrap();
    }
    let two = ExportLimit::new(2).unwrap();

    let first = service.export(None, two).await.unwrap();
    let second = service.export(first.next, two).await.unwrap();

    assert_eq!(first.items.len(), 2);
    assert!(first.next.is_some());
    assert_eq!(second.items.len(), 1);
    assert_eq!(second.next, None);
    assert_eq!(second.items[0].turn, Some(3));
}

#[tokio::test]
async fn a_program_never_writes() {
    let (service, repo) = world_with_session().service();

    let rated = service
        .rate(
            turn(RATER, 0),
            RateRequest {
                rater: Rater::Program,
                ..up(1)
            },
        )
        .await;
    let retracted = service
        .retract(
            turn(RATER, 0),
            RetractRequest {
                rater: Rater::Program,
                ..retraction(2)
            },
        )
        .await;

    assert!(matches!(rated, Err(FeedbackError::ProgramRun)));
    assert!(matches!(retracted, Err(FeedbackError::ProgramRun)));
    assert!(repo.rows().is_empty());
}

#[tokio::test]
async fn a_surface_that_does_not_show_the_response_is_invalid() {
    let (service, repo) = world_with_channel().service();

    let rated = service
        .rate(
            in_channel(RATER, BOT_MESSAGE),
            seen_in(up(1), Surface::RoutineRun),
        )
        .await;

    assert!(matches!(rated, Err(FeedbackError::Invalid(_))));
    assert!(repo.rows().is_empty());
}

const SUGGESTION: Uuid = Uuid::from_u128(0x5066);
const OTHER_SUGGESTION: Uuid = Uuid::from_u128(0x5067);

fn suggestion(user_id: &str) -> RatedResponse {
    RatedResponse::Suggestion {
        user: user(user_id),
        suggestion_id: SUGGESTION,
    }
}

/// RATER's suggestion, made by a session the Macro bot ran.
fn world_with_suggestion() -> World {
    World {
        suggestions: crate::test_support::FakeSuggestions(HashMap::from([(
            (RATER.to_owned(), SUGGESTION),
            SuggestionFacts {
                agent_session_id: Some(AgentSessionId::new_from_uuid(SESSION)),
            },
        )])),
        ..world_with_session()
    }
}

#[tokio::test]
async fn a_suggestion_records_the_session_that_made_it_and_lists_by_id() {
    let (service, repo) = world_with_suggestion().service();

    service
        .rate(suggestion(RATER), seen_in(up(1), Surface::SuggestionTile))
        .await
        .unwrap();
    let mine = service
        .mine(FeedbackContainer::Suggestions {
            user: user(RATER),
            ids: vec![SUGGESTION, OTHER_SUGGESTION, SUGGESTION],
        })
        .await
        .unwrap();

    let event = &repo.rows()[0].event;
    assert_eq!(event.subject_kind, SubjectKind::Suggestion);
    assert_eq!(event.container_id, SUGGESTION.to_string());
    assert_eq!(event.subject_id, SUGGESTION);
    assert_eq!(event.turn, None);
    assert_eq!(event.agent_session_id, Some(SESSION));
    assert_eq!(event.model.as_deref(), Some("claude-opus-5-5"));
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].subject_id, SUGGESTION);
}

#[tokio::test]
async fn someone_elses_suggestion_is_forbidden_and_too_many_ids_invalid() {
    let mut world = world_with_suggestion();
    world.suggestions.0.insert(
        (PERSON.to_owned(), OTHER_SUGGESTION),
        SuggestionFacts {
            agent_session_id: None,
        },
    );
    let (service, repo) = world.service();

    let theirs = service
        .rate(
            RatedResponse::Suggestion {
                user: user(RATER),
                suggestion_id: OTHER_SUGGESTION,
            },
            seen_in(up(1), Surface::SuggestionRow),
        )
        .await;
    let too_many = service
        .mine(FeedbackContainer::Suggestions {
            user: user(RATER),
            ids: (0..101).map(Uuid::from_u128).collect(),
        })
        .await;

    assert!(matches!(theirs, Err(FeedbackError::Forbidden)));
    assert!(matches!(too_many, Err(FeedbackError::Invalid(_))));
    assert!(repo.rows().is_empty());
}
