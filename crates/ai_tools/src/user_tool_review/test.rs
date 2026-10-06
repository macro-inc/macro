//! The review form is projected from a tool's own schema, the user's answer
//! is applied over the draft, and the finisher runs the wrapped tool with
//! what came back - or reports what stopped it.

use std::sync::Mutex;

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::*;
use crate::{AiHost, tools_for};

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@macro.com").expect("a valid user id")
}

fn field<'form>(form: &'form ReviewForm, name: &str) -> &'form ReviewField {
    form.fields
        .iter()
        .find(|field| field.name == name)
        .unwrap_or_else(|| panic!("the form has a {name} field: {form:#?}"))
}

/// The real `CreateCalendarEvent` schema, from the chat toolset that
/// registers it as a user tool.
fn create_calendar_event_schema() -> Map<String, Value> {
    let tools = tools_for(AiHost::Chat);
    tools
        .toolset
        .user_tools
        .get("CreateCalendarEvent")
        .expect("chat registers CreateCalendarEvent as a user tool")
        .input_schema
        .clone()
}

#[test]
fn the_form_shows_a_tools_flat_arguments_prefilled_and_leaves_the_rest_to_the_draft() {
    let schema = create_calendar_event_schema();
    let draft = json!({
        "title": "Q3 sync",
        "time": {"kind": "timed", "startsAt": "2026-08-20T17:00:00Z", "endsAt": "2026-08-20T17:30:00Z"},
        "location": "Room 4",
        "attendees": [{"email": "alice@example.com"}],
        "addGoogleMeet": true,
    });
    let form = project_form(Some("Create calendar event".to_owned()), &schema, &draft);

    assert_eq!(form.title.as_deref(), Some("Create calendar event"));
    assert_eq!(
        field(&form, "title").kind,
        ReviewFieldKind::Text {
            default: Some("Q3 sync".to_owned()),
            format: None,
        }
    );
    assert_eq!(
        field(&form, "location").kind,
        ReviewFieldKind::Text {
            default: Some("Room 4".to_owned()),
            format: None,
        },
        "an optional string reads through its nullable wrapper"
    );
    assert_eq!(
        field(&form, "addGoogleMeet").kind,
        ReviewFieldKind::Boolean {
            default: Some(true)
        }
    );
    assert!(
        field(&form, "description").description.is_some(),
        "field help comes from the schema"
    );
    assert_eq!(
        field(&form, "eventType").kind,
        ReviewFieldKind::Choice {
            options: vec!["default".to_owned(), "out_of_office".to_owned()],
            default: None,
        },
        "an enum is a choice, unset when the draft omits it"
    );
    // Objects and arrays have no flat shape: they ride in the draft field.
    for nested in [
        "time",
        "attendees",
        "reminders",
        "outOfOffice",
        "recurrenceLines",
    ] {
        assert!(
            form.fields.iter().all(|field| field.name != nested),
            "{nested} is not a flat field"
        );
    }
    assert_eq!(field(&form, DRAFT_FIELD).kind, ReviewFieldKind::Json);
    assert_eq!(
        form.required,
        vec!["title".to_owned()],
        "the schema's requirements, flat ones only"
    );
}

#[test]
fn the_answer_is_applied_over_the_draft_and_a_whole_draft_wins() {
    let draft = json!({"title": "Q3 sync", "location": "Room 4", "time": {"kind": "allDay"}});

    // Flat fields replace the arguments of the same name; the rest stays.
    let flat = BTreeMap::from([
        ("title".to_owned(), json!("Q3 planning")),
        ("addGoogleMeet".to_owned(), json!(true)),
    ]);
    assert_eq!(
        apply_review(&draft, &flat),
        json!({"title": "Q3 planning", "location": "Room 4", "time": {"kind": "allDay"}, "addGoogleMeet": true})
    );

    // A whole draft, as the JSON string a composer sends, replaces everything.
    let whole = BTreeMap::from([
        ("title".to_owned(), json!("ignored")),
        (
            DRAFT_FIELD.to_owned(),
            json!(r#"{"title":"From the composer","time":{"kind":"allDay"}}"#),
        ),
    ]);
    assert_eq!(
        apply_review(&draft, &whole),
        json!({"title": "From the composer", "time": {"kind": "allDay"}})
    );

    // A draft field that is not an object is ignored, not applied.
    let broken = BTreeMap::from([
        ("title".to_owned(), json!("Kept")),
        (DRAFT_FIELD.to_owned(), json!("not json")),
    ]);
    assert_eq!(apply_review(&draft, &broken)["title"], "Kept");
    assert!(apply_review(&draft, &broken).get(DRAFT_FIELD).is_none());

    // Nothing submitted: the draft as it was.
    assert_eq!(apply_review(&draft, &BTreeMap::new()), draft);
}

// --- the finisher, over a toolset with one user tool ---

#[derive(Debug, Clone, PartialEq, Deserialize, JsonSchema)]
#[schemars(title = "Greet", description = "Greets someone.")]
struct Greet {
    /// Who to greet.
    name: String,
    /// Whether to shout.
    #[serde(default)]
    loud: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
struct Greeting {
    text: String,
}

impl ToolAnnotated for Greet {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Greet someone");
}

/// Records every call it runs.
#[derive(Clone, Default)]
struct Ran(Arc<Mutex<Vec<Greet>>>);

#[async_trait]
impl AsyncTool<Ran> for Greet {
    type Output = Greeting;

    async fn call(
        &self,
        context: ServiceContext<Ran>,
        _request: RequestContext,
    ) -> ToolResult<Self::Output> {
        if self.name == "nobody" {
            return Err(ToolCallError {
                description: "nobody is not a person".to_owned(),
                internal_error: anyhow::anyhow!("nobody"),
            });
        }
        context.0.0.lock().unwrap().push(self.clone());
        let text = format!("Hello, {}{}", self.name, if self.loud { "!" } else { "." });
        Ok(Greeting { text })
    }
}

/// A reviewer that records what it was asked and answers as scripted.
struct Scripted {
    asked: Mutex<Vec<ReviewRequest>>,
    answer: Result<ReviewOutcome, ReviewError>,
}

#[async_trait]
impl UserToolReviewer for Scripted {
    async fn review(&self, request: ReviewRequest) -> Result<ReviewOutcome, ReviewError> {
        self.asked.lock().unwrap().push(request);
        self.answer.clone()
    }
}

fn finisher_over_greet(
    answer: Result<ReviewOutcome, ReviewError>,
) -> (UserToolFinisher, Arc<Scripted>, Ran) {
    let tools = Arc::new(AsyncToolCollection::<Ran>::new().add_user_tool::<Greet, Ran>());
    let ran = Ran::default();
    let reviewer = Arc::new(Scripted {
        asked: Mutex::new(Vec::new()),
        answer,
    });
    let finisher = user_tool_finisher(
        tools,
        ran.clone(),
        owner(),
        Arc::clone(&reviewer) as Arc<dyn UserToolReviewer>,
        CancellationToken::new(),
    );
    (finisher, reviewer, ran)
}

fn pending(args: Value) -> PendingUserTool {
    PendingUserTool {
        tool_name: "Greet".to_owned(),
        tool_call_id: "toolu_1".to_owned(),
        args,
    }
}

#[tokio::test]
async fn an_accepted_review_runs_the_tool_with_the_edited_arguments() {
    let (finisher, reviewer, ran) = finisher_over_greet(Ok(ReviewOutcome::Accepted(
        BTreeMap::from([("loud".to_owned(), json!(true))]),
    )));

    let finished = finisher(pending(json!({"name": "Alice", "loud": false}))).await;

    let asked = reviewer.asked.lock().unwrap();
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].tool_name, "Greet");
    assert_eq!(asked[0].tool_call_id, "toolu_1");
    assert_eq!(asked[0].message, "Greet someone?");
    assert_eq!(asked[0].draft, json!({"name": "Alice", "loud": false}));
    assert_eq!(
        field(&asked[0].form, "name").kind,
        ReviewFieldKind::Text {
            default: Some("Alice".to_owned()),
            format: None,
        }
    );
    assert_eq!(asked[0].form.required, vec!["name".to_owned()]);

    assert_eq!(
        &*ran.0.lock().unwrap(),
        &[Greet {
            name: "Alice".to_owned(),
            loud: true,
        }]
    );
    assert_eq!(
        finished,
        Some(FinishedUserTool::Result(
            json!({"UserAction": {"text": "Hello, Alice!"}})
        )),
        "the answer is the user tool response chat writes"
    );
}

#[tokio::test]
async fn a_declined_review_rejects_without_running() {
    let (finisher, _reviewer, ran) = finisher_over_greet(Ok(ReviewOutcome::Declined));
    let finished = finisher(pending(json!({"name": "Alice"}))).await;
    assert!(ran.0.lock().unwrap().is_empty());
    assert_eq!(finished, Some(FinishedUserTool::Result(json!("Rejected"))));
}

#[tokio::test]
async fn a_cancelled_review_and_an_unavailable_reviewer_fail_the_call_closed() {
    let (finisher, _reviewer, ran) = finisher_over_greet(Ok(ReviewOutcome::Cancelled));
    let Some(FinishedUserTool::Error(message)) = finisher(pending(json!({"name": "Alice"}))).await
    else {
        panic!("a cancelled review is an error the model reads");
    };
    assert!(message.contains("cancelled"), "{message}");
    assert!(ran.0.lock().unwrap().is_empty());

    let (finisher, _reviewer, ran) = finisher_over_greet(Err(ReviewError::Unavailable(
        "another question is pending".to_owned(),
    )));
    let Some(FinishedUserTool::Error(message)) = finisher(pending(json!({"name": "Alice"}))).await
    else {
        panic!("an unavailable reviewer is an error the model reads");
    };
    assert!(message.contains("another question is pending"), "{message}");
    assert!(ran.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn edited_arguments_the_tool_rejects_never_run() {
    let (finisher, _reviewer, ran) = finisher_over_greet(Ok(ReviewOutcome::Accepted(
        BTreeMap::from([("name".to_owned(), json!(42))]),
    )));
    let Some(FinishedUserTool::Error(message)) = finisher(pending(json!({"name": "Alice"}))).await
    else {
        panic!("invalid arguments are an error the model reads");
    };
    assert!(message.contains("not valid"), "{message}");
    assert!(ran.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_tool_failure_after_acceptance_is_the_tools_own_error() {
    let (finisher, _reviewer, _ran) =
        finisher_over_greet(Ok(ReviewOutcome::Accepted(BTreeMap::new())));
    assert_eq!(
        finisher(pending(json!({"name": "nobody"}))).await,
        Some(FinishedUserTool::Error("nobody is not a person".to_owned()))
    );
}

#[tokio::test]
async fn a_tool_the_toolset_does_not_know_as_a_user_tool_is_left_alone() {
    let (finisher, reviewer, _ran) =
        finisher_over_greet(Ok(ReviewOutcome::Accepted(BTreeMap::new())));
    let finished = finisher(PendingUserTool {
        tool_name: "SomethingElse".to_owned(),
        tool_call_id: "toolu_2".to_owned(),
        args: json!({}),
    })
    .await;
    assert_eq!(finished, None);
    assert!(reviewer.asked.lock().unwrap().is_empty());
}
