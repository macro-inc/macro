use std::sync::{Arc, Mutex};

use graphql_scheduled_action::{
    RoutineSuggestionsError, RoutineSuggestionsGraphql, RoutineSuggestionsGraphqlContext,
    SuggestionsFuture,
};
use macro_uuid::Uuid;
use routine_program::Surface;
use scheduled_action::domain::suggestions::model::{
    GenerationStatus, RoutineSuggestion, RoutineSuggestions, SuggestedPick, SuggestionFrom,
};

use super::*;

const SUGGESTION_ID: Uuid = Uuid::from_u128(0x5a99);

#[derive(Default)]
struct RecordingSuggestions {
    off: bool,
    calls: Mutex<Vec<String>>,
}

impl RecordingSuggestions {
    fn record(&self, call: String) -> Result<(), RoutineSuggestionsError> {
        self.calls.lock().expect("call lock").push(call);
        if self.off {
            return Err(RoutineSuggestionsError::Off);
        }
        Ok(())
    }
}

impl RoutineSuggestionsGraphql for RecordingSuggestions {
    fn suggestions(
        &self,
        user: MacroUserIdStr<'static>,
        surface: Option<Surface>,
    ) -> SuggestionsFuture<'_, RoutineSuggestions> {
        Box::pin(async move {
            self.record(format!("suggestions {user} {surface:?}"))?;
            let mut knobs = serde_json::Map::new();
            knobs.insert("label".to_owned(), serde_json::json!("Invoices"));
            Ok(RoutineSuggestions {
                status: GenerationStatus::Generating,
                suggestions: vec![RoutineSuggestion {
                    id: SUGGESTION_ID,
                    from: SuggestionFrom::ForYou,
                    surfaces: vec![Surface::Email, Surface::Tasks],
                    reason: Some("You file invoices by hand.".to_owned()),
                    keep_probability: Some(0.5),
                    on_by_default: true,
                    pick: SuggestedPick::Catalog {
                        key: "inbox".to_owned(),
                        knobs,
                    },
                }],
            })
        })
    }

    fn dismiss(&self, user: MacroUserIdStr<'static>, id: Uuid) -> SuggestionsFuture<'_, ()> {
        Box::pin(async move {
            self.record(format!("dismiss {user} {id}"))?;
            if id != SUGGESTION_ID {
                return Err(RoutineSuggestionsError::NotFound);
            }
            Ok(())
        })
    }

    fn start_generation(
        &self,
        user: MacroUserIdStr<'static>,
        timezone: chrono_tz::Tz,
    ) -> SuggestionsFuture<'_, bool> {
        Box::pin(async move {
            self.record(format!("generate {user} {timezone}"))?;
            Ok(true)
        })
    }
}

async fn run(suggestions: &Arc<RecordingSuggestions>, query: &str) -> async_graphql::Response {
    let harness = harness();
    let context = RoutineSuggestionsGraphqlContext(
        Arc::clone(suggestions) as Arc<dyn RoutineSuggestionsGraphql>
    );
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
async fn suggestions_serve_the_status_and_each_pick_for_the_viewers_surface() {
    let suggestions = Arc::new(RecordingSuggestions::default());
    let response = run(
        &suggestions,
        r#"{ user { routineSuggestions(surface: EMAIL) {
            status
            suggestions {
                id from surfaces reason keepProbability onByDefault
                pick { __typename ... on GraphqlCatalogRoutinePick { key knobs } }
            }
        } } }"#,
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["user"]["routineSuggestions"],
        serde_json::json!({
            "status": "GENERATING",
            "suggestions": [{
                "id": SUGGESTION_ID.to_string(),
                "from": "FOR_YOU",
                "surfaces": ["EMAIL", "TASKS"],
                "reason": "You file invoices by hand.",
                "keepProbability": 0.5,
                "onByDefault": true,
                "pick": {
                    "__typename": "GraphqlCatalogRoutinePick",
                    "key": "inbox",
                    "knobs": { "label": "Invoices" },
                },
            }],
        })
    );
    assert_eq!(
        *suggestions.calls.lock().expect("call lock"),
        [format!("suggestions {VALID_USER_ID} Some(Email)")]
    );
}

#[tokio::test]
async fn suggestions_being_off_answer_null_without_failing_the_user() {
    let suggestions = Arc::new(RecordingSuggestions {
        off: true,
        ..Default::default()
    });
    let response = run(
        &suggestions,
        r#"{ user { id routineSuggestions { status } } }"#,
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["user"],
        serde_json::json!({ "id": VALID_USER_ID, "routineSuggestions": null })
    );

    let dismissed = run(
        &suggestions,
        &format!(
            r#"mutation {{ dismissRoutineSuggestion(suggestionId: "{SUGGESTION_ID}") {{ suggestionId }} }}"#
        ),
    )
    .await;
    assert_eq!(code(&dismissed), "FEATURE_OFF");
}

#[tokio::test]
async fn dismissing_and_generating_run_for_the_viewer_with_typed_failures() {
    let suggestions = Arc::new(RecordingSuggestions::default());
    let unknown = Uuid::from_u128(0xdead);
    let response = run(
        &suggestions,
        &format!(
            r#"mutation {{
                dismissRoutineSuggestion(suggestionId: "{SUGGESTION_ID}") {{ suggestionId }}
                startSuggestionGeneration(timezone: "Europe/Paris") {{ started }}
            }}"#
        ),
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap(),
        serde_json::json!({
            "dismissRoutineSuggestion": { "suggestionId": SUGGESTION_ID.to_string() },
            "startSuggestionGeneration": { "started": true },
        })
    );

    let missing = run(
        &suggestions,
        &format!(
            r#"mutation {{ dismissRoutineSuggestion(suggestionId: "{unknown}") {{ suggestionId }} }}"#
        ),
    )
    .await;
    assert_eq!(code(&missing), "NOT_FOUND");

    let zone = run(
        &suggestions,
        r#"mutation { startSuggestionGeneration(timezone: "Mars/Olympus") { started } }"#,
    )
    .await;
    assert_eq!(code(&zone), "BAD_USER_INPUT");

    assert_eq!(
        *suggestions.calls.lock().expect("call lock"),
        [
            format!("dismiss {VALID_USER_ID} {SUGGESTION_ID}"),
            format!("generate {VALID_USER_ID} Europe/Paris"),
            format!("dismiss {VALID_USER_ID} {unknown}"),
        ]
    );
}
