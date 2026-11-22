//! Reads their caller gave up on (`--abandon-reads`). A native read sent with
//! a request id that the webview abandons before the read gets the engine
//! fails without reading (a side built against such a host gets
//! `cfg(abandon_reads)`). Which ops are abandoned, and how, follows from the
//! case alone, so both sides record the same lines: an abandoned op as
//! `abandoned` with no value (the side without abandons ran it, the other
//! must not have), every other read as it answered.
//!
//! A read of an operation registers what it depends on; an abandoned one
//! registers the operation against every change instead, until a read of it
//! registers again. While an operation is in that state ([`Exec::broad`]),
//! it is taken out of every `affectedOps` before the line is compared, and
//! where it was is written to `<seed>.broad`: what a side without abandons
//! reported there, the other must report too (`fuzz.sh` checks).

use super::{Exec, Outcome};
use crate::host::engine::EngineHandle;
use serde_json::{Map, Value, json};

/// How an op runs with a request id.
#[derive(Clone, Copy)]
pub(super) enum Plan {
    /// Abandoned while the engine is held, so it is queued: it must fail.
    Held,
    /// Abandoned while held, with a second read of the same op sent with the
    /// same id while it runs: an id already running is not registered again,
    /// so the second read is never abandoned and answers as it would have.
    Dup,
    /// Sent with an id and never abandoned; abandoned after it answers,
    /// which must reach nothing.
    Tagged,
    /// Held while another id is abandoned, which must not reach it.
    WrongId,
}

impl Plan {
    /// Whether the op's own answer is masked.
    pub(super) fn masks(self) -> bool {
        matches!(self, Plan::Held | Plan::Dup)
    }
}

/// What abandoned reads fail with (the host's `abandon::ABANDONED`).
#[cfg(abandon_reads)]
const ABANDONED: &str = crate::host::engine::fuzz_hooks::FUZZ_ABANDONED;

impl Exec<'_> {
    /// The plan for the read at `index`, if it runs with a request id. Only
    /// a read op can be sent twice (`Dup`) or held across threads.
    pub(super) fn abandon_plan(&self, index: usize, read_op: bool) -> Option<Plan> {
        if self.abandon_reads <= 0.0 {
            return None;
        }
        let roll = crate::rng::mix(index as u64, &format!("abandon {}", self.generated.viewer));
        if ((roll % 1_000) as f64) >= self.abandon_reads * 1_000.0 {
            return None;
        }
        Some(match ((roll / 1_000) % 4, read_op) {
            (0, _) => Plan::Held,
            (1, true) => Plan::Dup,
            (1, false) | (2, _) => Plan::Tagged,
            _ => Plan::WrongId,
        })
    }

    /// Runs a read op under `plan` and records it: the op's own answer as
    /// `abandoned` when the plan masks it, and a `Dup`'s second read as `read`.
    pub(super) async fn abandon_read_op(
        &mut self,
        index: usize,
        plan: Plan,
        doc: &str,
        variables: &Map<String, Value>,
        register: Option<&String>,
    ) -> Result<(), String> {
        self.count(match plan {
            Plan::Held => "abandon.held",
            Plan::Dup => "abandon.dup",
            Plan::Tagged => "abandon.tagged",
            Plan::WrongId => "abandon.wrong-id",
        });
        let query = self.doc(doc)?;
        let read = ReadOp {
            query,
            doc: doc.to_owned(),
            variables: variables.clone(),
            register: register.cloned(),
        };
        let (first, second) = self.run_planned(index, plan, read).await?;
        let registered = |outcome: &Outcome| {
            outcome
                .as_ref()
                .is_ok_and(|value| value.get("error").is_none())
        };
        if plan.masks() {
            self.record(index, "abandoned", Ok(json!("abandoned")));
        } else {
            self.read_registered(register, registered(&first));
            self.record(index, "read", first);
        }
        if let Some(second) = second {
            // Over-masks when the second read registered before the abandoned
            // one gave up: the order the two reach the engine in is a race.
            self.record(index, "read", second);
        }
        if let (true, Some(op)) = (plan.masks(), register) {
            self.broad.insert(op.clone());
        }
        Ok(())
    }

    /// A read of `register` that answered registers it again.
    pub(super) fn read_registered(&mut self, register: Option<&String>, registered: bool) {
        if let (true, Some(op)) = (registered, register) {
            self.broad.remove(op);
        }
    }

    /// Remembers the query an op registered `register` with, so a later read
    /// of that operation can be sent and abandoned (see `inject_abandoned`).
    pub(super) fn note_registration(
        &mut self,
        register: Option<&String>,
        doc: &str,
        variables: &Map<String, Value>,
    ) {
        if let (true, Some(op)) = (self.abandon_reads > 0.0, register) {
            self.registered
                .insert(op.clone(), (doc.to_owned(), variables.clone()));
        }
    }

    /// Before a write or hydrate, at the abandon share, a read of an
    /// operation the case registered is sent and abandoned while queued, as
    /// urql re-reading an operation the webview then stops waiting for. Case
    /// reads of registered operations are rare; these put an operation in its
    /// broad state just before a change is reported.
    pub(super) async fn inject_abandoned(&mut self, index: usize) -> Result<(), String> {
        if self.abandon_reads <= 0.0 || self.registered.is_empty() {
            return Ok(());
        }
        let roll = crate::rng::mix(
            index as u64,
            &format!("abandon inject {}", self.generated.viewer),
        );
        if ((roll % 1_000) as f64) >= self.abandon_reads * 1_000.0 {
            return Ok(());
        }
        let pick = (roll / 1_000) as usize % self.registered.len();
        let Some((op, (doc, variables))) = self
            .registered
            .iter()
            .nth(pick)
            .map(|(op, read)| (op.clone(), read.clone()))
        else {
            return Ok(());
        };
        self.count("abandon.injected");
        self.abandon_read_op(index, Plan::Held, &doc, &variables, Some(&op))
            .await
    }

    #[cfg(abandon_reads)]
    async fn run_planned(
        &mut self,
        index: usize,
        plan: Plan,
        read: ReadOp,
    ) -> Result<(Outcome, Option<Outcome>), String> {
        let id = format!("fuzz-read-{index}");
        let handle = self.handle().clone();
        if let Plan::Tagged = plan {
            let first = read.run(handle.clone().abandonable(Some(id.clone()))).await;
            if handle.abandon(&id) {
                return Err(format!(
                    "op {index}: abandoning a read that answered reached a read"
                ));
            }
            return Ok((first, None));
        }
        let (first, second, reached) = handle
            .fuzz_while_held(async {
                let first = tokio::spawn(
                    read.clone()
                        .run(handle.clone().abandonable(Some(id.clone()))),
                );
                // Registered before the first read's command ends, so not at all.
                let second = matches!(plan, Plan::Dup).then(|| {
                    tokio::spawn(
                        read.clone()
                            .run(handle.clone().abandonable(Some(id.clone()))),
                    )
                });
                // Let both queue on the held engine before the abandon.
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
                let reached = match plan {
                    Plan::WrongId => handle.abandon(&format!("{id}-other")),
                    _ => handle.abandon(&id),
                };
                (first, second, reached)
            })
            .await;
        let first = first.await.map_err(|error| error.to_string())?;
        let second = match second {
            Some(second) => Some(second.await.map_err(|error| error.to_string())?),
            None => None,
        };
        if reached != plan.masks() {
            return Err(format!(
                "op {index}: an abandon reached a running read: {reached}"
            ));
        }
        if plan.masks() {
            match &first {
                Err(error) if error == ABANDONED => self.count("abandon.abandoned"),
                _ => {
                    return Err(format!(
                        "op {index}: a read abandoned while queued answered: {}",
                        normalize_outcome(&first)
                    ));
                }
            }
        }
        if let Some(Err(error)) = &second
            && error == ABANDONED
        {
            return Err(format!(
                "op {index}: an abandon reached a second read sent with the same id"
            ));
        }
        Ok((first, second))
    }

    /// The side without abandons runs every read as it is.
    #[cfg(not(abandon_reads))]
    async fn run_planned(
        &mut self,
        _index: usize,
        plan: Plan,
        read: ReadOp,
    ) -> Result<(Outcome, Option<Outcome>), String> {
        let handle = self.handle().clone();
        let first = read.clone().run(handle.clone()).await;
        let second = match plan {
            Plan::Dup => Some(read.run(handle).await),
            _ => None,
        };
        Ok((first, second))
    }

    /// The handle a filter, search or keyed read runs with under `plan`
    /// (`Held` abandons it before it runs: the op is not spawned), and the id
    /// to abandon after it answers.
    pub(super) fn plan_reader(
        &mut self,
        index: usize,
        plan: Plan,
    ) -> Result<Option<String>, String> {
        self.count(match plan {
            Plan::Held | Plan::Dup => "abandon.before",
            Plan::Tagged => "abandon.tagged",
            Plan::WrongId => "abandon.wrong-id",
        });
        #[cfg(abandon_reads)]
        {
            let id = format!("fuzz-read-{index}");
            let reader = self.handle().clone().abandonable(Some(id.clone()));
            let reached = match plan {
                Plan::WrongId => reader.abandon(&format!("{id}-other")),
                Plan::Held | Plan::Dup => reader.abandon(&id),
                Plan::Tagged => false,
            };
            if reached != plan.masks() {
                return Err(format!(
                    "op {index}: an abandon reached a running read: {reached}"
                ));
            }
            self.reader = Some(reader);
            Ok(Some(id))
        }
        #[cfg(not(abandon_reads))]
        {
            let _ = (index, plan);
            Ok(None)
        }
    }

    /// Ends a planned filter, search or keyed read: drops its handle, checks
    /// an abandon after it answered reaches nothing, and an abandoned one
    /// failed. Returns what to record.
    pub(super) fn end_planned(
        &mut self,
        index: usize,
        plan: Plan,
        id: Option<String>,
        outcome: Outcome,
    ) -> Result<Outcome, String> {
        self.reader = None;
        #[cfg(abandon_reads)]
        if let Some(id) = id {
            if self.handle().abandon(&id) {
                return Err(format!(
                    "op {index}: abandoning a read that answered reached a read"
                ));
            }
            if plan.masks() {
                let abandoned = |value: &Value| value.to_string().contains(ABANDONED);
                match &outcome {
                    Err(error) if error == ABANDONED => self.count("abandon.abandoned"),
                    Ok(value) if abandoned(value) => self.count("abandon.abandoned"),
                    _ => {
                        return Err(format!(
                            "op {index}: a read abandoned before it ran answered: {}",
                            normalize_outcome(&outcome)
                        ));
                    }
                }
            }
        }
        #[cfg(not(abandon_reads))]
        let _ = (index, id);
        Ok(match plan.masks() {
            true => Ok(json!("abandoned")),
            false => outcome,
        })
    }

    /// The handle reads run with: a planned op's while it runs.
    pub(super) fn reader(&self) -> &EngineHandle {
        self.reader.as_ref().unwrap_or_else(|| self.handle())
    }

    /// Takes operations registered broadly out of every `affectedOps` in
    /// `value`, noting where they were.
    pub(super) fn mask_broad(&mut self, index: usize, value: &mut Value) {
        if self.broad.is_empty() {
            return;
        }
        match value {
            Value::Object(object) => {
                for (key, inner) in object.iter_mut() {
                    match (key.as_str(), inner) {
                        ("affectedOps", Value::Array(ops)) => ops.retain(|op| {
                            let broad = op.as_str().is_some_and(|op| self.broad.contains(op));
                            if broad {
                                self.broad_hits
                                    .push(format!("{index} {}", op.as_str().unwrap_or_default()));
                            }
                            !broad
                        }),
                        (_, inner) => self.mask_broad(index, inner),
                    }
                }
            }
            Value::Array(items) => items
                .iter_mut()
                .for_each(|item| self.mask_broad(index, item)),
            _ => {}
        }
    }
}

/// A read op as a thread other than the sequence's sends it.
#[derive(Clone)]
struct ReadOp {
    query: String,
    doc: String,
    variables: Map<String, Value>,
    register: Option<String>,
}

impl ReadOp {
    async fn run(self, handle: EngineHandle) -> Outcome {
        let result = handle
            .read(
                self.register,
                self.query,
                Some(self.doc),
                self.variables,
                vec![],
            )
            .await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }
}

#[cfg(abandon_reads)]
fn normalize_outcome(outcome: &Outcome) -> String {
    match outcome {
        Ok(value) => value.to_string().chars().take(300).collect(),
        Err(error) => error.clone(),
    }
}
