use super::*;
use std::sync::Mutex;

static PREVIOUS: EventKey<()> = EventKey::new("previous");
static MAIN: EventKey<()> = EventKey::new("main");
static EXISTING: EventKey<()> = EventKey::new("existing");
static SHARED: EventKey<()> = EventKey::new("shared");
static CONDITIONAL: EventKey<()> = EventKey::new("conditional");
static ISOLATED: EventKey<()> = EventKey::new("isolated");
type Trace = Arc<Mutex<Vec<(&'static str, &'static str, usize)>>>;

fn label(commit: &Commit) -> &'static str {
    commit
        .events
        .first()
        .map(PluginEvent::name)
        .unwrap_or("noop")
}
struct ObserveRound {
    trace: Trace,
    fail: bool,
}
impl ObserveRound {
    fn record(&self, phase: &'static str, prior: &Commit) {
        self.trace
            .lock()
            .expect("trace")
            .push((phase, label(prior), prior.following.len()));
    }
}
impl Plugin for ObserveRound {
    fn name(&self) -> &'static str {
        "round-observer"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, prior: &Commit) -> Result<(), Error> {
        self.record("shared", prior);
        if label(prior) == "main" {
            tx.emit(&SHARED, ());
        }
        Ok(())
    }
    fn conditional_after_commit<'a>(&'a self, prior: &'a Commit) -> Option<ConditionalUpdate<'a>> {
        self.record("conditional", prior);
        if label(prior) != "main" {
            return None;
        }
        Some(Box::new(|tx| {
            tx.emit(&CONDITIONAL, ());
            Ok(true)
        }))
    }
    fn isolated_after_commit(&self) -> Option<&dyn IsolatedAfterCommit> {
        Some(self)
    }
}
impl IsolatedAfterCommit for ObserveRound {
    fn apply(&self, tx: &mut Transaction<'_>, prior: &Commit) -> Result<bool, Error> {
        self.record("isolated", prior);
        if label(prior) != "main" {
            return Ok(false);
        }
        tx.emit(&ISOLATED, ());
        if self.fail {
            return Err(Error::Invariant("isolated ordering failure"));
        }
        Ok(true)
    }
}
fn fixture(fail: bool) -> Result<(Editor, Commit, Trace), Error> {
    let trace = Arc::new(Mutex::new(Vec::new()));
    let mut editor = Editor::builder(EditorMode::Headless)
        .plugin(ObserveRound {
            trace: trace.clone(),
            fail,
        })
        .build()
        .expect("editor");
    let mut publish = |event: &'static EventKey<()>| {
        let mut tx = editor.transaction();
        tx.emit(event, ());
        tx.commit()
    };
    let previous = publish(&PREVIOUS)?;
    let mut main = publish(&MAIN)?;
    let existing = publish(&EXISTING)?;
    main.preceding = Some(Box::new(previous));
    main.following = vec![existing, editor.noop_commit()];
    Ok((editor, main, trace))
}

#[test]
fn every_phase_observes_the_prior_chain_before_the_rounds_new_followups() -> Result<(), Error> {
    let (mut editor, main, trace) = fixture(false)?;
    let result = editor.run_after_commit(main);
    assert_eq!(
        *trace.lock().expect("trace"),
        vec![
            ("shared", "previous", 0),
            ("shared", "main", 2),
            ("shared", "existing", 0),
            ("conditional", "previous", 0),
            ("conditional", "main", 2),
            ("conditional", "existing", 0),
            ("isolated", "previous", 0),
            ("isolated", "main", 2),
            ("isolated", "existing", 0),
            ("shared", "shared", 0),
            ("shared", "conditional", 0),
            ("shared", "isolated", 0),
            ("conditional", "shared", 0),
            ("conditional", "conditional", 0),
            ("conditional", "isolated", 0),
            ("isolated", "shared", 0),
            ("isolated", "conditional", 0),
            ("isolated", "isolated", 0),
        ]
    );
    assert_eq!(
        result
            .chain()
            .filter(|entry| !entry.is_noop())
            .map(label)
            .collect::<Vec<_>>(),
        vec![
            "previous",
            "main",
            "existing",
            "shared",
            "conditional",
            "isolated"
        ]
    );
    assert!(result.follow_up_error.is_none());
    Ok(())
}

#[test]
fn isolated_failure_keeps_the_ordered_accepted_prefix_without_changing_prior_shape()
-> Result<(), Error> {
    let (mut editor, main, trace) = fixture(true)?;
    let result = editor.run_after_commit(main);
    assert_eq!(
        *trace.lock().expect("trace"),
        vec![
            ("shared", "previous", 0),
            ("shared", "main", 2),
            ("shared", "existing", 0),
            ("conditional", "previous", 0),
            ("conditional", "main", 2),
            ("conditional", "existing", 0),
            ("isolated", "previous", 0),
            ("isolated", "main", 2),
        ]
    );
    assert_eq!(
        result
            .chain()
            .filter(|entry| !entry.is_noop())
            .map(label)
            .collect::<Vec<_>>(),
        vec!["previous", "main", "existing", "shared", "conditional"]
    );
    assert_eq!(
        result.follow_up_error.as_ref().map(|error| error.plugin),
        Some("round-observer")
    );
    Ok(())
}
