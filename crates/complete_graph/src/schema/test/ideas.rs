use std::sync::{Arc, Mutex};

use ::ideas::domain::model::{
    Category, Idea, IdeaError, IdeaKind, IdeaRun, IdeaState, Ideas, RunMode, RunProgress, Target,
};
use chrono::TimeZone;
use graphql_ideas::{IdeaFuture, IdeasGraphql, IdeasGraphqlContext};
use macro_uuid::Uuid;

use super::*;

const IDEA_ID: Uuid = Uuid::from_u128(0x1dea);
const SESSION_ID: Uuid = Uuid::from_u128(0x5e55);

/// Ideas for one viewer; `off` answers as the service does when the flag is
/// off for them.
#[derive(Default)]
struct RecordingIdeas {
    off: bool,
    calls: Mutex<Vec<String>>,
}

impl RecordingIdeas {
    fn record(&self, call: String) -> Result<(), IdeaError> {
        self.calls.lock().expect("call lock").push(call);
        if self.off {
            return Err(IdeaError::NotFound);
        }
        Ok(())
    }
}

fn idea(state: IdeaState) -> Idea {
    let at = chrono::Utc.with_ymd_and_hms(2026, 11, 10, 9, 0, 0).unwrap();
    Idea {
        id: IDEA_ID,
        dedup_key: "renewal".to_owned(),
        title: "Draft the renewal summary".to_owned(),
        summary: "The contract renews on Friday.".to_owned(),
        importance: 80,
        categories: vec![Category::Important, Category::SaveMoney],
        state,
        state_reason: None,
        about: vec![Target {
            entity_type: model_entity::EntityType::EmailThread,
            entity_id: "thread-1".to_owned(),
            part_id: Some("message-1".to_owned()),
        }],
        produced: Vec::new(),
        created_at: at,
        updated_at: at,
        state_changed_at: at,
        run: Some(IdeaRun {
            session_id: SESSION_ID,
            started_at: at,
            progress: RunProgress::NeedsInput,
        }),
        kind: IdeaKind::Prompt {
            prompt: "Summarize the renewal terms".to_owned(),
            run_mode: RunMode::Background,
        },
    }
}

impl IdeasGraphql for RecordingIdeas {
    fn feed(&self, user: MacroUserIdStr<'static>) -> IdeaFuture<'_, Ideas> {
        Box::pin(async move {
            self.record(format!("feed {user}"))?;
            Ok(Ideas {
                ideas: vec![idea(IdeaState::Proposed)],
            })
        })
    }

    fn seen(&self, user: MacroUserIdStr<'static>, timezone: chrono_tz::Tz) -> IdeaFuture<'_, ()> {
        Box::pin(async move { self.record(format!("seen {user} {timezone}")) })
    }

    fn accept(&self, user: MacroUserIdStr<'static>, id: Uuid) -> IdeaFuture<'_, Idea> {
        Box::pin(async move {
            self.record(format!("accept {user} {id}"))?;
            if id != IDEA_ID {
                return Err(IdeaError::NotFound);
            }
            Ok(idea(IdeaState::Accepted))
        })
    }

    fn dismiss(&self, user: MacroUserIdStr<'static>, id: Uuid) -> IdeaFuture<'_, Idea> {
        Box::pin(async move {
            self.record(format!("dismiss {user} {id}"))?;
            Ok(idea(IdeaState::Dismissed))
        })
    }
}

async fn run(ideas: &Arc<RecordingIdeas>, query: &str) -> async_graphql::Response {
    let harness = harness();
    let context = IdeasGraphqlContext(Arc::clone(ideas) as Arc<dyn IdeasGraphql>);
    harness
        .schema
        .execute(
            harness
                .request(query, authenticated_parts())
                // What the mounting handler inserts for an authenticated caller.
                .data(MacroUserIdStr::parse_from_str(VALID_USER_ID).expect("user id"))
                .data(context),
        )
        .await
}

fn code(response: &async_graphql::Response) -> serde_json::Value {
    let error = serde_json::to_value(&response.errors[0]).expect("error");
    error["extensions"]["code"].clone()
}

#[tokio::test]
async fn the_feed_serves_the_viewers_ideas_with_their_kind_and_run() {
    let ideas = Arc::new(RecordingIdeas::default());
    let response = run(
        &ideas,
        r#"{ user { ideaFeed { ideas {
            id title summary importance categories state stateReason
            about { entityType entityId partId }
            run { sessionId progress }
            kind { __typename ... on GraphqlPromptIdea { prompt runMode } }
        } } } }"#,
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["user"]["ideaFeed"]["ideas"],
        serde_json::json!([{
            "id": IDEA_ID.to_string(),
            "title": "Draft the renewal summary",
            "summary": "The contract renews on Friday.",
            "importance": 80,
            "categories": ["IMPORTANT", "SAVE_MONEY"],
            "state": "PROPOSED",
            "stateReason": null,
            "about": [{ "entityType": "EMAIL_THREAD", "entityId": "thread-1", "partId": "message-1" }],
            "run": { "sessionId": SESSION_ID.to_string(), "progress": "NEEDS_INPUT" },
            "kind": {
                "__typename": "GraphqlPromptIdea",
                "prompt": "Summarize the renewal terms",
                "runMode": "BACKGROUND",
            },
        }])
    );
    assert_eq!(
        *ideas.calls.lock().expect("call lock"),
        [format!("feed {VALID_USER_ID}")]
    );
}

#[tokio::test]
async fn ideas_being_off_answers_null_without_failing_the_user() {
    let ideas = Arc::new(RecordingIdeas {
        off: true,
        ..Default::default()
    });
    let response = run(&ideas, r#"{ user { id ideaFeed { ideas { id } } } }"#).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["user"],
        serde_json::json!({ "id": VALID_USER_ID, "ideaFeed": null })
    );

    let seen = run(
        &ideas,
        r#"mutation { recordIdeasSeen(timezone: "Europe/Paris") }"#,
    )
    .await;
    assert!(seen.errors.is_empty(), "{:?}", seen.errors);
    assert_eq!(
        seen.data.into_json().unwrap(),
        serde_json::json!({ "recordIdeasSeen": false })
    );
}

#[tokio::test]
async fn accepting_and_dismissing_answer_with_the_idea_as_the_write_left_it() {
    let ideas = Arc::new(RecordingIdeas::default());
    let response = run(
        &ideas,
        &format!(
            r#"mutation {{
                accepted: acceptIdea(ideaId: "{IDEA_ID}") {{ id state }}
                dismissed: dismissIdea(ideaId: "{IDEA_ID}") {{ id state }}
                recordIdeasSeen(timezone: "America/New_York")
            }}"#
        ),
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap(),
        serde_json::json!({
            "accepted": { "id": IDEA_ID.to_string(), "state": "ACCEPTED" },
            "dismissed": { "id": IDEA_ID.to_string(), "state": "DISMISSED" },
            "recordIdeasSeen": true,
        })
    );
    assert_eq!(
        *ideas.calls.lock().expect("call lock"),
        [
            format!("accept {VALID_USER_ID} {IDEA_ID}"),
            format!("dismiss {VALID_USER_ID} {IDEA_ID}"),
            format!("seen {VALID_USER_ID} America/New_York"),
        ]
    );
}

#[tokio::test]
async fn idea_mutations_fail_with_typed_codes() {
    let ideas = Arc::new(RecordingIdeas::default());
    let unknown = Uuid::from_u128(0xdead);

    let missing = run(
        &ideas,
        &format!(r#"mutation {{ acceptIdea(ideaId: "{unknown}") {{ id }} }}"#),
    )
    .await;
    assert_eq!(code(&missing), "NOT_FOUND");

    let malformed = run(&ideas, r#"mutation { dismissIdea(ideaId: "nope") { id } }"#).await;
    assert_eq!(code(&malformed), "BAD_USER_INPUT");

    let zone = run(
        &ideas,
        r#"mutation { recordIdeasSeen(timezone: "Mars/Olympus") }"#,
    )
    .await;
    assert_eq!(code(&zone), "BAD_USER_INPUT");

    // Malformed input never reaches the service.
    assert_eq!(
        *ideas.calls.lock().expect("call lock"),
        [format!("accept {VALID_USER_ID} {unknown}")]
    );
}
