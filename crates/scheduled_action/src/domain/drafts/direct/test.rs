use std::collections::VecDeque;
use std::sync::Mutex;

use ai_billing::AiAdmissionError;
use chrono::Utc;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use super::super::test::{
    BUG_REPORTS, JobRow, Rows, Sessions, add, agent, checked, code_step, context, drafts, owner,
    routine,
};
use super::super::{DraftedRoutine, RoutineDrafts, StepKind, jobs};
use super::*;
use crate::domain::code_check::test::Checker;
use crate::domain::ports::{CodeOutcome, CodeUnavailable, StepProblems};

/// One model call, as the drafter made it.
#[derive(Debug, Clone)]
struct Call {
    purpose: CallPurpose,
    model: String,
    system: String,
    turns: Vec<DraftTurn>,
}

impl Call {
    /// What the drafter said last.
    fn asked(&self) -> &str {
        match self.turns.last() {
            Some(DraftTurn::User(text)) => text,
            other => panic!("the call ends with {other:?}"),
        }
    }
}

/// Answers the find call with `find` (failing without it) and each writing
/// or fixing call with the next of `answers`, recording every call. Out of
/// answers, it fails the call, or with `interrupts`, cancels that token and
/// never answers, as a model still working when the harness shuts down.
#[derive(Default)]
struct Model {
    refuses: bool,
    interrupts: Option<CancellationToken>,
    find: Option<String>,
    answers: Mutex<VecDeque<String>>,
    calls: Mutex<Vec<Call>>,
}

impl Model {
    fn new(find: Value, answers: Vec<String>) -> Self {
        Self {
            find: Some(find.to_string()),
            answers: Mutex::new(answers.into()),
            ..Self::default()
        }
    }

    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    fn purposes(&self) -> Vec<CallPurpose> {
        self.calls().iter().map(|call| call.purpose).collect()
    }
}

#[async_trait::async_trait]
impl DraftModel for Model {
    async fn admit(&self, _: &MacroUserIdStr<'static>) -> Result<(), AiAdmissionError> {
        if self.refuses {
            Err(AiAdmissionError::Unavailable)
        } else {
            Ok(())
        }
    }

    async fn complete(
        &self,
        _: &MacroUserIdStr<'static>,
        call: DraftCall<'_>,
    ) -> Result<String, DraftCallError> {
        self.calls.lock().unwrap().push(Call {
            purpose: call.purpose,
            model: match call.model {
                DraftModelChoice::Fast => "fast".to_owned(),
                DraftModelChoice::Named(model) => model.to_owned(),
            },
            system: call.system.to_owned(),
            turns: call.turns.to_vec(),
        });
        let answer = match call.purpose {
            CallPurpose::Find => self.find.clone(),
            CallPurpose::Write | CallPurpose::Fix => self.answers.lock().unwrap().pop_front(),
        };
        if answer.is_none()
            && let Some(interrupts) = &self.interrupts
        {
            interrupts.cancel();
            std::future::pending::<()>().await;
        }
        answer.ok_or_else(|| DraftCallError(rootcause::report!("no answer")))
    }
}

/// A workspace's items by name: a name matches exactly when it is the
/// item's, ignoring case, and loosely when the item's contains it.
#[derive(Default)]
struct Names {
    items: Vec<(ItemKind, &'static str, String)>,
    fails: bool,
    asked: Mutex<Vec<NameAsked>>,
}

impl Names {
    fn of(items: Vec<(ItemKind, &'static str, String)>) -> Self {
        Self {
            items,
            ..Self::default()
        }
    }
}

#[async_trait::async_trait]
impl NameLookups for Names {
    async fn look_up(
        &self,
        _: &MacroUserIdStr<'static>,
        names: &[NameAsked],
    ) -> Result<NameAnswers, NameLookupError> {
        self.asked.lock().unwrap().extend(names.iter().cloned());
        if self.fails {
            return Err(NameLookupError(rootcause::report!("search is down")));
        }
        let answers = names
            .iter()
            .map(|asked| NameAnswer {
                name: asked.name.clone(),
                matches: self
                    .items
                    .iter()
                    .filter(|(kind, _, _)| asked.kinds.is_empty() || asked.kinds.contains(kind))
                    .filter(|(_, name, _)| name.to_lowercase().contains(&asked.name.to_lowercase()))
                    .map(|(kind, name, id)| NameMatch {
                        name: (*name).to_owned(),
                        exact: name.eq_ignore_ascii_case(&asked.name),
                        kind: *kind,
                        id: id.clone(),
                        definition_id: None,
                    })
                    .collect(),
            })
            .collect();
        Ok(NameAnswers {
            answers,
            unavailable: Vec::new(),
        })
    }
}

/// Saving's checks, with code type-checked as `Checker` checks it.
struct Checks(Arc<Checker>);

#[async_trait::async_trait]
impl DraftChecks for Checks {
    async fn check(
        &self,
        _: &MacroUserIdStr<'static>,
        routine: ActionConfiguration,
    ) -> anyhow::Result<RoutineCheck> {
        Ok(checked(&self.0, routine).await)
    }
}

/// What a draft reported, in order.
#[derive(Default)]
struct Milestones(Mutex<Vec<DraftMilestone>>);

impl DraftProgress for Milestones {
    fn report(&self, milestone: DraftMilestone) {
        self.0.lock().unwrap().push(milestone);
    }
}

impl Milestones {
    fn stages(&self) -> Vec<&'static str> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .map(|milestone| match milestone {
                DraftMilestone::Admitted => "admitted",
                DraftMilestone::Found(_) => "found",
                DraftMilestone::Writing => "writing",
                DraftMilestone::Checked(check) if check.ok => "passed",
                DraftMilestone::Checked(_) => "failed",
                DraftMilestone::Fixing => "fixing",
            })
            .collect()
    }

    fn found(&self) -> FoundNames {
        self.0
            .lock()
            .unwrap()
            .iter()
            .find_map(|milestone| match milestone {
                DraftMilestone::Found(names) => Some(names.clone()),
                _ => None,
            })
            .expect("it reported what it found")
    }
}

/// Direct drafting whose model is admitted, then never answers: a draft
/// still under way, for the background jobs' tests.
pub(in crate::domain::drafts) fn never_answering() -> DirectDrafting {
    DirectDrafting {
        model: Arc::new(Model {
            interrupts: Some(CancellationToken::new()),
            ..Model::default()
        }),
        names: Arc::new(Names::default()),
        checks: Arc::new(Checks(Arc::new(Checker::default()))),
        tuning: DirectTuning::default(),
    }
}

fn direct_drafts(
    model: &Arc<Model>,
    names: &Arc<Names>,
) -> (RoutineDrafts<Checker, Sessions>, Arc<Rows>) {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(&rows, Box::new(|_| Vec::new())));
    let drafts = drafts(&rows, &sessions).with_direct(DirectDrafting {
        model: Arc::clone(model) as Arc<dyn DraftModel>,
        names: Arc::clone(names) as Arc<dyn NameLookups>,
        checks: Arc::new(Checks(Arc::new(Checker::default()))),
        tuning: DirectTuning::default(),
    });
    (drafts, rows)
}

/// Draft `request` directly, as a background draft with id `id` would.
async fn draft_as(
    drafts: &RoutineDrafts<Checker, Sessions>,
    request: DraftRequest,
    id: Uuid,
    milestones: &Milestones,
) -> anyhow::Result<Option<Draft>> {
    draft_until(drafts, request, id, milestones, CancellationToken::new()).await
}

/// Draft `request` directly, as a background draft with id `id` would,
/// until `interrupt`.
async fn draft_until<Code: RoutineCode>(
    drafts: &RoutineDrafts<Code, Sessions>,
    request: DraftRequest,
    id: Uuid,
    milestones: &Milestones,
    interrupt: CancellationToken,
) -> anyhow::Result<Option<Draft>> {
    draft_in(drafts, request, context(), id, milestones, interrupt).await
}

/// [`draft_until`] in `context`.
async fn draft_in<Code: RoutineCode>(
    drafts: &RoutineDrafts<Code, Sessions>,
    request: DraftRequest,
    context: DraftContext,
    id: Uuid,
    milestones: &Milestones,
    interrupt: CancellationToken,
) -> anyhow::Result<Option<Draft>> {
    let (program, context) = drafts.read_request(&request, context)?;
    let direct = Arc::clone(drafts.direct.as_ref().expect("drafts directly"));
    drafts
        .direct_draft(
            &direct,
            &owner(),
            &request,
            &program,
            &context,
            DirectRun {
                id,
                progress: milestones,
                cancellable: true,
                interrupt,
            },
        )
        .await
}

async fn draft(
    drafts: &RoutineDrafts<Checker, Sessions>,
    request: DraftRequest,
    milestones: &Milestones,
) -> Draft {
    draft_as(drafts, request, Uuid::now_v7(), milestones)
        .await
        .unwrap()
        .expect("nobody cancelled it")
}

fn drafted_routine(draft: Draft) -> DraftedRoutine {
    match draft {
        Draft::Routine(routine) => routine,
        other => panic!("expected a routine, got {other:?}"),
    }
}

/// What the find call answers for a request naming these items.
fn named(names: &[(&str, &[&str])]) -> Value {
    json!({
        "names": names.iter().map(|(name, kinds)| json!({ "name": name, "kinds": kinds })).collect::<Vec<_>>(),
        "sdk": ["tasks", "channels"],
    })
}

/// The writer's answer: a whole routine, in a code fence as models write.
fn written(trigger: Value, steps: Value) -> String {
    format!(
        "Here it is:\n```json\n{}\n```",
        json!({ "name": "Bug tasks", "trigger": trigger, "steps": steps })
    )
}

fn posted_in(ids: &[&str]) -> Value {
    json!({ "type": "events", "filters": [{ "events": ["channel.message_posted"], "ids": ids }] })
}

#[tokio::test]
async fn a_draft_finds_the_items_its_words_name_then_writes_once_and_checks() {
    let channel = Uuid::now_v7().to_string();
    let model = Arc::new(Model::new(
        named(&[("bug-reports", &["channel"]), ("Jordan", &["person"])]),
        vec![written(
            posted_in(&[&channel]),
            json!([code_step("Make a task", "good")]),
        )],
    ));
    let names = Arc::new(Names::of(vec![
        (ItemKind::Channel, "bug-reports", channel.clone()),
        (
            ItemKind::Channel,
            "bug-reports-archive",
            Uuid::now_v7().to_string(),
        ),
        (
            ItemKind::Person,
            "Jordan",
            "macro|jordan@example.com".to_owned(),
        ),
        (
            ItemKind::Person,
            "jordan",
            "macro|jordan2@example.com".to_owned(),
        ),
    ]));
    let (drafts, _) = direct_drafts(&model, &names);
    let milestones = Milestones::default();

    let drafted = drafted_routine(draft(&drafts, routine(BUG_REPORTS), &milestones).await);

    assert_eq!(drafted.name, "Bug tasks");
    assert!(drafted.problems.is_empty());
    assert_eq!(
        serde_json::to_value(drafted.trigger.unwrap()).unwrap()["filters"][0]["ids"],
        json!([channel])
    );
    // Saving names code steps; the check named this one as saving will.
    assert_eq!(drafted.steps[0]["id"], "make_a_task");
    let calls = model.calls();
    assert_eq!(model.purposes(), [CallPurpose::Find, CallPurpose::Write]);
    assert_eq!(calls[0].model, "fast");
    assert!(calls[0].asked().contains(BUG_REPORTS));
    assert_eq!(calls[1].model, context().agent_model);
    // The writer's instructions are the same for every draft, so they stay
    // cached: the request and the items are its message.
    assert!(!calls[1].system.contains(BUG_REPORTS));
    assert!(!calls[1].system.contains(&channel));
    let asked = calls[1].asked();
    assert!(asked.contains(BUG_REPORTS));
    assert!(asked.contains(&format!("the channel named \"bug-reports\", id {channel}")));
    assert!(asked.contains("\"Jordan\" (person): 2 have that name"));
    assert_eq!(
        milestones.stages(),
        ["admitted", "found", "writing", "passed"]
    );
    assert_eq!(
        milestones.found(),
        FoundNames {
            found: vec![FoundName {
                name: "bug-reports".into(),
                kind: ItemKind::Channel,
            }],
            left: vec![LeftName {
                name: "Jordan".into(),
                kind: Some(ItemKind::Person),
                matches: 2,
            }],
        }
    );
}

#[tokio::test]
async fn a_failing_check_goes_back_to_the_model_for_only_what_changes() {
    let model = Arc::new(Model::new(
        named(&[]),
        vec![
            written(
                posted_in(&[]),
                json!([
                    code_step("Make a task", "bad"),
                    code_step("Post it", "good")
                ]),
            ),
            json!({ "steps": { "0": code_step("Make a task", "good") } }).to_string(),
        ],
    ));
    let (drafts, _) = direct_drafts(&model, &Arc::new(Names::default()));
    let milestones = Milestones::default();

    let drafted = drafted_routine(draft(&drafts, routine(BUG_REPORTS), &milestones).await);

    assert!(drafted.problems.is_empty());
    assert_eq!(drafted.steps.len(), 2);
    assert_eq!(drafted.steps[0]["source"], "good");
    assert_eq!(drafted.steps[1]["title"], "Post it");
    assert_eq!(
        model.purposes(),
        [CallPurpose::Find, CallPurpose::Write, CallPurpose::Fix]
    );
    // The fix continues the writer's conversation, told what failed and the
    // SDK declarations the errors name.
    let fix = &model.calls()[2];
    assert_eq!(fix.turns.len(), 3);
    assert!(fix.asked().contains("Step 0 (\"Make a task\")"));
    assert!(fix.asked().contains("Property 'nope' does not exist"));
    assert!(fix.asked().contains("declarations for 1 problems"));
    assert_eq!(
        milestones.stages(),
        ["admitted", "found", "writing", "failed", "fixing", "passed"]
    );
}

#[tokio::test]
async fn code_still_failing_after_the_last_fix_comes_back_on_its_step() {
    let bad = || written(posted_in(&[]), json!([code_step("Make a task", "bad")]));
    let model = Arc::new(Model::new(named(&[]), vec![bad(), bad(), bad()]));
    let (drafts, _) = direct_drafts(&model, &Arc::new(Names::default()));

    let drafted =
        drafted_routine(draft(&drafts, routine(BUG_REPORTS), &Milestones::default()).await);

    assert_eq!(
        model.purposes(),
        [
            CallPurpose::Find,
            CallPurpose::Write,
            CallPurpose::Fix,
            CallPurpose::Fix
        ]
    );
    assert_eq!(drafted.problems.len(), 1);
    assert_eq!(drafted.problems[0].index, 0);
}

#[tokio::test]
async fn an_answer_that_isnt_a_routine_is_sent_back_unchecked() {
    let model = Arc::new(Model::new(
        named(&[]),
        vec![
            "I'll set that up for you.".to_owned(),
            written(
                json!({ "type": "hourly" }),
                json!([code_step("Make a task", "good")]),
            ),
            json!({ "trigger": posted_in(&[]) }).to_string(),
        ],
    ));
    let (drafts, _) = direct_drafts(&model, &Arc::new(Names::default()));
    let milestones = Milestones::default();

    let drafted = drafted_routine(draft(&drafts, routine(BUG_REPORTS), &milestones).await);

    assert_eq!(drafted.steps[0]["source"], "good");
    let calls = model.calls();
    assert_eq!(calls.len(), 4);
    assert!(calls[2].asked().contains("no JSON object"));
    assert!(calls[3].asked().contains("`trigger` isn't a trigger"));
    // Only the routine that could be checked was, and nothing was fixed
    // before it.
    assert_eq!(
        milestones.stages(),
        ["admitted", "found", "writing", "passed"]
    );
}

#[tokio::test]
async fn a_draft_whose_names_cant_be_looked_up_leaves_them_to_the_person() {
    let model = Arc::new(Model::new(
        named(&[("bug-reports", &["channel"])]),
        vec![written(
            posted_in(&[]),
            json!([code_step("Make a task", "good")]),
        )],
    ));
    let names = Arc::new(Names {
        fails: true,
        ..Names::default()
    });
    let (drafts, _) = direct_drafts(&model, &names);
    let milestones = Milestones::default();

    drafted_routine(draft(&drafts, routine(BUG_REPORTS), &milestones).await);

    assert!(
        model.calls()[1]
            .asked()
            .contains("\"bug-reports\": couldn't be looked up")
    );
    assert_eq!(milestones.found(), FoundNames::default());
}

#[tokio::test]
async fn a_failed_find_still_writes_the_routine() {
    let model = Arc::new(Model {
        find: None,
        answers: Mutex::new(
            vec![written(
                posted_in(&[]),
                json!([code_step("Make a task", "good")]),
            )]
            .into(),
        ),
        ..Model::default()
    });
    let names = Arc::new(Names::default());
    let (drafts, _) = direct_drafts(&model, &names);

    drafted_routine(draft(&drafts, routine(BUG_REPORTS), &Milestones::default()).await);

    assert_eq!(model.purposes(), [CallPurpose::Find, CallPurpose::Write]);
    assert!(names.asked.lock().unwrap().is_empty());
    assert!(model.calls()[1].asked().contains("names no item"));
}

#[tokio::test]
async fn a_model_that_gives_no_routine_fails_the_draft() {
    let model = Arc::new(Model::new(named(&[]), Vec::new()));
    let (drafts, _) = direct_drafts(&model, &Arc::new(Names::default()));

    let draft = draft(&drafts, routine(BUG_REPORTS), &Milestones::default()).await;

    assert!(matches!(draft, Draft::Failed { .. }), "{draft:?}");
}

#[tokio::test]
async fn a_refused_admission_is_an_error_before_any_model_call() {
    let model = Arc::new(Model {
        refuses: true,
        ..Model::default()
    });
    let (drafts, _) = direct_drafts(&model, &Arc::new(Names::default()));

    let error = draft_as(
        &drafts,
        routine(BUG_REPORTS),
        Uuid::now_v7(),
        &Milestones::default(),
    )
    .await
    .unwrap_err();

    assert!(error.downcast_ref::<AiAdmissionError>().is_some());
    assert!(model.calls().is_empty());
}

#[tokio::test]
async fn a_cancelled_background_draft_stops_and_forgets_its_row() {
    let model = Arc::new(Model::new(
        named(&[]),
        vec![written(posted_in(&[]), json!([]))],
    ));
    let (drafts, rows) = direct_drafts(&model, &Arc::new(Names::default()));
    let id = Uuid::now_v7();
    rows.drafts
        .lock()
        .unwrap()
        .insert(id, (owner(), agent().bot, Default::default(), Utc::now()));
    rows.jobs.lock().unwrap().insert(
        id,
        JobRow {
            client_id: Uuid::now_v7(),
            phase: jobs::DraftJobPhase::Cancelled,
            request: Default::default(),
            progress: Default::default(),
            result: None,
            finished_at: None,
            traceparent: None,
        },
    );

    let draft = draft_as(&drafts, routine(BUG_REPORTS), id, &Milestones::default())
        .await
        .unwrap();

    assert_eq!(draft, None);
    // It stopped after the find call, before the model wrote anything.
    assert_eq!(model.purposes(), [CallPurpose::Find]);
    assert_eq!(*rows.finished.lock().unwrap(), [id]);
}

#[tokio::test]
async fn a_step_to_add_is_written_alone_and_checked_with_the_routine() {
    let model = Arc::new(Model::new(
        named(&[]),
        vec![json!({ "step": code_step("Post it", "good") }).to_string()],
    ));
    let (drafts, _) = direct_drafts(&model, &Arc::new(Names::default()));
    let request = add(
        "then post it in the channel",
        vec![code_step("Make a task", "good")],
        Some(StepKind::Code),
    );

    let draft = draft(&drafts, request, &Milestones::default()).await;

    let Draft::Step(step) = draft else {
        panic!("expected a step, got {draft:?}");
    };
    assert_eq!(step.step["title"], "Post it");
    assert!(step.problems.is_empty());
    assert!(model.calls()[1].asked().contains("Add ONE step"));
}

#[tokio::test]
async fn a_routine_with_no_trigger_yet_checks_a_new_step_alone() {
    let model = Arc::new(Model::new(
        named(&[]),
        vec![json!({ "step": code_step("Post it", "good") }).to_string()],
    ));
    let (drafts, _) = direct_drafts(&model, &Arc::new(Names::default()));
    let request = DraftRequest::AddStep {
        description: "post a summary".into(),
        routine: RoutineSoFar {
            trigger: None,
            steps: Vec::new(),
        },
        kind: None,
    };

    let draft = draft(&drafts, request, &Milestones::default()).await;

    assert!(matches!(draft, Draft::Step(_)), "{draft:?}");
}

#[test]
fn a_name_settles_on_the_one_item_of_its_likeliest_kind_that_has_it_exactly() {
    let item = |kind, name: &str, id: &str, exact| NameMatch {
        name: name.into(),
        exact,
        kind,
        id: id.into(),
        definition_id: None,
    };
    let asked = |name: &str, kinds: Vec<ItemKind>| NameAsked {
        name: name.into(),
        kinds,
    };
    let lookup = settle(
        &[
            asked("Finance", vec![ItemKind::Label, ItemKind::Project]),
            asked("Design", vec![ItemKind::Channel]),
            asked("Ops", Vec::new()),
            asked("Nobody", vec![ItemKind::Person]),
            asked("Planning", Vec::new()),
        ],
        NameAnswers {
            answers: vec![
                NameAnswer {
                    name: "Finance".into(),
                    matches: vec![
                        item(ItemKind::Project, "Finance", "folder", true),
                        item(ItemKind::Label, "Finance", "label", true),
                        item(ItemKind::Label, "Finance/Receipts", "nested", false),
                    ],
                },
                NameAnswer {
                    name: "Design".into(),
                    matches: vec![
                        item(ItemKind::Channel, "design", "one", true),
                        item(ItemKind::Channel, "Design", "two", true),
                    ],
                },
                NameAnswer {
                    name: "Ops".into(),
                    matches: vec![
                        item(ItemKind::Channel, "ops", "channel", true),
                        item(ItemKind::Channel, "ops", "channel", true),
                    ],
                },
                NameAnswer {
                    name: "Nobody".into(),
                    matches: vec![item(ItemKind::Person, "Nobody Else", "person", false)],
                },
                NameAnswer {
                    name: "Planning".into(),
                    matches: vec![
                        item(ItemKind::Channel, "planning", "channel-2", true),
                        item(ItemKind::Project, "Planning", "folder-2", true),
                    ],
                },
            ],
            unavailable: Vec::new(),
        },
    );

    let found: Vec<(&str, ItemKind)> = lookup
        .found
        .iter()
        .map(|(item, _)| (item.id.as_str(), item.kind))
        .collect();
    // The label wins over the folder: the find call named labels first.
    assert_eq!(
        found,
        [("label", ItemKind::Label), ("channel", ItemKind::Channel)]
    );
    assert_eq!(
        lookup.left,
        [
            LeftName {
                name: "Design".into(),
                kind: Some(ItemKind::Channel),
                matches: 2,
            },
            LeftName {
                name: "Nobody".into(),
                kind: Some(ItemKind::Person),
                matches: 0,
            },
            // With no likeliest kind, a channel and a folder are two.
            LeftName {
                name: "Planning".into(),
                kind: None,
                matches: 2,
            },
        ]
    );
}

#[test]
fn the_answer_is_the_first_json_object_past_any_prose() {
    assert_eq!(
        json_answer("Sure:\n```json\n{\"a\": {\"b\": 1}}\n```\nDone {not json}").unwrap(),
        json!({ "a": { "b": 1 } })
    );
    assert!(json_answer("no routine here").is_err());
    assert!(json_answer("{\"a\": ").is_err());
}

#[test]
fn setup_ids_replace_their_placeholders_and_count_as_created() {
    let database = Uuid::now_v7().to_string();
    let (ids, created) = setup_ids(&json!({
        "orders": { "type": "database", "id": database },
        "plain": "an-id",
        "ignored": 3,
    }));
    let routine = Routine {
        name: "Orders".into(),
        trigger: Some(posted_in(&[])),
        steps: vec![json!({
            "type": "code",
            "title": "Add a row",
            "source": "export async function main() {}",
            "knobs": [{ "name": "databaseId", "label": "Database", "type": "text", "value": "{{setup.orders}}" }],
        })],
        setup: Some("export async function main() {}".into()),
    }
    .with_ids(&ids);

    assert_eq!(routine.steps[0]["knobs"][0]["value"], json!(database));
    assert_eq!(
        created,
        [CreatedItem {
            entity_type: model_entity::EntityType::Database,
            entity_id: database,
        }]
    );
    assert_eq!(ids["plain"], "an-id");
    assert!(!ids.contains_key("ignored"));
}

/// Checks as `Checker` does, and runs setup: each run fails as the next of
/// `fails` says (after a write or not), and once they are spent returns
/// `returns`.
struct SetsUp {
    checker: Checker,
    returns: Value,
    fails: Mutex<VecDeque<bool>>,
    /// Cancels this token and never ends, as setup still running when the
    /// harness shuts down.
    hangs: Option<CancellationToken>,
    /// Whose background drafts its owner cancels while setup runs.
    cancels: Option<Arc<Rows>>,
    ran: Mutex<Vec<(String, Uuid)>>,
    /// The areas each reference was asked for.
    areas: Mutex<Vec<Vec<String>>>,
}

impl SetsUp {
    fn returning(returns: Value) -> Self {
        Self {
            checker: Checker::default(),
            returns,
            fails: Mutex::new(VecDeque::new()),
            hangs: None,
            cancels: None,
            ran: Mutex::new(Vec::new()),
            areas: Mutex::new(Vec::new()),
        }
    }

    fn ran(&self) -> Vec<(String, Uuid)> {
        self.ran.lock().unwrap().clone()
    }

    fn sources(&self) -> Vec<String> {
        self.ran().into_iter().map(|(source, _)| source).collect()
    }
}

impl RoutineCode for SetsUp {
    fn sdk(&self) -> Option<routine_program::SdkFingerprint> {
        self.checker.sdk()
    }

    async fn check_program(
        &self,
        program: &routine_program::RoutineProgram,
    ) -> Result<Vec<StepProblems>, CodeUnavailable> {
        self.checker.check_program(program).await
    }

    async fn owner_time_zone(&self, _: &MacroUserIdStr<'static>) -> Option<String> {
        None
    }

    async fn run(&self, _: &MacroUserIdStr<'static>, run: CodeRun<'_>) -> CodeOutcome {
        assert!(!run.dry_run);
        self.ran
            .lock()
            .unwrap()
            .push((run.step.source.clone(), run.routine_id));
        if let Some(hangs) = &self.hangs {
            hangs.cancel();
            std::future::pending::<()>().await;
        }
        if let Some(rows) = &self.cancels {
            for job in rows.jobs.lock().unwrap().values_mut() {
                job.phase = jobs::DraftJobPhase::Cancelled;
            }
        }
        let fails = self.fails.lock().unwrap().pop_front();
        match fails {
            None => CodeOutcome {
                result: Ok(self.returns.clone()),
                calls: Vec::new(),
                calls_truncated: false,
                waited_ms: None,
            },
            Some(wrote) => CodeOutcome {
                result: Err("the API refused it".into()),
                calls: vec![routine_program::CallRecord {
                    operation: "databases.create".into(),
                    label: "Create".into(),
                    write: true,
                    status: if wrote {
                        routine_program::CallStatus::Completed
                    } else {
                        routine_program::CallStatus::Failed
                    },
                    started_ms: 0,
                    duration_ms: Some(1),
                }],
                calls_truncated: false,
                waited_ms: None,
            },
        }
    }

    async fn reference(
        &self,
        user: &MacroUserIdStr<'static>,
        task: &str,
    ) -> Result<String, CodeUnavailable> {
        self.checker.reference(user, task).await
    }

    fn declarations(&self, problems: &[String]) -> String {
        self.checker.declarations(problems)
    }

    fn area_reference(&self, areas: &[String]) -> String {
        self.areas.lock().unwrap().push(areas.to_vec());
        let known: Vec<&str> = areas
            .iter()
            .map(String::as_str)
            .filter(|area| SDK_AREAS.contains(area))
            .collect();
        if known.is_empty() {
            String::new()
        } else {
            format!("the reference of {}", known.join(", "))
        }
    }

    async fn rewrite(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &routine_program::CodeStep,
        _: &str,
        _: &[String],
    ) -> Result<String, String> {
        Err("no rewrites here".into())
    }
}

/// The SDK areas [`SetsUp`] has a reference of.
const SDK_AREAS: &[&str] = &["ai", "channels", "tasks", "email", "databases"];

fn setting_up(code: &Arc<SetsUp>, model: &Arc<Model>) -> RoutineDrafts<SetsUp, Sessions> {
    setting_up_in(code, model, &Arc::new(Rows::default()))
}

/// [`setting_up`], keeping its drafts' rows in `rows`.
fn setting_up_in(
    code: &Arc<SetsUp>,
    model: &Arc<Model>,
    rows: &Arc<Rows>,
) -> RoutineDrafts<SetsUp, Sessions> {
    let sessions = Arc::new(Sessions::new(rows, Box::new(|_| Vec::new())));
    RoutineDrafts::new(
        Arc::clone(code),
        sessions,
        Arc::clone(rows) as Arc<dyn crate::domain::ports::DraftHandBacks>,
        agent(),
    )
    .with_direct(DirectDrafting {
        model: Arc::clone(model) as Arc<dyn DraftModel>,
        names: Arc::new(Names::default()),
        checks: Arc::new(Checks(Arc::new(Checker::default()))),
        tuning: DirectTuning::default(),
    })
}

/// A step adding a row to the database setup made as `orders`, or to the
/// database `id`.
fn add_row(source: &str, id: &str) -> Value {
    json!({
        "type": "code",
        "title": "Add a row",
        "summary": "",
        "source": source,
        "knobs": [{ "name": "databaseId", "label": "Database", "type": "text", "value": id }],
    })
}

const ORDERS: &str = "{{setup.orders}}";
const ORDERS_REQUEST: &str = "add a row to a new Orders database for every order email";

/// The writer's first answer: a routine whose setup is `setup`.
fn with_setup(trigger: Value, step: Value, setup: &str) -> String {
    json!({ "name": "Orders", "trigger": trigger, "steps": [step], "setup": setup }).to_string()
}

#[tokio::test]
async fn setup_runs_once_and_what_it_made_takes_its_placeholders() {
    let database = Uuid::now_v7().to_string();
    let code = Arc::new(SetsUp::returning(
        json!({ "orders": { "type": "database", "id": database } }),
    ));
    let model = Arc::new(Model::new(
        named(&[]),
        vec![
            with_setup(
                posted_in(&[]),
                add_row("bad", ORDERS),
                "export async function main() { return {}; }",
            ),
            json!({ "steps": { "0": add_row("good", ORDERS) }, "setup": "changed" }).to_string(),
        ],
    ));
    let drafts = setting_up(&code, &model);
    let id = Uuid::now_v7();

    let draft = draft_until(
        &drafts,
        routine(ORDERS_REQUEST),
        id,
        &Milestones::default(),
        CancellationToken::new(),
    )
    .await
    .unwrap()
    .unwrap();

    let drafted = drafted_routine(draft);
    assert_eq!(drafted.steps[0]["knobs"][0]["value"], json!(database));
    assert_eq!(
        drafted.created,
        [super::super::DraftCreated {
            entity_type: model_entity::EntityType::Database,
            entity_id: database,
            used: true,
        }]
    );
    // Setup ran once, as the draft, though the routine and its setup were
    // changed after it; the fix was told it won't run again.
    let ran = code.ran();
    assert_eq!(ran.len(), 1);
    assert_eq!(ran[0].1, id);
    assert!(model.calls()[2].asked().contains("won't run again"));
}

#[tokio::test]
async fn setup_that_failed_before_changing_anything_runs_again_once_fixed() {
    let database = Uuid::now_v7().to_string();
    let code = Arc::new(SetsUp::returning(
        json!({ "orders": { "type": "database", "id": database } }),
    ));
    code.fails.lock().unwrap().push_back(false);
    let model = Arc::new(Model::new(
        named(&[]),
        vec![
            with_setup(posted_in(&[]), add_row("good", ORDERS), "first"),
            json!({ "setup": "second" }).to_string(),
        ],
    ));
    let drafts = setting_up(&code, &model);

    let draft = draft_until(
        &drafts,
        routine(ORDERS_REQUEST),
        Uuid::now_v7(),
        &Milestones::default(),
        CancellationToken::new(),
    )
    .await
    .unwrap()
    .unwrap();

    let drafted = drafted_routine(draft);
    assert_eq!(drafted.steps[0]["knobs"][0]["value"], json!(database));
    let ran: Vec<String> = code.ran().into_iter().map(|(source, _)| source).collect();
    assert_eq!(ran, ["first", "second"]);
    assert!(
        model.calls()[2]
            .asked()
            .contains("`setup` failed when it ran: the API refused it\nFix it, and it runs again")
    );
}

#[tokio::test]
async fn setup_that_failed_after_changing_something_never_runs_again() {
    let code = Arc::new(SetsUp::returning(json!({})));
    code.fails.lock().unwrap().push_back(true);
    let database = Uuid::now_v7().to_string();
    let model = Arc::new(Model::new(
        named(&[]),
        vec![
            with_setup(posted_in(&[]), add_row("good", ORDERS), "first"),
            json!({ "setup": "second" }).to_string(),
            json!({ "steps": { "0": add_row("good", &database) } }).to_string(),
        ],
    ));
    let drafts = setting_up(&code, &model);

    let draft = draft_until(
        &drafts,
        routine(ORDERS_REQUEST),
        Uuid::now_v7(),
        &Milestones::default(),
        CancellationToken::new(),
    )
    .await
    .unwrap()
    .unwrap();

    let drafted = drafted_routine(draft);
    assert!(drafted.problems.is_empty());
    assert_eq!(code.ran().len(), 1);
    let calls = model.calls();
    assert!(calls[2].asked().contains("so it won't run again"));
    // Its placeholder is never checked as if it were an id.
    assert!(
        calls[3]
            .asked()
            .contains("The routine still uses `{{setup.orders}}`")
    );
}

#[tokio::test]
async fn a_draft_failing_after_setup_changed_something_says_so() {
    let code = Arc::new(SetsUp::returning(json!({})));
    code.fails.lock().unwrap().push_back(true);
    let model = Arc::new(Model::new(
        named(&[]),
        vec![with_setup(posted_in(&[]), add_row("good", ORDERS), "first")],
    ));
    let drafts = setting_up(&code, &model);

    let draft = draft_until(
        &drafts,
        routine(ORDERS_REQUEST),
        Uuid::now_v7(),
        &Milestones::default(),
        CancellationToken::new(),
    )
    .await
    .unwrap()
    .unwrap();

    assert!(
        matches!(&draft, Draft::Failed { message, .. } if message == SETUP_FAILED_PARTWAY),
        "{draft:?}"
    );
}

#[tokio::test]
async fn an_item_the_request_asks_to_make_that_no_item_has_the_name_of_is_set_up() {
    let database = Uuid::now_v7().to_string();
    let code = Arc::new(SetsUp::returning(
        json!({ "orders": { "type": "database", "id": database } }),
    ));
    let model = Arc::new(Model::new(
        named(&[("Orders", &["database"])]),
        vec![with_setup(posted_in(&[]), add_row("good", ORDERS), "first")],
    ));
    let drafts = setting_up(&code, &model);

    let draft = draft_until(
        &drafts,
        routine(ORDERS_REQUEST),
        Uuid::now_v7(),
        &Milestones::default(),
        CancellationToken::new(),
    )
    .await
    .unwrap()
    .unwrap();

    let calls = model.calls();
    // Looked up in case it exists, it doesn't: the writer may still make it.
    assert!(
        calls[1]
            .asked()
            .contains("\"Orders\" (database): no database has that name")
    );
    assert!(
        calls[1]
            .system
            .contains("an item the request asks to make new that no item has the name of")
    );
    assert_eq!(code.sources(), ["first"]);
    let drafted = drafted_routine(draft);
    assert_eq!(drafted.steps[0]["knobs"][0]["value"], json!(database));
}

#[tokio::test]
async fn setup_changing_something_after_a_failed_check_still_says_so() {
    let code = Arc::new(SetsUp::returning(json!({})));
    code.fails.lock().unwrap().push_back(true);
    let model = Arc::new(Model::new(
        named(&[]),
        vec![
            written(posted_in(&[]), json!([code_step("Make a task", "bad")])),
            json!({ "setup": "first", "steps": { "0": add_row("good", ORDERS) } }).to_string(),
        ],
    ));
    let drafts = setting_up(&code, &model);

    let draft = draft_until(
        &drafts,
        routine(ORDERS_REQUEST),
        Uuid::now_v7(),
        &Milestones::default(),
        CancellationToken::new(),
    )
    .await
    .unwrap()
    .unwrap();

    // The first check isn't handed back as the draft: it predates what
    // setup made.
    assert!(
        matches!(&draft, Draft::Failed { message, .. } if message == SETUP_FAILED_PARTWAY),
        "{draft:?}"
    );
    assert_eq!(code.sources(), ["first"]);
}

#[tokio::test]
async fn a_draft_cancelled_while_setup_runs_stops_when_setup_ends() {
    let rows = Arc::new(Rows::default());
    let code = Arc::new(SetsUp {
        cancels: Some(Arc::clone(&rows)),
        ..SetsUp::returning(
            json!({ "orders": { "type": "database", "id": Uuid::now_v7().to_string() } }),
        )
    });
    let model = Arc::new(Model::new(
        named(&[]),
        vec![with_setup(posted_in(&[]), add_row("good", ORDERS), "first")],
    ));
    let drafts = setting_up_in(&code, &model, &rows);
    let id = Uuid::now_v7();
    rows.drafts
        .lock()
        .unwrap()
        .insert(id, (owner(), agent().bot, Default::default(), Utc::now()));
    rows.jobs.lock().unwrap().insert(
        id,
        JobRow {
            client_id: Uuid::now_v7(),
            phase: jobs::DraftJobPhase::Drafting,
            request: Default::default(),
            progress: Default::default(),
            result: None,
            finished_at: None,
            traceparent: None,
        },
    );
    let milestones = Milestones::default();

    let draft = draft_until(
        &drafts,
        routine(ORDERS_REQUEST),
        id,
        &milestones,
        CancellationToken::new(),
    )
    .await
    .unwrap();

    assert_eq!(draft, None);
    assert_eq!(code.sources(), ["first"]);
    // Nothing checked a routine nobody will read.
    assert!(!milestones.stages().contains(&"passed"));
    assert_eq!(*rows.finished.lock().unwrap(), [id]);
}

#[tokio::test]
async fn a_placeholder_with_no_setup_goes_back_to_the_writer() {
    let database = Uuid::now_v7().to_string();
    let model = Arc::new(Model::new(
        named(&[]),
        vec![
            json!({ "name": "Orders", "trigger": posted_in(&[]), "steps": [add_row("good", ORDERS)] })
                .to_string(),
            json!({ "steps": { "0": add_row("good", &database) } }).to_string(),
        ],
    ));
    let (drafts, _) = direct_drafts(&model, &Arc::new(Names::default()));

    let drafted =
        drafted_routine(draft(&drafts, routine(ORDERS_REQUEST), &Milestones::default()).await);

    assert_eq!(drafted.steps[0]["knobs"][0]["value"], json!(database));
    assert!(
        model.calls()[2]
            .asked()
            .contains("uses `{{setup.orders}}`, but has no `setup`")
    );
}

#[tokio::test]
async fn an_interrupted_draft_hands_back_its_last_check() {
    let interrupt = CancellationToken::new();
    let model = Arc::new(Model {
        interrupts: Some(interrupt.clone()),
        ..Model::new(
            named(&[]),
            vec![written(
                posted_in(&[]),
                json!([code_step("Make a task", "bad")]),
            )],
        )
    });
    let (drafts, _) = direct_drafts(&model, &Arc::new(Names::default()));

    let draft = draft_until(
        &drafts,
        routine(BUG_REPORTS),
        Uuid::now_v7(),
        &Milestones::default(),
        interrupt,
    )
    .await
    .unwrap()
    .unwrap();

    // The fix never came; the routine its check failed comes back with its
    // problem, as when the fixes run out.
    let drafted = drafted_routine(draft);
    assert_eq!(drafted.problems.len(), 1);
    assert_eq!(
        model.purposes(),
        [CallPurpose::Find, CallPurpose::Write, CallPurpose::Fix]
    );
}

#[tokio::test]
async fn an_interrupted_draft_keeps_what_its_setup_made() {
    let database = Uuid::now_v7().to_string();
    let code = Arc::new(SetsUp::returning(
        json!({ "orders": { "type": "database", "id": database } }),
    ));
    let interrupt = CancellationToken::new();
    let model = Arc::new(Model {
        interrupts: Some(interrupt.clone()),
        ..Model::new(
            named(&[]),
            vec![with_setup(
                json!({ "type": "hourly" }),
                add_row("good", ORDERS),
                "first",
            )],
        )
    });
    let drafts = setting_up(&code, &model);

    let draft = draft_until(
        &drafts,
        routine(ORDERS_REQUEST),
        Uuid::now_v7(),
        &Milestones::default(),
        interrupt,
    )
    .await
    .unwrap()
    .unwrap();

    let Draft::Failed { message, created } = draft else {
        panic!("expected a failure, got {draft:?}");
    };
    assert_eq!(message, INTERRUPTED);
    assert_eq!(
        created,
        [super::super::DraftCreated {
            entity_type: model_entity::EntityType::Database,
            entity_id: database,
            used: false,
        }]
    );
}

#[tokio::test]
async fn a_routine_needs_a_trigger_even_when_a_fix_leaves_it_out() {
    let step = code_step("Make a task", "good");
    let model = Arc::new(Model::new(
        named(&[]),
        vec![
            json!({ "name": "Bug tasks", "steps": [step] }).to_string(),
            json!({ "steps": { "0": step } }).to_string(),
            json!({ "trigger": posted_in(&[]) }).to_string(),
        ],
    ));
    let (drafts, _) = direct_drafts(&model, &Arc::new(Names::default()));
    let milestones = Milestones::default();

    let drafted = drafted_routine(draft(&drafts, routine(BUG_REPORTS), &milestones).await);

    assert_eq!(
        serde_json::to_value(drafted.trigger.unwrap()).unwrap()["type"],
        "events"
    );
    let calls = model.calls();
    assert!(calls[2].asked().contains("the routine has no `trigger`"));
    assert!(calls[3].asked().contains("the routine has no `trigger`"));
    assert_eq!(
        milestones.stages(),
        ["admitted", "found", "writing", "passed"]
    );
}

#[tokio::test]
async fn names_the_lookup_would_refuse_are_never_asked() {
    let long = "x".repeat(MAX_NAME_CHARS + 1);
    let model = Arc::new(Model::new(
        named(&[
            ("#", &[]),
            ("  @ ", &[]),
            (&long, &[]),
            ("#engineering", &["channel"]),
        ]),
        vec![written(
            posted_in(&[]),
            json!([code_step("Make a task", "good")]),
        )],
    ));
    let names = Arc::new(Names::default());
    let (drafts, _) = direct_drafts(&model, &names);

    drafted_routine(draft(&drafts, routine(BUG_REPORTS), &Milestones::default()).await);

    let asked: Vec<String> = names
        .asked
        .lock()
        .unwrap()
        .iter()
        .map(|asked| asked.name.clone())
        .collect();
    assert_eq!(asked, ["#engineering"]);
}

#[test]
fn a_name_a_kind_that_couldnt_be_searched_might_have_is_left_unknown() {
    let item = |kind, name: &str, id: &str| NameMatch {
        name: name.into(),
        exact: true,
        kind,
        id: id.into(),
        definition_id: None,
    };
    let asked = |name: &str, kinds: Vec<ItemKind>| NameAsked {
        name: name.into(),
        kinds,
    };
    let lookup = settle(
        &[
            asked("Finance", vec![ItemKind::Label, ItemKind::Project]),
            asked("design", vec![ItemKind::Channel, ItemKind::Label]),
            asked("Ops", Vec::new()),
            asked("Nobody", vec![ItemKind::Person]),
        ],
        NameAnswers {
            answers: vec![
                NameAnswer {
                    name: "Finance".into(),
                    matches: vec![item(ItemKind::Project, "Finance", "folder")],
                },
                NameAnswer {
                    name: "design".into(),
                    matches: vec![item(ItemKind::Channel, "design", "channel")],
                },
                NameAnswer {
                    name: "Ops".into(),
                    matches: Vec::new(),
                },
                NameAnswer {
                    name: "Nobody".into(),
                    matches: Vec::new(),
                },
            ],
            unavailable: vec![ItemKind::Label],
        },
    );

    // Not the folder: the label it more likely names couldn't be searched.
    assert_eq!(lookup.failed, ["Finance", "Ops"]);
    let found: Vec<&str> = lookup
        .found
        .iter()
        .map(|(item, _)| item.id.as_str())
        .collect();
    assert_eq!(found, ["channel"]);
    assert_eq!(
        lookup.left,
        [LeftName {
            name: "Nobody".into(),
            kind: Some(ItemKind::Person),
            matches: 0,
        }]
    );
}

#[tokio::test]
async fn a_draft_cut_off_while_setup_runs_says_it_may_have_made_something() {
    let interrupt = CancellationToken::new();
    let code = Arc::new(SetsUp {
        hangs: Some(interrupt.clone()),
        ..SetsUp::returning(json!({}))
    });
    let model = Arc::new(Model::new(
        named(&[]),
        vec![
            written(posted_in(&[]), json!([code_step("Make a task", "bad")])),
            json!({ "setup": "first", "steps": { "0": add_row("good", ORDERS) } }).to_string(),
        ],
    ));
    let drafts = setting_up(&code, &model);

    let draft = draft_until(
        &drafts,
        routine(ORDERS_REQUEST),
        Uuid::now_v7(),
        &Milestones::default(),
        interrupt,
    )
    .await
    .unwrap()
    .unwrap();

    // Its first check failed, but what setup made is unknown: it says so.
    let Draft::Failed { message, created } = draft else {
        panic!("expected a failure, got {draft:?}");
    };
    assert_eq!(message, SETUP_FAILED_PARTWAY);
    assert!(created.is_empty());
    assert_eq!(code.sources(), ["first"]);
}

#[tokio::test]
async fn without_code_setup_never_runs_and_its_items_are_left_for_the_owner() {
    let code = Arc::new(SetsUp::returning(json!({})));
    let ask = |instructions: &str| json!({ "type": "agent", "model": context().agent_model, "instructions": instructions });
    let model = Arc::new(Model::new(
        named(&[]),
        vec![
            with_setup(
                posted_in(&[]),
                ask("Add a row to {{setup.orders}}"),
                "first",
            ),
            json!({ "steps": { "0": ask("Add a row to the owner's orders database") } })
                .to_string(),
        ],
    ));
    let drafts = setting_up(&code, &model);

    let draft = draft_in(
        &drafts,
        routine(ORDERS_REQUEST),
        DraftContext {
            code: false,
            ..context()
        },
        Uuid::now_v7(),
        &Milestones::default(),
        CancellationToken::new(),
    )
    .await
    .unwrap()
    .unwrap();

    let drafted = drafted_routine(draft);
    assert_eq!(
        drafted.steps[0]["instructions"],
        "Add a row to the owner's orders database"
    );
    assert!(code.ran().is_empty());
    let calls = model.calls();
    assert!(calls[1].system.contains("Never write `setup`"));
    assert!(!calls[1].system.contains("{{setup.<key>}}"));
    assert!(!calls[1].asked().contains("<sdk>"));
    assert!(
        calls[2].asked().contains(SETUP_UNAVAILABLE),
        "{}",
        calls[2].asked()
    );
}

#[tokio::test]
async fn areas_the_sdk_doesnt_have_give_the_writer_the_commonest_ones() {
    let code = Arc::new(SetsUp::returning(json!({})));
    let model = Arc::new(Model::new(
        json!({ "names": [], "sdk": ["slack"] }),
        vec![written(
            posted_in(&[]),
            json!([code_step("Make a task", "good")]),
        )],
    ));
    let drafts = setting_up(&code, &model);

    let draft = draft_until(
        &drafts,
        routine(BUG_REPORTS),
        Uuid::now_v7(),
        &Milestones::default(),
        CancellationToken::new(),
    )
    .await
    .unwrap()
    .unwrap();

    drafted_routine(draft);
    let areas = code.areas.lock().unwrap().clone();
    assert!(
        areas.ends_with(&[
            vec!["slack".to_owned()],
            FALLBACK_AREAS
                .iter()
                .map(|area| (*area).to_owned())
                .collect(),
        ]),
        "{areas:?}"
    );
    assert!(
        model.calls()[1]
            .asked()
            .contains("the reference of channels, tasks, email")
    );
}

#[test]
fn found_items_go_in_steps_by_name_unless_tuned_to_ids() {
    let code = Checker::default();
    let by_name = DirectPrompts::new(&code, "the guide", ItemKnobs::Names);
    let by_id = DirectPrompts::new(&code, "the guide", ItemKnobs::Ids);

    for (code, conditions) in [(true, false), (true, true), (false, false), (false, true)] {
        let named = by_name.write(code, conditions);
        assert!(named.contains(ITEMS_BY_NAME.trim()));
        assert!(!named.contains(ITEMS_BY_ID.trim()));
        assert!(!named.contains("{items}"));
        assert!(by_id.write(code, conditions).contains(ITEMS_BY_ID.trim()));
    }
    assert_eq!(DirectTuning::default().item_knobs, ItemKnobs::Names);
}

#[test]
fn code_the_host_may_not_have_still_gives_the_writer_its_sdk_areas() {
    let code = Some(SetsUp::returning(json!({})));

    assert_eq!(
        code.area_reference(&["tasks".to_owned()]),
        "the reference of tasks"
    );
    assert!(
        None::<SetsUp>
            .area_reference(&["tasks".to_owned()])
            .is_empty()
    );
    let prompts = DirectPrompts::new(&code, "the guide", ItemKnobs::Names);
    assert!(prompts.write(true, false).contains("the reference of ai"));
}

#[tokio::test]
async fn a_step_for_a_routine_whose_trigger_isnt_one_yet_is_checked_alone() {
    let model = Arc::new(Model::new(
        named(&[]),
        vec![json!({ "step": code_step("Post it", "good") }).to_string()],
    ));
    let (drafts, _) = direct_drafts(&model, &Arc::new(Names::default()));
    let request = DraftRequest::AddStep {
        description: "post a summary".into(),
        routine: RoutineSoFar {
            // The editor's custom schedule, not filled in yet.
            trigger: Some(json!({ "type": "cron" })),
            steps: Vec::new(),
        },
        kind: None,
    };

    let draft = draft(&drafts, request, &Milestones::default()).await;

    assert!(matches!(draft, Draft::Step(_)), "{draft:?}");
    // The step's writer can't change the trigger, so it isn't sent back.
    assert_eq!(model.purposes(), [CallPurpose::Find, CallPurpose::Write]);
}
