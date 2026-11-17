//! Check the references between jobs and steps of a rendered workflow, so a
//! wrong id fails `cargo x workflows` instead of evaluating to an empty
//! string on GitHub:
//!
//! - every `needs:` entry is another job of the workflow, with no cycles;
//! - a job reads `needs.<id>` only for a job it lists in `needs:`, and
//!   `needs.<id>.outputs.<name>` only for an output that job declares;
//! - a step reads `steps.<id>` only for an earlier step of its job, and a
//!   job's `outputs:` only for a step of that job; step ids are unique;
//! - a `workflow_call` output reads `jobs.<id>.outputs.<name>` only for a
//!   job and output that exist.

use std::collections::{BTreeMap, BTreeSet};

use crate::error::{Error, Result};
use crate::expr::{self, Ast, TemplatePart};
use crate::yaml::Node;

/// What another job may read from a job.
struct JobFacts<'a> {
    needs: Vec<&'a str>,
    /// `None` for a reusable-workflow call: its outputs are the called
    /// workflow's, which this file doesn't declare.
    outputs: Option<BTreeSet<&'a str>>,
}

pub(crate) fn check(workflow: &Node) -> Result<()> {
    let Some(jobs) = workflow.get("jobs").and_then(Node::as_map) else {
        return Ok(());
    };

    let facts: BTreeMap<&str, JobFacts> = jobs
        .iter()
        .map(|(id, job)| (id.as_str(), job_facts(job)))
        .collect();

    for (id, job) in jobs {
        let fact = &facts[id.as_str()];
        for needed in &fact.needs {
            if !facts.contains_key(needed) || needed == id {
                return Err(invalid(
                    &format!("jobs.{id}.needs"),
                    format!("`{needed}` is not another job of this workflow"),
                ));
            }
        }
        check_job(id, job, fact, &facts)?;
    }

    check_cycles(&facts)?;

    if let Some(outputs) = workflow
        .get("on")
        .and_then(|on| on.get("workflow_call"))
        .and_then(|call| call.get("outputs"))
        .and_then(Node::as_map)
    {
        for (name, output) in outputs {
            let at = format!("on.workflow_call.outputs.{name}.value");
            for reference in references_in(output.get("value"), false, &at)? {
                let reference: Vec<&str> = reference.iter().map(String::as_str).collect();
                if let ["jobs", job, "outputs", output_name, ..] = reference.as_slice() {
                    check_output(&at, job, output_name, &facts)?;
                }
            }
        }
    }
    Ok(())
}

fn job_facts(job: &Node) -> JobFacts<'_> {
    let needs = match job.get("needs") {
        Some(Node::Str(single)) => vec![single.as_str()],
        Some(Node::Seq(items)) => items.iter().filter_map(Node::as_str).collect(),
        _ => Vec::new(),
    };
    let outputs = if job.get("uses").is_some() {
        None
    } else {
        Some(
            job.get("outputs")
                .and_then(Node::as_map)
                .map(|outputs| outputs.iter().map(|(name, _)| name.as_str()).collect())
                .unwrap_or_default(),
        )
    };
    JobFacts { needs, outputs }
}

fn check_job(
    id: &str,
    job: &Node,
    fact: &JobFacts,
    facts: &BTreeMap<&str, JobFacts>,
) -> Result<()> {
    let Some(entries) = job.as_map() else {
        return Ok(());
    };

    let step_ids: Vec<&str> = job
        .get("steps")
        .and_then(Node::as_seq)
        .map(|steps| {
            steps
                .iter()
                .filter_map(|step| step.get("id").and_then(Node::as_str))
                .collect()
        })
        .unwrap_or_default();
    let mut seen = BTreeSet::new();
    for step_id in &step_ids {
        if !seen.insert(*step_id) {
            return Err(invalid(
                &format!("jobs.{id}.steps"),
                format!("two steps have the id `{step_id}`"),
            ));
        }
    }

    for (key, value) in entries {
        let at = format!("jobs.{id}.{key}");
        if key == "steps" {
            let Some(steps) = value.as_seq() else {
                continue;
            };
            let mut earlier: BTreeSet<&str> = BTreeSet::new();
            for (index, step) in steps.iter().enumerate() {
                let step_at = format!("{at}[{index}]");
                for reference in strings_references(step, false, &step_at)? {
                    let reference: Vec<&str> = reference.iter().map(String::as_str).collect();
                    check_reference(&step_at, &reference, fact, facts, Some(&earlier))?;
                }
                if let Some(step_id) = step.get("id").and_then(Node::as_str) {
                    earlier.insert(step_id);
                }
            }
            continue;
        }

        let all_steps: BTreeSet<&str> = step_ids.iter().copied().collect();
        let steps_in_scope = (key == "outputs").then_some(&all_steps);
        for reference in strings_references(value, key == "if", &at)? {
            let reference: Vec<&str> = reference.iter().map(String::as_str).collect();
            check_reference(&at, &reference, fact, facts, steps_in_scope)?;
        }
    }
    Ok(())
}

/// `steps` is the step ids `reference` may name, or `None` where `steps.*`
/// isn't readable (the expression checks already reject it there).
fn check_reference(
    at: &str,
    reference: &[&str],
    fact: &JobFacts,
    facts: &BTreeMap<&str, JobFacts>,
    steps: Option<&BTreeSet<&str>>,
) -> Result<()> {
    match reference {
        ["needs", "*", ..] => Ok(()),
        ["needs", job, rest @ ..] => {
            if !fact.needs.contains(job) {
                return Err(invalid(
                    at,
                    format!("reads `needs.{job}` but the job does not list `{job}` in `needs`"),
                ));
            }
            match rest {
                ["outputs", name, ..] => check_output(at, job, name, facts),
                _ => Ok(()),
            }
        }
        ["steps", step, ..] => match steps {
            Some(steps) if !steps.contains(step) => Err(invalid(
                at,
                format!("reads `steps.{step}`, which is not an earlier step of this job"),
            )),
            _ => Ok(()),
        },
        _ => Ok(()),
    }
}

fn check_output(at: &str, job: &str, name: &str, facts: &BTreeMap<&str, JobFacts>) -> Result<()> {
    let Some(fact) = facts.get(job) else {
        return Err(invalid(
            at,
            format!("`{job}` is not a job of this workflow"),
        ));
    };
    match &fact.outputs {
        Some(outputs) if !outputs.contains(name) => {
            Err(invalid(at, format!("job `{job}` has no output `{name}`")))
        }
        _ => Ok(()),
    }
}

fn check_cycles(facts: &BTreeMap<&str, JobFacts>) -> Result<()> {
    // Depth-first search; a job met again while still on the stack closes a
    // cycle.
    fn visit<'a>(
        job: &'a str,
        facts: &BTreeMap<&'a str, JobFacts<'a>>,
        on_stack: &mut Vec<&'a str>,
        done: &mut BTreeSet<&'a str>,
    ) -> Result<()> {
        if done.contains(job) {
            return Ok(());
        }
        if let Some(start) = on_stack.iter().position(|seen| *seen == job) {
            let mut cycle = on_stack[start..].to_vec();
            cycle.push(job);
            return Err(invalid(
                "jobs",
                format!("needs form a cycle: {}", cycle.join(" -> ")),
            ));
        }
        on_stack.push(job);
        for needed in &facts[job].needs {
            visit(needed, facts, on_stack, done)?;
        }
        on_stack.pop();
        done.insert(job);
        Ok(())
    }

    let mut done = BTreeSet::new();
    for job in facts.keys() {
        visit(job, facts, &mut Vec::new(), &mut done)?;
    }
    Ok(())
}

/// Check a composite action: every `run` step names its `shell` (GitHub
/// requires it there), step ids are unique, a step reads only earlier step
/// ids, and an output reads only the action's step ids.
pub(crate) fn check_action(action: &Node) -> Result<()> {
    let steps = action
        .get("runs")
        .and_then(|runs| runs.get("steps"))
        .and_then(Node::as_seq)
        .unwrap_or_default();

    let mut earlier: BTreeSet<&str> = BTreeSet::new();
    for (index, step) in steps.iter().enumerate() {
        let at = format!("runs.steps[{index}]");
        if step.get("run").is_some() && step.get("shell").is_none() {
            return Err(invalid(
                &at,
                "a composite action's `run` step must set `shell`".to_string(),
            ));
        }
        for reference in strings_references(step, false, &at)? {
            if let [root, step_id, ..] = reference.as_slice() {
                if root == "steps" && !earlier.contains(step_id.as_str()) {
                    return Err(invalid(
                        &at,
                        format!(
                            "reads `steps.{step_id}`, which is not an earlier step of this action"
                        ),
                    ));
                }
            }
        }
        if let Some(step_id) = step.get("id").and_then(Node::as_str) {
            if !earlier.insert(step_id) {
                return Err(invalid(&at, format!("two steps have the id `{step_id}`")));
            }
        }
    }

    if let Some(outputs) = action.get("outputs").and_then(Node::as_map) {
        for (name, output) in outputs {
            let at = format!("outputs.{name}.value");
            for reference in references_in(output.get("value"), false, &at)? {
                if let [root, step_id, ..] = reference.as_slice() {
                    if root == "steps" && !earlier.contains(step_id.as_str()) {
                        return Err(invalid(
                            &at,
                            format!("`{step_id}` is not a step of this action"),
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

/// The context paths (`needs.build.outputs.sha` as `["needs", "build",
/// "outputs", "sha"]`) read anywhere under `node`.
fn strings_references(node: &Node, is_if: bool, at: &str) -> Result<Vec<Vec<String>>> {
    let mut found = Vec::new();
    collect_strings(node, is_if, at, &mut found)?;
    Ok(found)
}

fn collect_strings(node: &Node, is_if: bool, at: &str, found: &mut Vec<Vec<String>>) -> Result<()> {
    match node {
        Node::Str(_) => found.extend(references_in(Some(node), is_if, at)?),
        Node::Seq(items) => {
            for item in items {
                collect_strings(item, false, at, found)?;
            }
        }
        Node::Map(entries) => {
            for (key, value) in entries {
                collect_strings(value, key == "if", at, found)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn references_in(node: Option<&Node>, is_if: bool, at: &str) -> Result<Vec<Vec<String>>> {
    let Some(Node::Str(text)) = node else {
        return Ok(Vec::new());
    };
    let to_error = |message: String| invalid(at, message);

    let asts: Vec<Ast> = if is_if && !text.contains("${{") {
        vec![expr::parse(text).map_err(to_error)?]
    } else {
        expr::parse_template(text)
            .map_err(to_error)?
            .into_iter()
            .filter_map(|part| match part {
                TemplatePart::Expression(ast) => Some(ast),
                TemplatePart::Text(_) => None,
            })
            .collect()
    };

    let mut paths = Vec::new();
    for ast in &asts {
        collect_paths(ast, &mut paths);
    }
    Ok(paths)
}

fn collect_paths(ast: &Ast, paths: &mut Vec<Vec<String>>) {
    if let Some(path) = context_path(ast) {
        paths.push(path);
        return;
    }
    match ast {
        Ast::Property(object, _) | Ast::Star(object) | Ast::Not(object) | Ast::Group(object) => {
            collect_paths(object, paths);
        }
        Ast::Index(object, index) => {
            collect_paths(object, paths);
            collect_paths(index, paths);
        }
        Ast::Binary(_, left, right) => {
            collect_paths(left, paths);
            collect_paths(right, paths);
        }
        Ast::Call(_, args) => args.iter().for_each(|arg| collect_paths(arg, paths)),
        Ast::Null | Ast::Bool(_) | Ast::Number(_) | Ast::Str(_) | Ast::Context(_) => {}
    }
}

/// `a.b.c` (with `*` for `.*`) for a chain of property reads from a context.
/// An index ends the chain: `collect_paths` reads its object and index
/// separately.
fn context_path(ast: &Ast) -> Option<Vec<String>> {
    match ast {
        Ast::Context(root) => Some(vec![root.clone()]),
        Ast::Property(object, name) => {
            let mut path = context_path(object)?;
            path.push(name.clone());
            Some(path)
        }
        Ast::Star(object) => {
            let mut path = context_path(object)?;
            path.push("*".to_string());
            Some(path)
        }
        _ => None,
    }
}

fn invalid(at: &str, message: String) -> Error {
    Error::Reference {
        path: at.to_string(),
        message,
    }
}

#[cfg(test)]
mod test;
