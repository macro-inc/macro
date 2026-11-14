//! `queue` rows: one per message type per consumed queue, and the check that
//! every queue the worker binary consumes is configured.

use std::collections::{BTreeMap, BTreeSet};

use rootcause::prelude::*;
use syn::spanned::Spanned;
use syn::visit::Visit;
use syn::{Expr, ExprCall, Local, Pat};

use super::{Entry, wire};
use crate::repo::{Loc, Repo};
use crate::sources::{QueueSource, QueueWorkers};

/// The crate whose types name the queues.
const QUEUE_TYPES_CRATE: &str = "macro_queues";

/// The type the worker binary builds once per queue it consumes.
const WORKER_TYPE: &str = "SQSWorker";

/// Lists the message types of the configured queues.
pub(crate) fn list(
    repo: &Repo,
    workers: &QueueWorkers,
    queues: &[QueueSource],
) -> Result<Vec<Entry>, Report> {
    check_consumed_queues(repo, workers, queues)?;

    let mut entries = Vec::new();
    for queue in queues {
        let at = match (&queue.envelope, &queue.at) {
            (Some(envelope), None) => wire::envelope_pointer(repo, envelope, &queue.message.ident)?,
            (None, Some(at)) => at.clone(),
            _ => bail!(
                "[[queue]] name = \"{}\" needs exactly one of `envelope` and `at`",
                queue.name
            ),
        };

        for message in wire::messages(repo, &queue.message, &at)? {
            entries.push(Entry {
                key: format!("{}:{}", queue.name, message.ident),
                matcher: message.matcher,
                loc: message.loc,
            });
        }
    }
    Ok(entries)
}

/// Fails unless the queue types the worker binary hands to an `SQSWorker`
/// are exactly the ones the `[[queue]]` entries say they cover.
fn check_consumed_queues(
    repo: &Repo,
    workers: &QueueWorkers,
    queues: &[QueueSource],
) -> Result<(), Report> {
    let file = repo.parse(&workers.file)?;
    let mut consumed = ConsumedQueues::default();
    consumed.visit_file(&file);
    if let Some((variable, span)) = &consumed.ambiguous {
        bail!(
            "{}: `{variable}` names two different queues in this file; give each its own name",
            Loc::new(&workers.file, *span)
        );
    }

    let configured: BTreeSet<&str> = queues
        .iter()
        .flat_map(|queue| &queue.consumes)
        .map(String::as_str)
        .collect();

    for (variable, span) in &consumed.worker_queues {
        let loc = Loc::new(&workers.file, *span);
        let Some(queue_type) = consumed.queue_types.get(variable) else {
            bail!(
                "{loc}: a worker consumes `{variable}`, which is not bound to a \
                 `{QUEUE_TYPES_CRATE}` queue type in this file"
            );
        };
        if !configured.contains(queue_type.as_str()) {
            bail!(
                "{loc}: a worker consumes `{queue_type}`, which no [[queue]] entry lists under \
                 `consumes`; add its message types to sources.toml"
            );
        }
    }

    let consumed_types: BTreeSet<&str> = consumed
        .worker_queues
        .iter()
        .filter_map(|(variable, _)| consumed.queue_types.get(variable))
        .map(String::as_str)
        .collect();
    for queue_type in configured {
        if !consumed_types.contains(queue_type) {
            bail!(
                "a [[queue]] entry lists `{queue_type}` under `consumes`, but {} starts no \
                 worker for it",
                workers.file
            );
        }
    }
    Ok(())
}

#[derive(Default)]
struct ConsumedQueues {
    /// Variable → queue type, from `let x = macro_queues::XQueue::new();`.
    queue_types: BTreeMap<String, String>,
    /// The variable each `SQSWorker::new(client, x.to_string(), ..)` reads
    /// its queue from.
    worker_queues: Vec<(String, proc_macro2::Span)>,
    /// The first variable name bound to two different queue types.
    ambiguous: Option<(String, proc_macro2::Span)>,
}

impl<'ast> Visit<'ast> for ConsumedQueues {
    fn visit_local(&mut self, local: &'ast Local) {
        if let Pat::Ident(variable) = &local.pat
            && let Some(init) = &local.init
            && let Expr::Call(call) = &*init.expr
            && let [crate_name, queue_type, constructor] = call_path(call).as_slice()
            && crate_name == QUEUE_TYPES_CRATE
            && constructor == "new"
        {
            let name = variable.ident.to_string();
            // Variables are looked up by name across the file: one name
            // for two queues would give both workers the second.
            if let Some(earlier) = self.queue_types.insert(name.clone(), queue_type.clone())
                && earlier != *queue_type
            {
                self.ambiguous.get_or_insert((name, variable.ident.span()));
            }
        }
        syn::visit::visit_local(self, local);
    }

    fn visit_expr_call(&mut self, call: &'ast ExprCall) {
        if let [.., worker, constructor] = call_path(call).as_slice()
            && worker == WORKER_TYPE
            && constructor == "new"
        {
            // The queue is the second argument, written `x.to_string()`.
            let variable = call.args.iter().nth(1).and_then(|queue| match queue {
                Expr::MethodCall(method) => match &*method.receiver {
                    Expr::Path(path) => path.path.get_ident().map(ToString::to_string),
                    _ => None,
                },
                _ => None,
            });
            // An unreadable queue argument is kept under an empty name, so it
            // fails the check instead of being skipped.
            self.worker_queues
                .push((variable.unwrap_or_default(), call.span()));
        }
        syn::visit::visit_expr_call(self, call);
    }
}

fn call_path(call: &ExprCall) -> Vec<String> {
    match &*call.func {
        Expr::Path(path) => path
            .path
            .segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect(),
        _ => Vec::new(),
    }
}
