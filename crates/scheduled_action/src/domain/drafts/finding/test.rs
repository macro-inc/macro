use std::sync::Mutex;

use strum::VariantArray as _;

use crate::domain::ports::RoutineDraftService as _;
use ai_billing::AiAdmissionError;
use serde_json::{Value, json};

use super::super::test::{
    BUG_REPORTS, Connected, Rows, Sessions, Turn, agent, app, code_step, configuration, context,
    message_posted, owner, plain, routine,
};
use super::super::{Draft, DraftedRoutine, RoutineDrafts};
use super::*;
use crate::domain::code_check::test::Checker;
use crate::domain::ports::{CodeOutcome, CodeRun, CodeUnavailable, StepProblems};
use macro_uuid::Uuid;

/// Answers the find call with `find`, failing without it, or never, when it
/// `hangs`; records every call.
#[derive(Default)]
struct Model {
    refuses: bool,
    hangs: bool,
    find: Option<String>,
    calls: Mutex<Vec<(String, String)>>,
}

impl Model {
    fn finding(find: Value) -> Self {
        Self {
            find: Some(find.to_string()),
            ..Self::default()
        }
    }

    /// Each call's instructions and prompt.
    fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().unwrap().clone()
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
        self.calls
            .lock()
            .unwrap()
            .push((call.system.to_owned(), call.prompt.to_owned()));
        if self.hangs {
            std::future::pending::<()>().await;
        }
        self.find
            .clone()
            .ok_or_else(|| DraftCallError(rootcause::report!("no answer")))
    }
}

/// A workspace's items by name: a name matches exactly when it is the
/// item's, ignoring case, and loosely when the item's contains it.
#[derive(Default)]
struct Names {
    items: Vec<(ItemKind, &'static str, String)>,
    /// The kinds it searches; every kind when not set.
    searched: Option<Vec<ItemKind>>,
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

    fn asked(&self) -> Vec<String> {
        self.asked
            .lock()
            .unwrap()
            .iter()
            .map(|asked| asked.name.clone())
            .collect()
    }
}

#[async_trait::async_trait]
impl NameLookups for Names {
    fn kinds(&self) -> &[ItemKind] {
        self.searched.as_deref().unwrap_or(ItemKind::VARIANTS)
    }

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
                unavailable: Vec::new(),
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

/// What a draft reported, in order.
#[derive(Default)]
struct Milestones(Mutex<Vec<DraftMilestone>>);

impl DraftProgress for Milestones {
    fn report(&self, milestone: DraftMilestone) {
        self.0.lock().unwrap().push(milestone);
    }
}

/// Checks as `Checker` does, and has a reference of each of [`SDK_AREAS`].
#[derive(Default)]
struct Areas {
    checker: Checker,
    /// The areas each reference was asked for.
    asked: Mutex<Vec<Vec<String>>>,
}

/// The SDK areas [`Areas`] has a reference of.
const SDK_AREAS: &[&str] = &[
    "ai",
    "routines",
    "channels",
    "tasks",
    "email",
    "databases",
    "users",
    "documents",
];

impl RoutineCode for Areas {
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

    async fn run(&self, _: &MacroUserIdStr<'static>, _: CodeRun<'_>) -> CodeOutcome {
        unreachable!("finding runs no code")
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

    fn sdk_areas(&self) -> String {
        SDK_AREAS.join("\n")
    }

    fn area_reference(&self, areas: &[String]) -> String {
        self.asked.lock().unwrap().push(areas.to_vec());
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

/// Finding whose usage is admitted, then whose fast model never answers: a
/// draft still finding its items, for the background jobs' tests.
pub(in crate::domain::drafts) fn never_answering() -> DraftFinding {
    DraftFinding {
        model: Arc::new(Model {
            hangs: true,
            ..Model::default()
        }),
        names: Arc::new(Names::default()),
    }
}

/// Drafts that find their items with `model` and `names`, in sessions whose
/// turn is `turn`.
fn finding(
    model: &Arc<Model>,
    names: &Arc<Names>,
    turn: Turn,
) -> (RoutineDrafts<Areas, Sessions>, Arc<Sessions>, Arc<Areas>) {
    let rows = Arc::new(Rows::default());
    let sessions = Arc::new(Sessions::new(&rows, turn));
    let code = Arc::new(Areas::default());
    let drafts = RoutineDrafts::new(
        Arc::clone(&code),
        Arc::clone(&sessions),
        rows as Arc<dyn crate::domain::ports::DraftHandBacks>,
        agent(),
    )
    .with_conditions_enabled(true)
    .with_finding(DraftFinding {
        model: Arc::clone(model) as Arc<dyn DraftModel>,
        names: Arc::clone(names) as Arc<dyn NameLookups>,
    });
    (drafts, sessions, code)
}

/// A session that checks one routine posting a task from `channel`.
fn checks_bug_tasks(channel: Uuid) -> Turn {
    Box::new(move |_| {
        vec![plain(configuration(
            "Bug tasks",
            message_posted(&[channel]),
            json!([code_step("Make a task", "good")]),
        ))]
    })
}

async fn draft(drafts: &RoutineDrafts<Areas, Sessions>, request: DraftRequest) -> Draft {
    drafts.draft(owner(), request, context()).await.unwrap()
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

/// The session's instructions and prompt.
fn briefs(sessions: &Sessions) -> (Option<String>, String) {
    let prepared = sessions.prepared.lock().unwrap();
    let prompts = sessions.prompts.lock().unwrap();
    assert_eq!(prepared.len(), 1);
    (prepared[0].instructions.clone(), prompts[0].clone())
}

#[tokio::test(start_paused = true)]
async fn a_draft_finds_the_items_its_words_name_before_its_session_starts() {
    let channel = Uuid::now_v7();
    let model = Arc::new(Model::finding(named(&[
        ("bug-reports", &["channel"]),
        ("Jordan", &["person"]),
    ])));
    let names = Arc::new(Names::of(vec![
        (ItemKind::Channel, "bug-reports", channel.to_string()),
        (
            ItemKind::Channel,
            "bug-reports-archive",
            Uuid::now_v7().to_string(),
        ),
        (
            ItemKind::Person,
            "Jordan",
            "macro|jordan@example.com".into(),
        ),
        (
            ItemKind::Person,
            "jordan",
            "macro|jordan2@example.com".into(),
        ),
    ]));
    let (drafts, sessions, _) = finding(&model, &names, checks_bug_tasks(channel));

    let drafted = drafted_routine(draft(&drafts, routine(BUG_REPORTS)).await);

    assert_eq!(drafted.name, "Bug tasks");
    assert!(drafted.problems.is_empty());
    let calls = model.calls();
    assert_eq!(calls.len(), 1);
    assert!(calls[0].0.contains("<sdk-areas>\nai\nroutines\nchannels"));
    assert!(calls[0].1.contains(BUG_REPORTS));
    let (instructions, prompt) = briefs(&sessions);
    // The instructions are the same for every draft, so the prompt cache
    // reads them back: the request, its items and its areas are the prompt.
    let instructions = instructions.expect("the session is given instructions");
    assert!(instructions.contains("the reference of routines\n\nthe reference of ai"));
    assert!(instructions.contains(ITEMS.trim()));
    assert!(!instructions.contains(BUG_REPORTS));
    assert!(!instructions.contains(&channel.to_string()));
    assert!(prompt.contains(BUG_REPORTS));
    assert!(prompt.contains(&format!("the channel named \"bug-reports\", id {channel}")));
    assert!(prompt.contains("\"Jordan\" (person): 2 have that name"));
    assert!(prompt.contains("<sdk>\nthe reference of tasks, channels\n</sdk>"));
}

#[tokio::test(start_paused = true)]
async fn a_draft_reports_what_it_found_by_name_before_its_session_starts() {
    let model = Arc::new(Model::finding(named(&[
        ("bug-reports", &["channel"]),
        ("Jordan", &["person"]),
    ])));
    let names = Arc::new(Names::of(vec![
        (ItemKind::Channel, "bug-reports", "channel".into()),
        (
            ItemKind::Person,
            "Jordan",
            "macro|jordan@example.com".into(),
        ),
        (
            ItemKind::Person,
            "jordan",
            "macro|jordan2@example.com".into(),
        ),
    ]));
    let (drafts, sessions, _) = finding(&model, &names, Box::new(|_| Vec::new()));
    let milestones = Milestones::default();
    let request = routine(BUG_REPORTS);
    let (program, context) = drafts.read_request(&request, context()).unwrap();

    drafts
        .briefed(&owner(), &request, &program, &context, &milestones)
        .await
        .unwrap()
        .unwrap();

    let reported = milestones.0.lock().unwrap();
    assert!(matches!(reported[0], DraftMilestone::Admitted));
    assert_eq!(
        reported[1],
        DraftMilestone::Found(FoundNames {
            found: vec![FoundName {
                name: "bug-reports".into(),
                kind: ItemKind::Channel,
            }],
            left: vec![LeftName {
                name: "Jordan".into(),
                kind: Some(ItemKind::Person),
                matches: 2,
            }],
        })
    );
    assert_eq!(reported.len(), 2);
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

/// Every draft on one model with the same code and conditions shares its
/// instructions, so the prompt cache keeps them across drafts.
#[tokio::test(start_paused = true)]
async fn every_draft_of_one_kind_shares_its_instructions() {
    let model = Arc::new(Model::finding(named(&[])));
    let (drafts, sessions, _) = finding(
        &model,
        &Arc::new(Names::default()),
        Box::new(|_| Vec::new()),
    );

    draft(&drafts, routine(BUG_REPORTS)).await;
    draft(
        &drafts,
        routine("every Monday post the week's tasks in #standup"),
    )
    .await;

    let prepared = sessions.prepared.lock().unwrap();
    assert_eq!(prepared.len(), 2);
    assert!(prepared[0].instructions.is_some());
    assert_eq!(prepared[0].instructions, prepared[1].instructions);
    let prompts = sessions.prompts.lock().unwrap();
    assert_ne!(prompts[0], prompts[1]);
}

#[test]
fn the_instructions_say_what_this_kind_of_draft_may_write() {
    let prompts = FindingPrompts::new(&Areas::default());
    let model = "anthropic/claude-sonnet-5-5";

    let code = prompts.instructions(true, true, model);
    assert!(code.contains(CODE_STEPS));
    assert!(code.contains("a code step never messages or emails the routine's owner"));
    assert!(code.contains(&format!("model: '{model}'")));
    assert!(code.contains("may carry a `condition`"));
    assert!(
        prompts
            .instructions(true, false, model)
            .contains("Never give a trigger a `condition`.")
    );
    let prose = prompts.instructions(false, false, model);
    assert!(prose.contains("Code steps can't be used"));
    assert!(!prose.contains(CODE_STEPS));
    assert!(prose.contains("the reference of routines"));
    assert!(!prose.contains("the reference of ai"));
    for text in [code, prose] {
        for placeholder in [
            "{items}",
            "{conditions}",
            "{steps}",
            "{icons}",
            "{reference}",
        ] {
            assert!(!text.contains(placeholder), "{placeholder}");
        }
    }
}

#[test]
fn the_instructions_ask_for_a_look_from_macros_icons_and_colors() {
    let prompts = FindingPrompts::new(&Areas::default());
    for text in [
        prompts.instructions(true, true, "model"),
        prompts.instructions(false, false, "model"),
    ] {
        assert!(text.contains("{name, appearance, trigger, steps: [...]}"));
        assert!(text.contains(&model_entity::macro_icon_names().join(", ")));
        let colors = text
            .split_once("`color` one of ")
            .and_then(|(_, rest)| rest.split_once('.'))
            .map(|(colors, _)| colors)
            .unwrap();
        let colors: Vec<&str> = colors.split(", ").collect();
        assert_eq!(colors.len(), 12, "{colors:?}");
        for color in colors {
            serde_json::from_value::<model_entity::AppearanceColor>(json!(color))
                .unwrap_or_else(|error| panic!("{color}: {error}"));
        }
    }
}
#[tokio::test(start_paused = true)]
async fn without_code_the_prompt_carries_no_area_reference() {
    let model = Arc::new(Model::finding(named(&[])));
    let (drafts, sessions, _) = finding(
        &model,
        &Arc::new(Names::default()),
        Box::new(|_| Vec::new()),
    );

    drafts
        .draft(
            owner(),
            routine(BUG_REPORTS),
            DraftContext {
                code: false,
                ..context()
            },
        )
        .await
        .unwrap();

    let (instructions, prompt) = briefs(&sessions);
    assert!(instructions.unwrap().contains("Code steps can't be used"));
    assert!(!prompt.contains("<sdk>"));
}

#[tokio::test(start_paused = true)]
async fn without_code_the_prompt_carries_the_areas_that_find_names_not_looked_up() {
    let model = Arc::new(Model::finding(named(&[("Jordan", &["person"])])));
    let names = Arc::new(Names {
        searched: Some(vec![ItemKind::Channel]),
        ..Names::default()
    });
    let (drafts, sessions, _) = finding(&model, &names, Box::new(|_| Vec::new()));

    drafts
        .draft(
            owner(),
            routine(BUG_REPORTS),
            DraftContext {
                code: false,
                ..context()
            },
        )
        .await
        .unwrap();

    // Only the area that finds the person, not the ones a code step would use.
    let (_, prompt) = briefs(&sessions);
    assert!(prompt.contains("- \"Jordan\" (person)"));
    assert!(prompt.contains("<sdk>\nthe reference of users\n</sdk>"));
}

/// The prompt of a draft whose find call `model` answers, looked up among
/// channels only, with or without `code`.
async fn prompt_after_find(model: Model, code: bool) -> String {
    let names = Names {
        searched: Some(vec![ItemKind::Channel]),
        ..Names::default()
    };
    let (drafts, sessions, _) = finding(
        &Arc::new(model),
        &Arc::new(names),
        checks_bug_tasks(Uuid::now_v7()),
    );
    drafts
        .draft(
            owner(),
            routine(BUG_REPORTS),
            DraftContext { code, ..context() },
        )
        .await
        .unwrap();
    briefs(&sessions).1
}

#[tokio::test(start_paused = true)]
async fn a_failed_find_has_the_session_look_up_every_item_named() {
    let failing = Model::default;
    let unreadable = || Model {
        find: Some("No items here.".into()),
        ..Model::default()
    };
    let hanging = || Model {
        hangs: true,
        ..Model::default()
    };
    for (model, code, areas) in [
        (failing(), true, "channels, tasks, email, users, documents"),
        (
            unreadable(),
            true,
            "channels, tasks, email, users, documents",
        ),
        (hanging(), true, "channels, tasks, email, users, documents"),
        (failing(), false, "channels, users, documents"),
        (unreadable(), false, "channels, users, documents"),
    ] {
        let prompt = prompt_after_find(model, code).await;

        assert!(prompt.contains(
            "Not looked up (look each up yourself before you write the routine):\n- every item the request names, each by its name alone"
        ));
        assert!(!prompt.contains("The request names no item to look up."));
        // The commonest areas, and the ones that find the commonest items.
        assert!(
            prompt.contains(&format!("<sdk>\nthe reference of {areas}\n</sdk>")),
            "{prompt}"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn a_name_of_no_known_kind_gets_the_areas_that_find_the_commonest_items() {
    let prompt = prompt_after_find(Model::finding(named(&[("Finance", &[])])), false).await;

    assert!(prompt.contains(
        "Not looked up (look each up yourself before you write the routine):\n- \"Finance\"\n"
    ));
    assert!(prompt.contains("<sdk>\nthe reference of channels, users, documents\n</sdk>"));
}

#[tokio::test(start_paused = true)]
async fn a_find_naming_nothing_has_nothing_looked_up() {
    let prompt = prompt_after_find(Model::finding(named(&[])), true).await;

    assert!(prompt.contains("The request names no item to look up."));
    assert!(!prompt.contains("Not looked up"));
}

#[tokio::test(start_paused = true)]
async fn a_find_that_never_answers_is_given_up() {
    let model = Arc::new(Model {
        hangs: true,
        ..Model::default()
    });
    let (drafts, sessions, _) = finding(
        &model,
        &Arc::new(Names::default()),
        checks_bug_tasks(Uuid::now_v7()),
    );

    let started = tokio::time::Instant::now();
    drafted_routine(draft(&drafts, routine(BUG_REPORTS)).await);

    assert!(started.elapsed() >= FIND_TIMEOUT);
    assert_eq!(sessions.prepared.lock().unwrap().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn names_that_couldnt_be_looked_up_go_to_the_session() {
    let model = Arc::new(Model::finding(named(&[("bug-reports", &["channel"])])));
    let names = Arc::new(Names {
        fails: true,
        ..Names::default()
    });
    let (drafts, sessions, _) = finding(&model, &names, Box::new(|_| Vec::new()));

    draft(&drafts, routine(BUG_REPORTS)).await;

    let (_, prompt) = briefs(&sessions);
    assert!(prompt.contains("Not looked up (look each up yourself before you write the routine):\n- \"bug-reports\" (channel)"));
    assert!(!prompt.contains("Left for the owner"));
}

#[tokio::test(start_paused = true)]
async fn names_of_kinds_the_lookup_doesnt_search_go_to_the_session_unreported() {
    let channel = Uuid::now_v7();
    let model = Arc::new(Model::finding(named(&[
        ("bug-reports", &["channel"]),
        ("Jordan", &["person"]),
        ("Finance", &["label", "channel"]),
        ("eng", &["channel", "person"]),
    ])));
    let names = Arc::new(Names {
        searched: Some(vec![ItemKind::Channel]),
        ..Names::of(vec![
            (ItemKind::Channel, "bug-reports", channel.to_string()),
            (ItemKind::Channel, "Finance", Uuid::now_v7().to_string()),
            (
                ItemKind::Person,
                "Jordan",
                "macro|jordan@example.com".into(),
            ),
        ])
    });
    let (drafts, sessions, _) = finding(&model, &names, checks_bug_tasks(channel));
    let milestones = Milestones::default();
    let request = routine(BUG_REPORTS);
    let (program, context) = drafts.read_request(&request, context()).unwrap();

    let brief = drafts
        .briefed(&owner(), &request, &program, &context, &milestones)
        .await
        .unwrap()
        .unwrap();

    // A name whose likeliest kind it doesn't search isn't asked; one that
    // may also be of such a kind is asked only for the kinds it searches.
    assert_eq!(names.asked(), ["bug-reports", "eng"]);
    let asked = names.asked.lock().unwrap();
    assert_eq!(asked[1].kinds, [ItemKind::Channel]);
    drop(asked);
    // The session looks them up; the person isn't told they're missing.
    assert!(
        brief
            .prompt
            .contains(&format!("the channel named \"bug-reports\", id {channel}"))
    );
    assert!(brief.prompt.contains(
        "Not looked up (look each up yourself before you write the routine):\n- \"Jordan\" (person)\n- \"Finance\" (email label or channel)\n- \"eng\" (channel or person)\n"
    ));
    // With the reference of the areas that find them, after the ones the
    // routine uses.
    assert!(
        brief
            .prompt
            .contains("<sdk>\nthe reference of tasks, channels, users, email\n</sdk>")
    );
    assert!(!brief.prompt.contains("Left for the owner"));
    let reported = milestones.0.lock().unwrap();
    assert_eq!(
        reported[1],
        DraftMilestone::Found(FoundNames {
            found: vec![FoundName {
                name: "bug-reports".into(),
                kind: ItemKind::Channel,
            }],
            left: Vec::new(),
        })
    );
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn the_areas_that_find_names_not_looked_up_take_each_names_likeliest_kind_first() {
    let channel = Uuid::now_v7();
    let model = Arc::new(Model::finding(named(&[
        ("Finance", &["label", "tag", "agent"]),
        ("Jordan", &["person"]),
        ("Hiring", &["database"]),
        ("Ops", &["initiative"]),
    ])));
    let names = Arc::new(Names {
        searched: Some(vec![ItemKind::Channel]),
        ..Names::default()
    });
    let (drafts, _, code) = finding(&model, &names, checks_bug_tasks(channel));
    let request = routine(BUG_REPORTS);
    let (program, context) = drafts.read_request(&request, context()).unwrap();

    drafts
        .briefed(
            &owner(),
            &request,
            &program,
            &context,
            &Milestones::default(),
        )
        .await
        .unwrap()
        .unwrap();

    // The routine's areas, then one per name by its likeliest kind, at most
    // three: a name's less likely kinds don't push out another's likeliest.
    let asked = code.asked.lock().unwrap();
    assert_eq!(
        asked.last().unwrap(),
        &["tasks", "channels", "email", "users", "databases"]
    );
}

#[tokio::test(start_paused = true)]
async fn a_refused_admission_is_an_error_before_any_call_or_session() {
    let model = Arc::new(Model {
        refuses: true,
        ..Model::finding(named(&[]))
    });
    let (drafts, sessions, _) = finding(
        &model,
        &Arc::new(Names::default()),
        Box::new(|_| Vec::new()),
    );

    let error = drafts
        .draft(owner(), routine(BUG_REPORTS), context())
        .await
        .unwrap_err();

    assert!(
        error.downcast_ref::<AiAdmissionError>().is_some(),
        "{error:?}"
    );
    assert!(model.calls().is_empty());
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn names_the_lookup_would_refuse_are_never_asked() {
    let long = "x".repeat(MAX_NAME_CHARS + 1);
    let model = Arc::new(Model::finding(named(&[
        ("#", &[]),
        ("  @ ", &[]),
        (&long, &[]),
        ("#engineering", &["channel"]),
    ])));
    let names = Arc::new(Names::default());
    let (drafts, _, _) = finding(&model, &names, Box::new(|_| Vec::new()));

    draft(&drafts, routine(BUG_REPORTS)).await;

    assert_eq!(names.asked(), ["#engineering"]);
}

/// The prompt carries the areas the find call named past the ones the
/// instructions carry, and the commonest ones when the SDK has none of them.
#[tokio::test(start_paused = true)]
async fn the_prompt_carries_the_areas_the_routine_uses() {
    for (sdk, reference) in [
        (json!(["ai", "routines", "tasks"]), "the reference of tasks"),
        (json!(["slack"]), "the reference of channels, tasks, email"),
    ] {
        let model = Arc::new(Model::finding(json!({ "names": [], "sdk": sdk })));
        let (drafts, sessions, _) = finding(
            &model,
            &Arc::new(Names::default()),
            Box::new(|_| Vec::new()),
        );

        draft(&drafts, routine(BUG_REPORTS)).await;

        let (_, prompt) = briefs(&sessions);
        assert!(
            prompt.contains(&format!("<sdk>\n{reference}\n</sdk>")),
            "{prompt}"
        );
    }
}

#[test]
fn the_answer_is_the_first_json_object_past_any_prose() {
    assert_eq!(
        json_answer("Sure:\n```json\n{\"a\": {\"b\": 1}}\n```\nDone {not json}"),
        Some(json!({ "a": { "b": 1 } }))
    );
    assert!(json_answer("no names here").is_none());
    assert!(json_answer("{\"a\": ").is_none());
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
                    unavailable: Vec::new(),
                    matches: vec![
                        item(ItemKind::Project, "Finance", "folder", true),
                        item(ItemKind::Label, "Finance", "label", true),
                        item(ItemKind::Label, "Finance/Receipts", "nested", false),
                    ],
                },
                NameAnswer {
                    name: "Design".into(),
                    unavailable: Vec::new(),
                    matches: vec![
                        item(ItemKind::Channel, "design", "one", true),
                        item(ItemKind::Channel, "Design", "two", true),
                    ],
                },
                NameAnswer {
                    name: "Ops".into(),
                    unavailable: Vec::new(),
                    matches: vec![
                        item(ItemKind::Channel, "ops", "channel", true),
                        item(ItemKind::Channel, "ops", "channel", true),
                    ],
                },
                NameAnswer {
                    name: "Nobody".into(),
                    unavailable: Vec::new(),
                    matches: vec![item(ItemKind::Person, "Nobody Else", "person", false)],
                },
                NameAnswer {
                    name: "Planning".into(),
                    unavailable: Vec::new(),
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
            asked("Billing", Vec::new()),
            asked("Nobody", vec![ItemKind::Person]),
        ],
        NameAnswers {
            answers: vec![
                NameAnswer {
                    name: "Finance".into(),
                    unavailable: Vec::new(),
                    matches: vec![item(ItemKind::Project, "Finance", "folder")],
                },
                NameAnswer {
                    name: "design".into(),
                    unavailable: Vec::new(),
                    matches: vec![item(ItemKind::Channel, "design", "channel")],
                },
                NameAnswer {
                    name: "Ops".into(),
                    unavailable: Vec::new(),
                    matches: Vec::new(),
                },
                NameAnswer {
                    name: "Billing".into(),
                    unavailable: Vec::new(),
                    matches: vec![item(ItemKind::Channel, "Billing", "billing")],
                },
                NameAnswer {
                    name: "Nobody".into(),
                    unavailable: Vec::new(),
                    matches: Vec::new(),
                },
            ],
            unavailable: vec![ItemKind::Label],
        },
    );

    // Not the folder: the label it more likely names couldn't be searched.
    // Nor the one channel named Billing: a label might be named so too.
    let unsearched: Vec<&str> = lookup
        .unsearched
        .iter()
        .map(|name| name.name.as_str())
        .collect();
    assert_eq!(unsearched, ["Finance", "Ops", "Billing"]);
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

#[test]
fn a_kind_one_name_couldnt_be_read_for_leaves_only_that_name_unknown() {
    let item = |kind, name: &str, id: &str| NameMatch {
        name: name.into(),
        exact: true,
        kind,
        id: id.into(),
        definition_id: None,
    };
    let asked = |name: &str| NameAsked {
        name: name.into(),
        kinds: vec![ItemKind::Document],
    };
    let lookup = settle(
        &[asked("Roadmap"), asked("Weekly metrics")],
        NameAnswers {
            answers: vec![
                // Its search read only a page: an older "Roadmap" may exist.
                NameAnswer {
                    name: "Roadmap".into(),
                    unavailable: vec![ItemKind::Document],
                    matches: vec![item(ItemKind::Document, "Roadmap", "roadmap")],
                },
                NameAnswer {
                    name: "Weekly metrics".into(),
                    unavailable: Vec::new(),
                    matches: vec![item(ItemKind::Document, "Weekly metrics", "metrics")],
                },
            ],
            unavailable: Vec::new(),
        },
    );

    assert_eq!(
        lookup
            .found
            .iter()
            .map(|(item, _)| item.id.as_str())
            .collect::<Vec<_>>(),
        ["metrics"]
    );
    assert!(lookup.left.is_empty());
    assert_eq!(
        lookup
            .unsearched
            .iter()
            .map(|asked| asked.name.as_str())
            .collect::<Vec<_>>(),
        ["Roadmap"]
    );
}

/// A found draft's prompt lists the apps its owner connected; its
/// instructions, which every draft shares, never do.
#[tokio::test(start_paused = true)]
async fn the_apps_its_owner_connected_are_in_the_prompt_not_the_instructions() {
    let model = Arc::new(Model::finding(named(&[])));
    let (drafts, sessions, _) = finding(
        &model,
        &Arc::new(Names::default()),
        Box::new(|_| Vec::new()),
    );
    let drafts = drafts.with_apps(Arc::new(Connected(Some(vec![app("linear", "Linear")]))));

    draft(&drafts, routine("file each bug in Linear")).await;

    let (instructions, prompt) = briefs(&sessions);
    assert!(prompt.contains("## Apps they connected"), "{prompt}");
    assert!(
        prompt.contains(r#"{ slug: "linear", name: "Linear" }"#),
        "{prompt}"
    );
    assert!(!instructions.unwrap().contains("Linear"));
}
