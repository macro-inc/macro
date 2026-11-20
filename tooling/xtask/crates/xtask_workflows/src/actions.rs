//! Typed bindings for the third-party actions in `actions.lock`.
//!
//! `cargo x workflows actions fetch` copies each locked action's `action.yml`
//! at its pinned commit into `actions/` (the only step that needs the
//! network). `cargo x workflows` then renders `src/workflows/actions.rs` from
//! those copies: one type per action whose required inputs are constructor
//! arguments, whose other inputs are setters, and whose outputs are
//! [`StepOutput`](gh_workflow::expr::typed::StepOutput) handles. A misspelled
//! input or output then fails to compile, and `--check` keeps the bindings in
//! step with the lock.

use std::fmt::Write as _;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result, bail};
use serde_yaml::Value;

/// Lock and spec paths, relative to the repository root.
const LOCK: &str = "tooling/xtask/crates/xtask_workflows/actions.lock";
const SPECS: &str = "tooling/xtask/crates/xtask_workflows/actions";
/// The generated bindings, relative to the repository root.
pub const BINDINGS: &str = "tooling/xtask/crates/xtask_workflows/src/workflows/actions.rs";

/// One locked action.
struct Locked {
    /// `owner/repo` or `owner/repo/path`.
    action: String,
    commit: String,
    version: String,
}

impl Locked {
    fn owner_repo_path(&self) -> (&str, &str, Option<&str>) {
        let mut parts = self.action.splitn(3, '/');
        let owner = parts.next().unwrap_or_default();
        let repo = parts.next().unwrap_or_default();
        (owner, repo, parts.next())
    }

    fn spec_path(&self) -> PathBuf {
        xtask_paths::repo_root()
            .join(SPECS)
            .join(format!("{}.yml", self.action.replace('/', "__")))
    }

    /// `ActionsCheckout` for `actions/checkout`: every path segment, so two
    /// owners' `cache/save` can't collide.
    fn type_name(&self) -> String {
        self.action
            .split(['/', '-', '_', '.'])
            .map(pascal_word)
            .collect()
    }
}

fn read_lock() -> Result<Vec<Locked>> {
    let path = xtask_paths::repo_root().join(LOCK);
    let text = fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;

    let mut locked = Vec::new();
    for (number, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split_whitespace().collect();
        let [action, commit, version] = fields.as_slice() else {
            bail!("{LOCK}:{}: expected `action commit version`", number + 1);
        };
        if commit.len() != 40 || !commit.chars().all(|c| c.is_ascii_hexdigit()) {
            bail!("{LOCK}:{}: `{commit}` is not a full commit SHA", number + 1);
        }
        locked.push(Locked {
            action: action.to_string(),
            commit: commit.to_string(),
            version: version.to_string(),
        });
    }
    Ok(locked)
}

/// Copy each locked action's `action.yml` (or `action.yaml`) at its commit
/// into `actions/`.
pub fn fetch() -> Result<()> {
    for locked in read_lock()? {
        let (owner, repo, path) = locked.owner_repo_path();
        let directory = path.map(|path| format!("{path}/")).unwrap_or_default();

        let mut spec = None;
        for file in ["action.yml", "action.yaml"] {
            let output = Command::new("gh")
                .args([
                    "api",
                    "-H",
                    "Accept: application/vnd.github.raw",
                    &format!(
                        "repos/{owner}/{repo}/contents/{directory}{file}?ref={}",
                        locked.commit
                    ),
                ])
                .output()
                .context("running gh api")?;
            if output.status.success() {
                spec = Some(output.stdout);
                break;
            }
        }
        let spec = spec
            .with_context(|| format!("{} has no action.yml at {}", locked.action, locked.commit))?;

        let spec: Value = serde_yaml::from_slice(&spec)
            .with_context(|| format!("parsing {}'s action.yml", locked.action))?;
        let path = locked.spec_path();
        fs::write(&path, serde_yaml::to_string(&interface(&spec))?)
            .with_context(|| format!("writing {}", path.display()))?;
        println!("fetched {} {}", locked.action, locked.version);
    }
    Ok(())
}

/// The part of an `action.yml` the bindings read: its name, description,
/// inputs and outputs. Authors, branding and how it runs are dropped, and
/// anything shaped like an email address is redacted, since the copy is
/// checked in.
fn interface(spec: &Value) -> Value {
    let mut kept = serde_yaml::Mapping::new();
    for key in ["name", "description", "inputs", "outputs"] {
        if let Some(value) = spec.get(key) {
            kept.insert(key.into(), redact_addresses(value));
        }
    }
    Value::Mapping(kept)
}

fn redact_addresses(value: &Value) -> Value {
    match value {
        Value::String(text) => Value::String(
            text.split(' ')
                .map(|word| {
                    let looks_like_address = word
                        .split_once('@')
                        .is_some_and(|(user, host)| !user.is_empty() && host.contains('.'));
                    if looks_like_address {
                        "<address>"
                    } else {
                        word
                    }
                })
                .collect::<Vec<_>>()
                .join(" "),
        ),
        Value::Mapping(entries) => Value::Mapping(
            entries
                .iter()
                .map(|(key, value)| (key.clone(), redact_addresses(value)))
                .collect(),
        ),
        Value::Sequence(items) => Value::Sequence(items.iter().map(redact_addresses).collect()),
        other => other.clone(),
    }
}

/// The bindings source for every locked action.
pub fn render_bindings() -> Result<String> {
    let mut out = String::from(
        "// DO NOT EDIT — regenerate with `cargo x workflows` (from the repository root).\n\
         // Source: tooling/xtask/crates/xtask_workflows/actions.lock, actions/*.yml and src/workflows/composite\n\
         \n\
         //! Typed steps for the third-party actions in `actions.lock` and our\n\
         //! composite actions in `workflows/composite`, and typed calls of our\n\
         //! reusable workflows.\n\
         \n\
         use gh_workflow::expr::typed::{StepOutput, Str};\n\
         use gh_workflow::{CallJob, Input, Step, Use};\n\
         use serde_json::Value;\n",
    );

    for locked in read_lock()? {
        let path = locked.spec_path();
        let text = fs::read_to_string(&path).with_context(|| {
            format!(
                "reading {}; run `cargo x workflows actions fetch`",
                path.display()
            )
        })?;
        let spec: Value =
            serde_yaml::from_str(&text).with_context(|| format!("parsing {}", path.display()))?;

        let (owner, repo, path) = locked.owner_repo_path();
        let repo_path = match path {
            Some(path) => format!("{repo}/{path}"),
            None => repo.to_string(),
        };
        let binding = Binding {
            type_name: locked.type_name(),
            title: format!("`{}` {}", locked.action, locked.version),
            runs: format!("`{}@{}`", locked.action, locked.commit),
            uses_code: format!(".uses({owner:?}, {repo_path:?}, {:?})", locked.commit),
            finisher: STEP_FINISHERS
                .iter()
                .find(|(action, _)| *action == locked.action)
                .map(|(_, finisher)| *finisher),
        };
        render_action(&mut out, &binding, &spec)?;
    }

    for local in crate::workflows::composite::ACTIONS {
        let rendered = (local.build)().to_string().map_err(|error| {
            anyhow::anyhow!("rendering .github/actions/{}: {error}", local.directory)
        })?;
        let spec: Value = serde_yaml::from_str(&rendered)?;
        let binding = Binding {
            type_name: format!(
                "Local{}",
                local
                    .directory
                    .split(['-', '_'])
                    .map(pascal_word)
                    .collect::<String>()
            ),
            title: format!(
                "`./.github/actions/{}`, defined in `workflows/composite/{}.rs`",
                local.directory, local.module
            ),
            runs: format!("`./.github/actions/{}`", local.directory),
            uses_code: format!(".uses_local(\".github/actions/{}\")", local.directory),
            finisher: None,
        };
        render_action(&mut out, &binding, &spec)?;
    }
    for workflow in crate::workflows::WORKFLOWS {
        let rendered = (workflow.render_yaml)()?;
        let spec: Value = serde_yaml::from_str(&rendered)?;
        let Some(call) = spec.get("on").and_then(|on| on.get("workflow_call")) else {
            continue;
        };
        render_call(&mut out, workflow.slug, workflow.file_name, &spec, call)?;
    }
    Ok(out)
}

/// A `Call<Name>` type for a reusable workflow: a `CallJob` whose required
/// inputs are constructor arguments, optional inputs and secrets setters, and
/// whose outputs are `JobOutput` handles on the calling job.
fn render_call(
    out: &mut String,
    slug: &str,
    file_name: &str,
    spec: &Value,
    call: &Value,
) -> Result<()> {
    let type_name = format!(
        "Call{}",
        slug.split('_').map(pascal_word).collect::<String>()
    );
    let entries = |key: &str| -> Vec<(String, Value)> {
        call.get(key)
            .and_then(Value::as_mapping)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|(name, value)| Some((name.as_str()?.to_string(), value.clone())))
                    .collect()
            })
            .unwrap_or_default()
    };
    let inputs = entries("inputs");
    let secrets = entries("secrets");
    let outputs = entries("outputs");
    let (required, optional): (Vec<_>, Vec<_>) = inputs.iter().partition(|(_, input)| {
        input.get("required").and_then(Value::as_bool) == Some(true)
            && input.get("default").is_none()
    });

    writeln!(out)?;
    write_doc(
        out,
        "",
        &format!(
            "Calls `./.github/workflows/{file_name}` ({}), defined in `workflows/{slug}.rs`.",
            text_of(spec.get("name")).unwrap_or_default()
        ),
    )?;
    writeln!(out, "#[must_use]")?;
    writeln!(out, "pub struct {type_name}(CallJob);")?;
    writeln!(out)?;
    writeln!(out, "impl {type_name} {{")?;

    let params: String = required
        .iter()
        .map(|(name, _)| format!("{}: impl Into<Value>", rust_ident(name)))
        .collect::<Vec<_>>()
        .join(", ");
    writeln!(
        out,
        "    /// A job calling the workflow, with its required inputs set."
    )?;
    writeln!(out, "    pub fn new({params}) -> Self {{")?;
    writeln!(
        out,
        "        Self(CallJob::new(\"./.github/workflows/{file_name}\"))"
    )?;
    for (name, _) in &required {
        writeln!(out, "            .with({name:?}, {})", rust_ident(name))?;
    }
    writeln!(out, "    }}")?;

    for (name, input) in &optional {
        writeln!(out)?;
        let mut doc = text_of(input.get("description")).unwrap_or_default();
        if let Some(default) = input.get("default").and_then(scalar_text) {
            write!(doc, "\n\nDefault: `{default}`.")?;
        }
        write_doc(out, "    ", &doc)?;
        writeln!(
            out,
            "    pub fn {}(self, value: impl Into<Value>) -> Self {{",
            rust_ident(name)
        )?;
        writeln!(out, "        self.with({name:?}, value)")?;
        writeln!(out, "    }}")?;
    }

    for (name, secret) in &secrets {
        writeln!(out)?;
        write_doc(
            out,
            "    ",
            &format!(
                "Passes the secret `{name}`{}.",
                text_of(secret.get("description"))
                    .map(|description| format!(": {description}"))
                    .unwrap_or_default()
            ),
        )?;
        writeln!(
            out,
            "    pub fn secret_{}(self, value: impl ToString) -> Self {{",
            rust_ident(name).trim_start_matches("r#")
        )?;
        writeln!(out, "        Self(self.0.add_secret({name:?}, value))")?;
        writeln!(out, "    }}")?;
    }

    for (name, output) in &outputs {
        writeln!(out)?;
        write_doc(
            out,
            "    ",
            &format!(
                "Output `{name}` of the calling job with id `job`: {}",
                text_of(output.get("description")).unwrap_or_default()
            ),
        )?;
        writeln!(
            out,
            "    pub const fn {}_output(job: &'static str) -> gh_workflow::expr::typed::JobOutput<Str> {{",
            rust_ident(name).trim_start_matches("r#")
        )?;
        writeln!(
            out,
            "        gh_workflow::expr::typed::JobOutput::new(job, {name:?})"
        )?;
        writeln!(out, "    }}")?;
    }

    writeln!(out)?;
    writeln!(
        out,
        "    /// Passes every secret the caller can read (`secrets: inherit`)."
    )?;
    writeln!(out, "    pub fn inherit_secrets(self) -> Self {{")?;
    writeln!(out, "        Self(self.0.inherit_secrets())")?;
    writeln!(out, "    }}")?;
    writeln!(out)?;
    writeln!(
        out,
        "    /// The job, to set its name, `needs`, condition or permissions."
    )?;
    writeln!(out, "    pub fn job(self) -> CallJob {{")?;
    writeln!(out, "        self.0")?;
    writeln!(out, "    }}")?;
    if !inputs.is_empty() {
        writeln!(out)?;
        writeln!(
            out,
            "    fn with(self, name: &str, value: impl Into<Value>) -> Self {{"
        )?;
        writeln!(out, "        Self(self.0.add_with(name, value))")?;
        writeln!(out, "    }}")?;
    }
    writeln!(out, "}}")?;
    writeln!(out)?;
    writeln!(out, "impl From<{type_name}> for CallJob {{")?;
    writeln!(out, "    fn from(call: {type_name}) -> Self {{")?;
    writeln!(out, "        call.0")?;
    writeln!(out, "    }}")?;
    writeln!(out, "}}")?;
    Ok(())
}

/// Actions whose every step passes through a function before it reaches a
/// job: `(owner/repo, path of a fn(Step<Use>) -> Step<Use>)`. The generated
/// `step()` and `From` impl both call it, so no caller can leave it out.
const STEP_FINISHERS: &[(&str, &str)] = &[(
    "actions/checkout",
    "crate::workflows::steps::abort_stalled_fetch",
)];

/// What a generated type calls its action and how its step points at it.
struct Binding {
    type_name: String,
    /// The first line of the type's doc.
    title: String,
    /// What the step runs, for `new`'s doc.
    runs: String,
    /// The `Step` method that sets `uses:`.
    uses_code: String,
    /// The function every step of this action passes through, from
    /// [`STEP_FINISHERS`].
    finisher: Option<&'static str>,
}

fn render_action(out: &mut String, binding: &Binding, spec: &Value) -> Result<()> {
    let type_name = &binding.type_name;

    let inputs: Vec<(String, &Value)> = spec
        .get("inputs")
        .and_then(Value::as_mapping)
        .map(|inputs| {
            inputs
                .iter()
                .filter_map(|(name, input)| Some((name.as_str()?.to_string(), input)))
                .collect()
        })
        .unwrap_or_default();
    let (required, optional): (Vec<_>, Vec<_>) = inputs.iter().partition(|(_, input)| {
        input.get("required").and_then(Value::as_bool) == Some(true)
            && input.get("default").is_none()
    });

    writeln!(out)?;
    write_doc(
        out,
        "",
        &format!(
            "{}: {}",
            binding.title,
            text_of(spec.get("description")).unwrap_or_default()
        ),
    )?;
    writeln!(out, "#[must_use]")?;
    writeln!(out, "pub struct {type_name}(Step<Use>);")?;
    writeln!(out)?;
    writeln!(out, "impl {type_name} {{")?;

    let required_params: String = required
        .iter()
        .map(|(name, _)| format!(", {}: impl ToString", rust_ident(name)))
        .collect();
    write_doc(
        out,
        "    ",
        &format!(
            "A step named `name` that runs {}{}.",
            binding.runs,
            if required.is_empty() {
                String::new()
            } else {
                format!(
                    ", with its required input{} set",
                    if required.len() == 1 { "" } else { "s" }
                )
            }
        ),
    )?;
    writeln!(
        out,
        "    pub fn new(name: &str{required_params}) -> Self {{"
    )?;
    writeln!(
        out,
        "        let step = Step::new(name){};",
        binding.uses_code
    )?;
    if required.is_empty() {
        writeln!(out, "        Self(step)")?;
    } else {
        writeln!(out, "        Self(step)")?;
        for (name, _) in &required {
            writeln!(out, "            .with({name:?}, {})", rust_ident(name))?;
        }
    }
    writeln!(out, "    }}")?;

    for (name, input) in &optional {
        writeln!(out)?;
        let mut doc = text_of(input.get("description")).unwrap_or_default();
        if let Some(default) = input.get("default").and_then(scalar_text) {
            write!(doc, "\n\nDefault: `{default}`.")?;
        }
        write_doc(out, "    ", &doc)?;
        if let Some(message) = text_of(input.get("deprecationMessage")) {
            writeln!(out, "    #[deprecated = {:?}]", message.trim())?;
        }
        writeln!(
            out,
            "    pub fn {}(self, value: impl ToString) -> Self {{",
            rust_ident(name)
        )?;
        writeln!(out, "        self.with({name:?}, value)")?;
        writeln!(out, "    }}")?;
    }

    let outputs: Vec<(String, &Value)> = spec
        .get("outputs")
        .and_then(Value::as_mapping)
        .map(|outputs| {
            outputs
                .iter()
                .filter_map(|(name, output)| Some((name.as_str()?.to_string(), output)))
                .collect()
        })
        .unwrap_or_default();
    for (name, output) in &outputs {
        writeln!(out)?;
        write_doc(
            out,
            "    ",
            &format!(
                "Output `{name}` of the step with id `step`: {}",
                text_of(output.get("description")).unwrap_or_default()
            ),
        )?;
        writeln!(
            out,
            "    pub const fn {}_output(step: &'static str) -> StepOutput<Str> {{",
            rust_ident(name).trim_start_matches("r#")
        )?;
        writeln!(out, "        StepOutput::new(step, {name:?})")?;
        writeln!(out, "    }}")?;
    }

    writeln!(out)?;
    writeln!(out, "    /// The step, to set its id, condition or env.")?;
    writeln!(out, "    pub fn step(self) -> Step<Use> {{")?;
    match binding.finisher {
        Some(finisher) => writeln!(out, "        {finisher}(self.0)")?,
        None => writeln!(out, "        self.0")?,
    }
    writeln!(out, "    }}")?;
    if !inputs.is_empty() {
        writeln!(out)?;
        writeln!(
            out,
            "    fn with(self, name: &str, value: impl ToString) -> Self {{"
        )?;
        writeln!(
            out,
            "        Self(self.0.add_with(Input::default().add(name, value.to_string())))"
        )?;
        writeln!(out, "    }}")?;
    }
    writeln!(out, "}}")?;
    writeln!(out)?;
    writeln!(out, "impl From<{type_name}> for Step<Use> {{")?;
    writeln!(out, "    fn from(action: {type_name}) -> Self {{")?;
    writeln!(out, "        action.step()")?;
    writeln!(out, "    }}")?;
    writeln!(out, "}}")?;
    Ok(())
}

fn write_doc(out: &mut String, indent: &str, text: &str) -> Result<()> {
    for line in text.trim().lines() {
        let line = line.trim_end();
        if line.is_empty() {
            writeln!(out, "{indent}///")?;
        } else {
            writeln!(out, "{indent}/// {line}")?;
        }
    }
    Ok(())
}

fn text_of(value: Option<&Value>) -> Option<String> {
    value.and_then(scalar_text)
}

fn scalar_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn pascal_word(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

/// `fetch-depth` → `fetch_depth`, `enableCrossOsArchive` →
/// `enable_cross_os_archive`; Rust keywords get a raw identifier.
fn rust_ident(name: &str) -> String {
    let mut ident = String::with_capacity(name.len() + 4);
    let mut previous_lower = false;
    for c in name.chars() {
        if c.is_ascii_uppercase() && previous_lower {
            ident.push('_');
        }
        previous_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
        ident.push(if c.is_ascii_alphanumeric() {
            c.to_ascii_lowercase()
        } else {
            '_'
        });
    }
    let ident = if ident.starts_with(|c: char| c.is_ascii_digit()) {
        format!("_{ident}")
    } else {
        ident
    };
    const KEYWORDS: &[&str] = &[
        "as", "async", "await", "box", "break", "const", "continue", "crate", "dyn", "else",
        "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod",
        "move", "mut", "pub", "ref", "return", "static", "struct", "super", "trait", "true",
        "type", "unsafe", "use", "where", "while", "yield",
    ];
    if KEYWORDS.contains(&ident.as_str()) {
        format!("r#{ident}")
    } else {
        ident
    }
}
