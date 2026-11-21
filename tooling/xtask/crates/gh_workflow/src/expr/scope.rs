//! Which contexts GitHub offers to an expression at each workflow key, from
//! GitHub's context availability table
//! (<https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability>).
//! A key not listed here takes no expressions at all.

/// Where an expression sits: the contexts it may read, and whether the whole
/// value is an expression even without `${{ }}` (`if:`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scope {
    pub contexts: &'static [&'static str],
    pub whole_expression: bool,
}

const WORKFLOW: &[&str] = &["github", "inputs", "vars"];
const WORKFLOW_ENV: &[&str] = &["github", "secrets", "inputs", "vars"];
const CALL_OUTPUT: &[&str] = &["github", "jobs", "vars", "inputs"];
const JOB_IF: &[&str] = &["github", "needs", "vars", "inputs"];
const STRATEGY: &[&str] = &["github", "needs", "vars", "inputs"];
const JOB: &[&str] = &["github", "needs", "strategy", "matrix", "vars", "inputs"];
const JOB_SECRETS: &[&str] = &[
    "github", "needs", "strategy", "matrix", "secrets", "inputs", "vars",
];
const JOB_DEFAULTS: &[&str] = &[
    "github", "needs", "strategy", "matrix", "env", "vars", "inputs",
];
const CREDENTIALS: &[&str] = &[
    "github", "needs", "strategy", "matrix", "env", "vars", "secrets", "inputs",
];
const CONTAINER_ENV: &[&str] = &[
    "github", "needs", "strategy", "matrix", "job", "runner", "env", "vars", "secrets", "inputs",
];
const ENVIRONMENT_URL: &[&str] = &[
    "github", "needs", "strategy", "matrix", "job", "runner", "env", "vars", "steps", "inputs",
];
const STEP_IF: &[&str] = &[
    "github", "needs", "strategy", "matrix", "job", "runner", "env", "vars", "steps", "inputs",
];
const STEP: &[&str] = &[
    "github", "needs", "strategy", "matrix", "job", "runner", "env", "vars", "secrets", "steps",
    "inputs",
];

/// `(pattern, contexts, whole_expression)`; the first match wins. In a
/// pattern `*` is any one key, `[]` any sequence item, and a trailing `**`
/// any remaining path.
const TABLE: &[(&[&str], &[&str], bool)] = &[
    (&["run-name"], WORKFLOW, false),
    (&["concurrency", "**"], WORKFLOW, false),
    (&["env", "*"], WORKFLOW_ENV, false),
    (&["defaults", "run", "*"], WORKFLOW, false),
    (
        &["on", "workflow_call", "inputs", "*", "default"],
        WORKFLOW,
        false,
    ),
    (
        &["on", "workflow_call", "outputs", "*", "value"],
        CALL_OUTPUT,
        false,
    ),
    (&["jobs", "*", "if"], JOB_IF, true),
    (&["jobs", "*", "name"], JOB, false),
    (&["jobs", "*", "runs-on", "**"], JOB, false),
    (&["jobs", "*", "env", "*"], JOB_SECRETS, false),
    (&["jobs", "*", "environment", "url"], ENVIRONMENT_URL, false),
    (&["jobs", "*", "environment", "**"], JOB, false),
    (&["jobs", "*", "concurrency", "**"], JOB, false),
    (&["jobs", "*", "outputs", "*"], STEP, false),
    (&["jobs", "*", "timeout-minutes"], JOB, false),
    (&["jobs", "*", "continue-on-error"], JOB, false),
    (&["jobs", "*", "strategy", "**"], STRATEGY, false),
    (
        &["jobs", "*", "container", "credentials", "*"],
        CREDENTIALS,
        false,
    ),
    (
        &["jobs", "*", "container", "env", "*"],
        CONTAINER_ENV,
        false,
    ),
    (&["jobs", "*", "container", "**"], JOB, false),
    (
        &["jobs", "*", "services", "*", "credentials", "*"],
        CREDENTIALS,
        false,
    ),
    (
        &["jobs", "*", "services", "*", "env", "*"],
        CONTAINER_ENV,
        false,
    ),
    (&["jobs", "*", "services", "**"], JOB, false),
    (&["jobs", "*", "defaults", "run", "*"], JOB_DEFAULTS, false),
    (&["jobs", "*", "with", "*"], JOB, false),
    (&["jobs", "*", "secrets", "*"], JOB_SECRETS, false),
    (&["jobs", "*", "steps", "[]", "if"], STEP_IF, true),
    (&["jobs", "*", "steps", "[]", "name"], STEP, false),
    (&["jobs", "*", "steps", "[]", "run"], STEP, false),
    (&["jobs", "*", "steps", "[]", "shell"], STEP, false),
    (
        &["jobs", "*", "steps", "[]", "working-directory"],
        STEP,
        false,
    ),
    (
        &["jobs", "*", "steps", "[]", "timeout-minutes"],
        STEP,
        false,
    ),
    (
        &["jobs", "*", "steps", "[]", "continue-on-error"],
        STEP,
        false,
    ),
    (&["jobs", "*", "steps", "[]", "env", "*"], STEP, false),
    (&["jobs", "*", "steps", "[]", "with", "*"], STEP, false),
];

/// The scope of the value at `path` (mapping keys, with `[]` for sequence
/// items), or `None` where GitHub evaluates no expressions.
pub fn at(path: &[&str]) -> Option<Scope> {
    TABLE
        .iter()
        .find(|(pattern, _, _)| matches(pattern, path))
        .map(|(_, contexts, whole_expression)| Scope {
            contexts,
            whole_expression: *whole_expression,
        })
}

fn matches(pattern: &[&str], path: &[&str]) -> bool {
    match (pattern.split_first(), path.split_first()) {
        (Some((&"**", _)), _) => true,
        (None, None) => true,
        (Some((expected, pattern)), Some((actual, path))) => {
            let key_matches = match *expected {
                "*" => *actual != "[]",
                expected => expected == *actual,
            };
            key_matches && matches(pattern, path)
        }
        _ => false,
    }
}

const ACTION_STEP: &[&str] = &[
    "github", "inputs", "steps", "runner", "env", "job", "strategy", "matrix",
];
const ACTION_OUTPUT: &[&str] = &["github", "inputs", "steps"];

/// The composite action (`action.yml`) counterpart of [`TABLE`].
const ACTION_TABLE: &[(&[&str], &[&str], bool)] = &[
    (&["inputs", "*", "default"], &["github"], false),
    (&["outputs", "*", "value"], ACTION_OUTPUT, false),
    (&["runs", "steps", "[]", "if"], ACTION_STEP, true),
    (&["runs", "steps", "[]", "name"], ACTION_STEP, false),
    (&["runs", "steps", "[]", "run"], ACTION_STEP, false),
    (&["runs", "steps", "[]", "shell"], ACTION_STEP, false),
    (
        &["runs", "steps", "[]", "working-directory"],
        ACTION_STEP,
        false,
    ),
    (
        &["runs", "steps", "[]", "continue-on-error"],
        ACTION_STEP,
        false,
    ),
    (&["runs", "steps", "[]", "env", "*"], ACTION_STEP, false),
    (&["runs", "steps", "[]", "with", "*"], ACTION_STEP, false),
];

/// [`at`] for a composite action.
pub fn at_action(path: &[&str]) -> Option<Scope> {
    ACTION_TABLE
        .iter()
        .find(|(pattern, _, _)| matches(pattern, path))
        .map(|(_, contexts, whole_expression)| Scope {
            contexts,
            whole_expression: *whole_expression,
        })
}
