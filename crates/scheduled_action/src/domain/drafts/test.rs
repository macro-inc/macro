use std::collections::VecDeque;
use std::sync::Mutex;

use ai_billing::{AdmissionFuture, AiAdmissionError, DisabledAiAdmissionService};
use serde_json::json;

use super::*;
use crate::domain::code_check::test::Checker;

const OWNER: &str = "macro|owner@example.com";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(OWNER).unwrap()
}

/// Answers each request for a draft with the next queued answer, `None` once
/// they run out, and every request for symbols to read with `symbols`.
/// Records both.
#[derive(Default)]
struct Model {
    answers: Mutex<VecDeque<Option<Value>>>,
    asked: Mutex<Vec<(String, String, Value)>>,
    symbols: Vec<String>,
    symbol_requests: Mutex<Vec<String>>,
    /// The names it lists for lookup.
    lookups: Vec<Value>,
    /// Never answers a draft.
    hangs: bool,
}

impl Model {
    fn answering(answers: impl IntoIterator<Item = Option<Value>>) -> Arc<Self> {
        Arc::new(Self {
            answers: Mutex::new(answers.into_iter().collect()),
            ..Default::default()
        })
    }

    fn asked(&self) -> Vec<(String, String, Value)> {
        self.asked.lock().unwrap().clone()
    }
}

impl DraftModel for Model {
    async fn complete(
        &self,
        _: &MacroUserIdStr<'static>,
        completion: DraftCompletion<'_>,
    ) -> Option<Value> {
        if completion.schema.name == "lookups" {
            return Some(json!({ "lookups": self.lookups }));
        }
        if completion.schema.name == "symbols" {
            self.symbol_requests
                .lock()
                .unwrap()
                .push(completion.instructions.to_owned());
            return Some(json!({ "symbols": self.symbols }));
        }
        if self.hangs {
            std::future::pending::<()>().await;
        }
        self.asked.lock().unwrap().push((
            completion.instructions.to_owned(),
            completion.prompt.to_owned(),
            completion.schema.schema.clone(),
        ));
        self.answers.lock().unwrap().pop_front().flatten()
    }
}

struct Refused;

impl AiAdmissionService for Refused {
    fn admit<'a>(&'a self, _: &'a MacroUserIdStr<'_>, _: AiFeature) -> AdmissionFuture<'a> {
        Box::pin(async { Err(AiAdmissionError::Unavailable) })
    }
}

fn drafts(checker: Checker, model: &Arc<Model>) -> RoutineDrafts<Checker, Model> {
    RoutineDrafts::new(
        Arc::new(checker),
        Arc::clone(model),
        Arc::new(DisabledAiAdmissionService),
    )
    .with_conditions_enabled(true)
}

fn context() -> DraftContext {
    DraftContext {
        timezone: "America/New_York".into(),
        agent_model: "anthropic/claude-sonnet-5-5".into(),
        code: true,
        conditions: true,
        ignored_workspace: serde::de::IgnoredAny,
    }
}

fn routine(description: &str) -> DraftRequest {
    DraftRequest::Routine {
        description: description.into(),
    }
}

fn code_step(title: &str, source: &str) -> Value {
    json!({ "type": "code", "title": title, "summary": "", "source": source })
}

fn agent_step() -> Value {
    json!({ "type": "agent", "model": "anthropic/claude-sonnet-5-5", "instructions": "Research it." })
}

fn answer(triggers: Value, steps: Value) -> Option<Value> {
    Some(json!({ "name": " Label invoices ", "triggers": triggers, "steps": steps }))
}

async fn draft(drafts: &RoutineDrafts<Checker, Model>, request: DraftRequest) -> Draft {
    drafts.draft(owner(), request, context()).await.unwrap()
}

fn drafted_routine(draft: Draft) -> DraftedRoutine {
    match draft {
        Draft::Routine(routine) => routine,
        other => panic!("expected a routine, got {other:?}"),
    }
}

fn drafted_step(draft: Draft) -> DraftedStep {
    match draft {
        Draft::Step(step) => step,
        other => panic!("expected a step, got {other:?}"),
    }
}

#[tokio::test]
async fn drafts_an_event_routine_with_named_code() {
    let model = Model::answering([answer(
        json!([{ "type": "event", "events": ["email.message_received", "github", "nope"], "ids": [] }]),
        json!([code_step(
            "Label invoices",
            "export async function main() {}"
        )]),
    )]);
    let drafts = drafts(Checker::default(), &model);

    let routine = drafted_routine(draft(&drafts, routine("label invoices")).await);

    assert_eq!(routine.name, "Label invoices");
    assert_eq!(
        serde_json::to_value(&routine.trigger).unwrap(),
        json!({ "type": "events", "filters": [{ "events": ["email.message_received"] }] })
    );
    assert_eq!(routine.steps[0]["id"], "label_invoices");
    assert!(routine.problems.is_empty());
    let asked = model.asked();
    let (instructions, prompt, schema) = &asked[0];
    assert_eq!(prompt, "label invoices");
    assert!(instructions.contains(&format!(r#""me":"{OWNER}""#)));
    assert!(instructions.contains("TaskNamespace methods for: label invoices"));
    assert!(instructions.contains("\"timezone\":\"America/New_York\""));
    // In the scheduler's cron, weekday 1 is Sunday: "1-5" would skip Friday.
    assert!(instructions.contains("weekdays named MON-SUN"));
    assert_eq!(
        schema["properties"]["steps"]["items"]["properties"]["type"]["enum"],
        json!(["code", "agent"])
    );
}

#[tokio::test]
async fn a_drafted_routine_never_operates_as_its_owner() {
    // Only the owner turns this on, by asking for it; a draft that tries is
    // still attributed to the agent.
    let model = Model::answering([Some(json!({
        "name": "Post standup",
        "triggers": [],
        "dangerously_operate_as_user": true,
        "dangerouslyOperateAsUser": true,
        "steps": [{
            "type": "code",
            "title": "Post standup",
            "summary": "",
            "source": "export async function main() {}",
            "dangerously_operate_as_user": true,
        }],
    }))]);
    let drafts = drafts(Checker::default(), &model);

    let draft = draft(&drafts, routine("post my standup as me in eng")).await;

    let routine = serde_json::to_value(&draft).unwrap();
    assert_eq!(
        routine,
        json!({
            "outcome": "routine",
            "name": "Post standup",
            "trigger": null,
            "steps": [{
                "type": "code",
                "id": "post_standup",
                "title": "Post standup",
                "source": "export async function main() {}",
            }],
            "problems": [],
        })
    );
}

#[tokio::test]
async fn keeps_one_off_times_beside_repeating_schedules() {
    let model = Model::answering([answer(
        json!([
            { "type": "once", "at": "2026-12-01T14:30:00-05:00" },
            { "type": "cron", "expression": "0 0 9 * * MON", "timezone": "America/New_York" },
            { "type": "once", "at": "next week" },
        ]),
        json!([agent_step()]),
    )]);
    let drafts = drafts(Checker::default(), &model);

    let routine = drafted_routine(draft(&drafts, routine("remind me")).await);

    assert_eq!(
        serde_json::to_value(&routine.trigger).unwrap(),
        json!({ "type": "multiple", "triggers": [
            { "type": "once", "at": "2026-12-01T19:30:00Z" },
            { "type": "cron", "schedule": "0 0 9 * * MON", "timezone": "America/New_York" },
        ] })
    );
}

#[tokio::test]
async fn gives_an_ask_ai_step_without_a_model_the_persons() {
    let model = Model::answering([answer(
        json!([]),
        json!([{ "type": "agent", "instructions": "Research it.", "extra": true }]),
    )]);
    let drafts = drafts(Checker::default(), &model);

    let routine = drafted_routine(draft(&drafts, routine("research")).await);

    assert_eq!(routine.trigger, None);
    assert_eq!(
        routine.steps,
        vec![
            json!({ "type": "agent", "model": "anthropic/claude-sonnet-5-5", "instructions": "Research it." })
        ]
    );
}

#[tokio::test]
async fn explains_drafts_it_cannot_use() {
    for (output, message) in [
        (
            Some(json!({ "name": "x" })),
            "The draft came back incomplete. Try rephrasing.",
        ),
        (
            answer(json!([]), json!([{ "type": "shell", "command": "ls" }])),
            "The draft used steps Macro can’t run. Try rephrasing.",
        ),
        (None, ROUTINE_FAILED),
    ] {
        let model = Model::answering([output]);
        assert_eq!(
            draft(&drafts(Checker::default(), &model), routine("x")).await,
            failed(message)
        );
    }
}

#[tokio::test]
async fn refuses_a_trigger_that_asks_ai_where_conditions_are_off() {
    let asks = || {
        answer(
            json!([{ "type": "event", "events": ["email.message_received"], "condition": "Is it an invoice?" }]),
            json!([agent_step()]),
        )
    };
    let model = Model::answering([asks()]);
    let off = drafts(Checker::default(), &model).with_conditions_enabled(false);
    let Draft::Failed { message } = draft(&off, routine("invoices")).await else {
        panic!("a condition can't be answered here");
    };
    assert!(message.contains("needs AI to decide when it runs"));
    assert!(model.asked()[0].0.contains("never add a \"condition\""));

    let model = Model::answering([asks()]);
    let routine = drafted_routine(draft(&drafts(Checker::default(), &model), routine("x")).await);
    assert_eq!(
        serde_json::to_value(&routine.trigger).unwrap()["filters"][0]["condition"],
        "Is it an invoice?"
    );
}

#[tokio::test]
async fn fixes_code_the_type_checker_rejects() {
    let model = Model::answering([
        answer(json!([]), json!([agent_step(), code_step("Count", "bad")])),
        answer(json!([]), json!([agent_step(), code_step("Count", "good")])),
    ]);
    let checker = Checker::default();
    let drafts = drafts(checker, &model);

    let routine = drafted_routine(draft(&drafts, routine("count")).await);

    assert!(routine.problems.is_empty());
    assert_eq!(routine.steps[1]["source"], "good");
    let asked = model.asked();
    assert_eq!(asked.len(), 2);
    let fix = &asked[1].1;
    assert!(fix.starts_with("count\n\nYour routine so far, as JSON:\n"));
    assert!(fix.contains("\"Count\":\nTS2339"));
    assert!(fix.contains("The SDK's declarations for those types:\ndeclarations for 1 problems"));
}

#[tokio::test]
async fn returns_problems_it_could_not_fix_on_their_step() {
    let bad = || answer(json!([]), json!([agent_step(), code_step("Count", "bad")]));
    let model = Model::answering([bad(), bad(), bad(), bad()]);
    let drafts = drafts(Checker::default(), &model);

    let routine = drafted_routine(draft(&drafts, routine("count")).await);

    assert_eq!(model.asked().len(), 1 + MAX_CODE_FIXES);
    assert_eq!(routine.problems.len(), 1);
    assert_eq!(routine.problems[0].index, 1);
    assert!(routine.problems[0].problems[0].starts_with("TS2339"));
}

#[tokio::test]
async fn asks_again_once_when_the_model_gives_no_answer() {
    let model = Model::answering([None, answer(json!([]), json!([agent_step()]))]);
    let drafts = drafts(Checker::default(), &model);

    drafted_routine(draft(&drafts, routine("x")).await);

    assert_eq!(model.asked().len(), 2);
}

/// Asks for a routine with `code`, and checks the model was told to write
/// Ask AI steps only.
async fn assert_ask_ai_only<Code: RoutineCode>(code: Code, context: DraftContext) {
    let model = Model::answering([answer(json!([]), json!([agent_step()]))]);
    let drafts = RoutineDrafts::new(
        Arc::new(code),
        Arc::clone(&model),
        Arc::new(DisabledAiAdmissionService),
    );
    drafted_routine(drafts.draft(owner(), routine("x"), context).await.unwrap());
    let (instructions, _, schema) = &model.asked()[0];
    assert!(instructions.contains("Code steps are unavailable here"));
    assert_eq!(
        schema["properties"]["steps"]["items"]["properties"]["type"]["enum"],
        json!(["agent"])
    );
}

#[tokio::test]
async fn writes_ask_ai_only_when_code_steps_are_off_or_cannot_be_checked() {
    let off = DraftContext {
        code: false,
        ..context()
    };
    assert_ask_ai_only(Checker::default(), off).await;
    assert_ask_ai_only(crate::domain::ports::NoRoutineCode, context()).await;
}

#[tokio::test]
async fn bills_the_draft_before_asking_the_model() {
    let model = Model::answering([]);
    let refused = RoutineDrafts::new(
        Arc::new(Checker::default()),
        Arc::clone(&model),
        Arc::new(Refused),
    );

    let error = refused
        .draft(owner(), routine("x"), context())
        .await
        .unwrap_err();

    assert!(error.downcast_ref::<AiAdmissionError>().is_some());
    assert!(model.asked().is_empty());
}

#[tokio::test]
async fn refuses_requests_it_cannot_draft() {
    let model = Model::answering([]);
    let drafts = drafts(Checker::default(), &model);
    let invalid = |draft: DraftRequest, context: DraftContext| {
        let drafts = &drafts;
        async move {
            drafts
                .draft(owner(), draft, context)
                .await
                .unwrap_err()
                .downcast::<InvalidDraft>()
                .is_ok()
        }
    };
    assert!(invalid(routine("  "), context()).await);
    assert!(
        invalid(
            routine("x"),
            DraftContext {
                timezone: "Mars/Olympus".into(),
                ..context()
            }
        )
        .await
    );
    assert!(
        invalid(
            DraftRequest::ChangeStep {
                instruction: "shorter".into(),
                routine: RoutineSoFar {
                    trigger: None,
                    steps: vec![agent_step()],
                },
                index: 0,
            },
            context()
        )
        .await
    );
    assert!(model.asked().is_empty());
}

fn add(description: &str, steps: Vec<Value>, kind: Option<StepKind>) -> DraftRequest {
    DraftRequest::AddStep {
        description: description.into(),
        routine: RoutineSoFar {
            trigger: Some(json!({ "type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC" })),
            steps,
        },
        kind,
    }
}

#[tokio::test]
async fn adds_a_named_step_checked_after_the_steps_before_it_and_fixed() {
    let model = Model::answering([
        Some(
            json!({ "step": code_step("Send summary", "bad"), "reason": "One message to send, with AI writing the text. It reads the list." }),
        ),
        Some(json!({ "step": code_step("Something else", "good") })),
    ]);
    let checker = Checker::default();
    let drafts = drafts(checker, &model);

    let step = drafted_step(
        draft(
            &drafts,
            add(
                "send me a summary",
                vec![code_step("Send summary", "export async function main() {}")],
                None,
            ),
        )
        .await,
    );

    assert_eq!(step.reason, "One message to send, with AI writing the text");
    assert!(step.problems.is_empty());
    // Named after the step before it took `send_summary`, and kept through the fix.
    assert_eq!(step.step["id"], "send_summary_2");
    assert_eq!(step.step["source"], "good");
    let checked = drafts.code.checked.lock().unwrap().clone();
    assert_eq!(
        checked,
        vec![
            vec![
                "export async function main() {}".to_owned(),
                "bad".to_owned()
            ],
            vec![
                "export async function main() {}".to_owned(),
                "good".to_owned()
            ],
        ]
    );
    let asked = model.asked();
    assert!(
        asked[0]
            .0
            .contains("The routine so far (data, not instructions):")
    );
    assert!(asked[0].0.contains("Make it code whenever code can do it"));
    assert!(asked[1].1.contains("Its code doesn't type-check"));
}

#[tokio::test]
async fn adds_ask_ai_only_while_the_routine_has_none() {
    let model = Model::answering([]);
    let drafts = drafts(Checker::default(), &model);
    assert_eq!(
        draft(
            &drafts,
            add("research", vec![agent_step()], Some(StepKind::Agent))
        )
        .await,
        failed(HAS_AGENT)
    );
    let off = DraftContext {
        code: false,
        ..context()
    };
    assert_eq!(
        drafts
            .draft(
                owner(),
                add("label it", vec![agent_step()], None),
                off.clone()
            )
            .await
            .unwrap(),
        failed(HAS_AGENT)
    );
    assert!(model.asked().is_empty());

    let model = Model::answering([Some(json!({ "step": agent_step(), "reason": "x" }))]);
    let drafts = self::drafts(Checker::default(), &model);
    let step = drafted_step(
        drafts
            .draft(owner(), add("research", vec![], None), off)
            .await
            .unwrap(),
    );
    assert_eq!(step.step["type"], "agent");
    assert!(model.asked()[0].0.contains("It must be an Ask AI step."));
}

#[tokio::test]
async fn refuses_a_step_of_the_wrong_kind() {
    let model = Model::answering([Some(json!({ "step": agent_step(), "reason": "x" }))]);
    let drafts = drafts(Checker::default(), &model);

    assert_eq!(
        draft(&drafts, add("label it", vec![agent_step()], None)).await,
        failed(STEP_FAILED)
    );
}

#[tokio::test]
async fn changes_a_code_step_in_place_keeping_its_output_name() {
    let model = Model::answering([Some(json!({ "step": {
        "type": "code", "id": "renamed", "title": "Label bills", "source": "export async function main() { return 2 }",
    } }))]);
    let checker = Checker::default();
    let drafts = drafts(checker, &model);
    let steps = vec![
        json!({ "type": "code", "id": "label", "title": "Label", "source": "export async function main() { return 1 }" }),
        code_step("Report", "export async function main() {}"),
    ];

    let step = drafted_step(
        draft(
            &drafts,
            DraftRequest::ChangeStep {
                instruction: "label bills too".into(),
                routine: RoutineSoFar {
                    trigger: None,
                    steps,
                },
                index: 0,
            },
        )
        .await,
    );

    assert_eq!(step.step["id"], "label");
    assert_eq!(step.step["title"], "Label bills");
    assert_eq!(step.reason, "");
    assert_eq!(
        drafts.code.checked.lock().unwrap()[0],
        vec![
            "export async function main() { return 2 }".to_owned(),
            "export async function main() {}".to_owned(),
        ]
    );
    let (instructions, prompt, _) = &model.asked()[0];
    assert_eq!(prompt, "label bills too");
    assert!(instructions.contains("The person wants to change this code step:"));
    assert!(instructions.contains("TaskNamespace methods for: Label: label bills too"));
}

#[tokio::test]
async fn reads_the_reference_for_the_symbols_its_code_will_use_before_writing() {
    let model = Arc::new(Model {
        answers: Mutex::new([answer(json!([]), json!([code_step("Count", "good")]))].into()),
        symbols: vec!["TaskNamespace.search".into(), "SearchOpts".into()],
        ..Default::default()
    });
    let drafts = drafts(Checker::default(), &model);

    drafted_routine(draft(&drafts, routine("count my tasks")).await);

    let read = model.symbol_requests.lock().unwrap().clone();
    assert_eq!(read.len(), 1);
    assert!(read[0].contains("TaskNamespace methods for: count my tasks"));
    assert!(read[0].ends_with(READ_SYMBOLS));
    let (instructions, _, _) = &model.asked()[0];
    assert!(instructions.contains("reference for TaskNamespace.search, SearchOpts"));
    assert!(!instructions.contains(READ_SYMBOLS));
}

#[tokio::test]
async fn writes_without_references_when_it_names_none_or_writes_no_code() {
    let model = Model::answering([answer(json!([]), json!([code_step("Count", "good")]))]);
    let drafts = drafts(Checker::default(), &model);
    drafted_routine(draft(&drafts, routine("count")).await);
    assert!(
        !model.asked()[0]
            .0
            .contains("The SDK reference for what the code uses")
    );

    let off = DraftContext {
        code: false,
        ..context()
    };
    let model = Model::answering([answer(json!([]), json!([agent_step()]))]);
    let drafts = self::drafts(Checker::default(), &model);
    drafts
        .draft(owner(), routine("research"), off)
        .await
        .unwrap();
    assert!(model.symbol_requests.lock().unwrap().is_empty());
}

#[test]
fn keeps_one_short_reason_and_drops_the_model_thinking_aloud() {
    assert_eq!(
        short_reason("  Sends one message. Then more. "),
        "Sends one message"
    );
    assert_eq!(short_reason("Runs every time!"), "Runs every time");
    assert_eq!(short_reason("v1.2 changes nothing"), "v1.2 changes nothing");
    let rambling = "Let me think about whether this should be code or not because the person said they want to send something and it could be either";
    assert_eq!(short_reason(rambling), "");
}

const BUG_REPORTS: &str = "every time a message gets sent in bug-reports make a task";

#[tokio::test]
async fn a_large_workspace_drafts_the_channel_the_description_names() {
    // The channel the person named is far past what any list sent with the
    // request could show the model.
    let bug_reports = Uuid::from_u128(4_000);
    let channels: Vec<Value> = (0..5_000u128)
        .map(|n| {
            let name = if n == 4_000 {
                "bug-reports".to_owned()
            } else {
                format!("channel-{n}")
            };
            json!({ "name": name, "id": Uuid::from_u128(n).to_string() })
        })
        .collect();
    let context: DraftContext = serde_json::from_value(json!({
        "timezone": "America/New_York",
        "agentModel": "anthropic/claude-sonnet-5-5",
        "code": true,
        "conditions": true,
        "workspace": { "channels": channels },
    }))
    .unwrap();
    let model = Arc::new(Model {
        answers: Mutex::new(VecDeque::from([answer(
            json!([{ "type": "event", "events": ["channel.message_posted"], "ids": [bug_reports] }]),
            json!([code_step("Make a task", "export async function main() {}")]),
        )])),
        lookups: vec![json!({ "kind": "channel", "name": "bug-reports" })],
        ..Default::default()
    });
    let checker = Checker {
        runs: Some(json!([{
            "kind": "channel",
            "name": "bug-reports",
            "matches": [
                { "name": "bug-reports-archive", "id": Uuid::from_u128(4_001).to_string() },
                { "name": "bug-reports", "id": bug_reports.to_string() },
            ],
        }])),
        ..Default::default()
    };
    let drafts = drafts(checker, &model);

    let routine = drafted_routine(
        drafts
            .draft(owner(), routine(BUG_REPORTS), context)
            .await
            .unwrap(),
    );

    let asked = model.asked();
    let (instructions, _, _) = &asked[0];
    assert!(instructions.contains(&format!(r#"{{"name":"bug-reports","id":"{bug_reports}"}}"#)));
    assert!(!instructions.contains("channel-0"));
    assert_eq!(
        serde_json::to_value(&routine.trigger).unwrap(),
        json!({ "type": "events", "filters": [{ "events": ["channel.message_posted"], "ids": [bug_reports] }] })
    );
}

#[tokio::test]
async fn looks_up_the_names_as_a_dry_run_and_counts_its_turns() {
    let model = Arc::new(Model {
        answers: Mutex::new(VecDeque::from([answer(json!([]), json!([agent_step()]))])),
        lookups: vec![
            json!({ "kind": "label", "name": "Finance" }),
            json!({ "kind": "person", "name": "  " }),
        ],
        ..Default::default()
    });
    let checker = Arc::new(Checker {
        runs: Some(
            json!([{ "kind": "label", "name": "Finance", "matches": [{ "name": "Finance", "id": "l1" }] }]),
        ),
        ..Default::default()
    });
    let drafts = RoutineDrafts::new(
        Arc::clone(&checker),
        Arc::clone(&model),
        Arc::new(DisabledAiAdmissionService),
    );

    drafted_routine(draft(&drafts, routine("label finance mail")).await);

    // Blank names are dropped before the lookup runs.
    let ran = checker.ran.lock().unwrap().clone();
    assert_eq!(ran.len(), 1);
    let asked: Value = serde_json::from_str(ran[0]["lookups"].as_str().unwrap()).unwrap();
    assert_eq!(asked, json!([{ "kind": "label", "name": "Finance" }]));
    assert!(model.asked()[0].0.contains(r#""emailLabels":["Finance"]"#));
}

#[tokio::test]
async fn names_are_left_for_the_person_when_code_cant_look_them_up() {
    let model = Arc::new(Model {
        answers: Mutex::new(VecDeque::from([answer(json!([]), json!([agent_step()]))])),
        lookups: vec![json!({ "kind": "channel", "name": "bug-reports" })],
        ..Default::default()
    });
    let drafts = RoutineDrafts::new(
        Arc::new(crate::domain::ports::NoRoutineCode),
        Arc::clone(&model),
        Arc::new(DisabledAiAdmissionService),
    );

    let drafted = drafts.draft(owner(), routine(BUG_REPORTS), context()).await;
    drafted_routine(drafted.unwrap());

    let asked = model.asked();
    assert!(asked[0].0.contains(r#""channels":[]"#));
}

#[tokio::test(start_paused = true)]
async fn a_lookup_that_runs_out_of_time_drafts_without_it() {
    let model = Arc::new(Model {
        answers: Mutex::new(VecDeque::from([answer(json!([]), json!([agent_step()]))])),
        lookups: vec![json!({ "kind": "channel", "name": "bug-reports" })],
        ..Default::default()
    });
    let checker = Checker {
        hangs: true,
        ..Default::default()
    };
    let drafts = drafts(checker, &model);

    let routine = drafted_routine(draft(&drafts, routine(BUG_REPORTS)).await);

    assert_eq!(routine.steps.len(), 1);
    assert!(model.asked()[0].0.contains(r#""channels":[]"#));
}

#[tokio::test(start_paused = true)]
async fn a_draft_that_runs_out_of_time_says_so() {
    let model = Arc::new(Model {
        hangs: true,
        ..Default::default()
    });
    let drafts = drafts(Checker::default(), &model);

    let draft = draft(&drafts, routine(BUG_REPORTS)).await;

    assert_eq!(draft, failed(TIMED_OUT));
}
