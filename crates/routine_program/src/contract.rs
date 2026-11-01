//! The contract between a routine and its code steps: what `main` receives,
//! how each step's `steps` is typed from the steps that run before it, and
//! the version recorded with checked code.

use std::{collections::HashSet, sync::LazyLock};

use sha2::{Digest, Sha256};

use crate::model::{RoutineProgram, RoutineTool, SdkFingerprint, Step, StepId};

#[cfg(test)]
mod test;

/// How to write a code step, for whoever writes one: the agent tool that
/// creates routines and the routine drafter read the same text.
pub const CODE_STEPS: &str = include_str!("code_steps.md");

/// The ambient declarations code steps are type-checked with: what `main`
/// receives. The SDK's own declarations come from the checker. A step
/// checked with the rest of its routine (see [`RoutineProgram::check_files`])
/// sees `steps` typed with the outputs of the steps before it.
pub const STEP_CONTEXT: &str = r#"import type { Macro } from '@macro-inc/sdk';

declare global {
  /** What a routine code step's `main` receives. */
  interface RoutineStepContext<Steps> {
    /** Macro's SDK, acting as the routine's owner. */
    macro: Macro;
    /** This run. */
    run: RoutineRunInfo;
    /** The routine this step belongs to. */
    routine: { id: string; name: string };
    /** What started the run. */
    trigger: RoutineStart;
    /** What the steps that always run before this one returned, by id. */
    steps: Steps;
  }

  /** A code step's argument, when it is checked on its own. */
  type StepContext = RoutineStepContext<Record<string, unknown>>;

  interface RoutineRunInfo {
    /** Unique to this run. */
    id: string;
    /**
     * When the run counts as happening (ISO 8601): when its schedule came
     * due, its event happened, or it was started by hand. A dry run that
     * replays a past trigger gets that trigger's time. Use it, never
     * `new Date()`, for "today" or "since".
     */
    at: string;
    /** The IANA time zone to read `at` in: the schedule's, else the owner's. */
    timezone: string;
    /** Whether this is a dry run, whose writes change nothing. */
    dryRun: boolean;
    /** The routine's last finished run before this one. */
    previous: { at: string; outcome: 'succeeded' | 'failed' } | null;
    /** When the routine last ran successfully, for "since the last run" windows. */
    lastSucceededAt: string | null;
  }

  type RoutineStart =
    | { kind: 'schedule'; schedule: string; timezone: string }
    | { kind: 'event'; event: string; item: RoutineItem }
    | { kind: 'manual'; by: string };

  /** The item an event is about, as JSON; its fields depend on the event. */
  type RoutineItem = {
    entity_id: string;
    message_id?: string;
    [field: string]: any;
  };

  /** What a step's output becomes once stored: JSON. */
  type StepOutput<T> = [T] extends [void]
    ? null
    : T extends string | number | boolean | null
      ? T
      : T extends { toJSON(): infer J }
        ? StepOutput<J>
        : T extends readonly (infer U)[]
          ? StepOutput<U>[]
          : T extends (...args: never[]) => unknown
            ? never
            : T extends object
              ? { [K in keyof T]: StepOutput<T[K]> }
              : unknown;

  /** What a tool step's output is known to look like. */
  interface RoutineToolOutputs {
    CreateDocument: { documentId: string; [field: string]: unknown };
  }

  type RoutineToolOutput<Tool extends string> = Tool extends keyof RoutineToolOutputs
    ? RoutineToolOutputs[Tool]
    : unknown;
}
"#;

/// Bytes a step's output may take as JSON.
pub const MAX_OUTPUT_BYTES: usize = 64 * 1024;

static CONTRACT: LazyLock<String> = LazyLock::new(|| {
    let digest = Sha256::digest(STEP_CONTEXT.as_bytes());
    digest
        .iter()
        .take(4)
        .map(|byte| format!("{byte:02x}"))
        .collect()
});

/// The version code that checks against `sdk` and today's [`STEP_CONTEXT`]
/// records: a change to either is a new version, which runs check again.
pub fn code_version(sdk: &str) -> SdkFingerprint {
    // Never blank: it always carries the contract's hash.
    SdkFingerprint(format!("{sdk}+ctx.{}", *CONTRACT))
}

/// One code step, as the type checker sees it with the rest of its routine.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckFile {
    /// Which code step, counted in program order from zero.
    pub index: usize,
    /// The step's title.
    pub title: String,
    /// The file name it is checked under, e.g. `step_0.ts`.
    pub name: String,
    /// Its source, with a module-scoped `StepContext` appended that types
    /// `steps`. Appended last, so diagnostics keep the source's lines.
    pub source: String,
}

/// An output a later step can read.
enum Output {
    /// A code step's, by its file.
    Code(String),
    /// A tool step's.
    Tool(RoutineTool),
}

impl RoutineProgram {
    /// Give every code and tool step without an id one, from its title (code)
    /// or its tool's name, unique in the routine, so its output reaches later
    /// steps. Existing ids stay.
    pub fn assign_step_ids(&mut self) {
        let mut taken: HashSet<String> = HashSet::new();
        collect_ids(&self.steps, &mut taken);
        assign(&mut self.steps, &mut taken);
    }

    /// Every code step's check file, in program order. Each declares
    /// `steps` with the outputs of the steps that always run before it:
    /// earlier in the same list, or before the decision it sits in.
    pub fn check_files(&self) -> Vec<CheckFile> {
        let mut walk = Walk::default();
        walk.steps(&self.steps);
        walk.files
    }
}

fn collect_ids(steps: &[Step], taken: &mut HashSet<String>) {
    for step in steps {
        let id = match step {
            Step::Code(code) => code.id.as_ref(),
            Step::Tool(tool) => tool.id.as_ref(),
            Step::If(_) | Step::Choose(_) | Step::Agent(_) => None,
        };
        if let Some(id) = id {
            taken.insert(id.as_str().to_owned());
        }
        for branch in step.branches() {
            collect_ids(branch, taken);
        }
    }
}

fn assign(steps: &mut [Step], taken: &mut HashSet<String>) {
    for step in steps {
        match step {
            Step::Code(code) if code.id.is_none() => code.id = Some(unique(&code.title, taken)),
            Step::Tool(tool) if tool.id.is_none() => {
                tool.id = Some(unique(tool.tool.name(), taken));
            }
            Step::If(branch) => {
                assign(&mut branch.then, taken);
                assign(&mut branch.otherwise, taken);
            }
            Step::Choose(choose) => {
                for option in &mut choose.options {
                    assign(&mut option.steps, taken);
                }
                assign(&mut choose.otherwise, taken);
            }
            Step::Code(_) | Step::Tool(_) | Step::Agent(_) => {}
        }
    }
}

/// A step id from `name`: lowercase words joined by `_`, starting with a
/// letter, at most 32 characters, numbered when taken.
fn unique(name: &str, taken: &mut HashSet<String>) -> StepId {
    let mut slug = String::new();
    // `HasRead` → `has_read`: a capital after a lowercase letter starts a word.
    let mut previous_lower = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            if c.is_ascii_uppercase() && previous_lower && !slug.ends_with('_') {
                slug.push('_');
            }
            previous_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
            slug.push(c.to_ascii_lowercase());
        } else {
            previous_lower = false;
            if !slug.is_empty() && !slug.ends_with('_') {
                slug.push('_');
            }
        }
    }
    let mut base = slug.trim_matches('_').to_owned();
    if !base.starts_with(|c: char| c.is_ascii_lowercase()) {
        base = format!("step_{base}");
    }
    // Room for a `_N` suffix; a long name ends on a word.
    if base.len() > 28 {
        let cut = base[..28].rfind('_').filter(|&at| at >= 8).unwrap_or(28);
        base.truncate(cut);
    }
    let base = base.trim_end_matches('_').to_owned();
    // The base is a valid id, so the first free candidate is one; the loop
    // ends at it.
    let mut number = 1;
    loop {
        let candidate = if number == 1 {
            base.clone()
        } else {
            let suffix = format!("_{number}");
            let keep = base.len().min(32_usize.saturating_sub(suffix.len()));
            format!("{}{suffix}", base[..keep].trim_end_matches('_'))
        };
        number += 1;
        if taken.contains(&candidate) {
            continue;
        }
        if let Ok(id) = StepId::try_from(candidate.clone()) {
            taken.insert(candidate);
            return id;
        }
    }
}

#[derive(Default)]
struct Walk {
    files: Vec<CheckFile>,
    /// Outputs a step at the current position can read, in order.
    visible: Vec<(StepId, Output)>,
}

impl Walk {
    fn steps(&mut self, steps: &[Step]) {
        for step in steps {
            match step {
                Step::Code(code) => {
                    let index = self.files.len();
                    let name = format!("step_{index}.ts");
                    let mut source = code.source.clone();
                    if !source.ends_with('\n') {
                        source.push('\n');
                    }
                    source.push_str(&format!(
                        "type StepContext = RoutineStepContext<{}>;\n",
                        self.outputs()
                    ));
                    self.files.push(CheckFile {
                        index,
                        title: code.title.trim().to_owned(),
                        name: name.clone(),
                        source,
                    });
                    if let Some(id) = &code.id {
                        self.visible.push((id.clone(), Output::Code(name)));
                    }
                }
                Step::Tool(tool) => {
                    if let Some(id) = &tool.id {
                        self.visible.push((id.clone(), Output::Tool(tool.tool)));
                    }
                }
                Step::If(_) | Step::Choose(_) | Step::Agent(_) => {}
            }
            for branch in step.branches() {
                let scope = self.visible.len();
                self.steps(branch);
                self.visible.truncate(scope);
            }
        }
    }

    /// The TypeScript object type of the outputs visible here.
    fn outputs(&self) -> String {
        let fields: Vec<String> = self
            .visible
            .iter()
            .map(|(id, output)| match output {
                Output::Code(file) => format!(
                    "{id}: StepOutput<Awaited<ReturnType<typeof import('./{file}')['main']>>>"
                ),
                Output::Tool(tool) => format!("{id}: RoutineToolOutput<'{}'>", tool.name()),
            })
            .collect();
        format!("{{ {} }}", fields.join("; "))
    }
}
