//! Deciding which steps run, and recording what each one did.

use std::fmt;

use jev::domain::{Probability, QuestionError, YesNoQuestion};
use serde::{Deserialize, Serialize};

use crate::model::{
    AgentStep, ChoiceOption, ChooseStep, RoutineProgram, RoutineTool, Step, ToolStep,
};

#[cfg(test)]
mod test;

/// A question is answered yes when the classifier's probability reaches this.
pub const CONDITION_THRESHOLD: f32 = 0.5;

/// Where a step sits in its program: `1` is the second top-level step,
/// `1.then.0` the first step of its yes branch, `2.options.0.1` the second
/// step of a choice's first option and `2.otherwise.0` its fallback.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StepPath(String);

impl StepPath {
    fn root(index: usize) -> Self {
        Self(index.to_string())
    }

    fn child(&self, branch: &str, index: usize) -> Self {
        Self(format!("{}.{branch}.{index}", self.0))
    }

    /// The path as written.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for StepPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// What a run did at one step, in the order it happened.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StepRecord {
    /// The step's place in the program when it ran.
    pub path: StepPath,
    /// Its result.
    #[serde(flatten)]
    pub result: StepResult,
}

/// The result of one step. Steps without an error succeeded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StepResult {
    /// A yes/no question was answered.
    If {
        /// Whether the yes branch ran.
        answer: bool,
        /// The classifier's probability of yes.
        probability: f32,
    },
    /// A choice was made.
    Choose {
        /// The chosen options' labels, in option order: at most one unless
        /// the step picks every option that fits; none when no option fit.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        choices: Vec<String>,
        /// The highest probability among the options.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        probability: Option<f32>,
    },
    /// A tool was called.
    Tool {
        /// The tool.
        tool: RoutineTool,
        /// Why it failed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// A model or agent ran.
    Agent {
        /// Why it failed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

/// The next thing a run does, once its decisions are answered.
#[derive(Debug, Clone, PartialEq)]
pub enum PlannedStep<'a> {
    /// A decision's answer, recorded where it was made.
    Decided(StepRecord),
    /// Call a tool.
    Tool {
        /// Where the step sits.
        path: StepPath,
        /// The step.
        step: &'a ToolStep,
    },
    /// Run a model or agent.
    Agent {
        /// Where the step sits.
        path: StepPath,
        /// The step.
        step: &'a AgentStep,
    },
}

/// The yes/no question asked for one option of a choose step. Options of a
/// step that runs every fitting option are asked about independently.
pub fn choice_question(
    choose: &ChooseStep,
    option: &ChoiceOption,
) -> Result<YesNoQuestion, QuestionError> {
    let label = option.label.trim();
    let described = match nonblank(option.description.as_deref()) {
        Some(description) => format!("\"{label}\" ({description})"),
        None => format!("\"{label}\""),
    };
    let question = nonblank(choose.question.as_deref());
    YesNoQuestion::try_from(match (question, choose.multiple) {
        (Some(question), false) => format!("{question} Is the answer {described}?"),
        (None, false) => format!("Is this best described as {described}?"),
        (Some(question), true) => format!("{question} Does {described} apply?"),
        (None, true) => format!("Does {described} apply to this?"),
    })
}

fn nonblank(text: Option<&str>) -> Option<&str> {
    text.map(str::trim).filter(|text| !text.is_empty())
}

/// The answers do not match the program's questions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("expected {expected} answers to the routine's questions, got {actual}")]
pub struct AnswerMismatch {
    expected: usize,
    actual: usize,
}

impl RoutineProgram {
    /// Every question the program's decisions ask, in program order and
    /// including untaken branches, so one classifier call answers them all.
    pub fn questions(&self) -> Result<Vec<YesNoQuestion>, QuestionError> {
        let mut questions = Vec::new();
        let mut result = Ok(());
        crate::model::visit(&self.steps, &mut |step| match step {
            Step::If(step) => questions.push(step.condition.clone()),
            Step::Choose(choose) => {
                for option in &choose.options {
                    match choice_question(choose, option) {
                        Ok(question) => questions.push(question),
                        Err(error) => result = Err(error),
                    }
                }
            }
            Step::Tool(_) | Step::Agent(_) => {}
        });
        result.map(|()| questions)
    }

    /// The steps to run, given one answer per [`Self::questions`] entry.
    pub fn resolve(&self, answers: &[Probability]) -> Result<Vec<PlannedStep<'_>>, AnswerMismatch> {
        let mut plan = Vec::new();
        let mut cursor = 0;
        let mut walk = Walk {
            answers,
            cursor: &mut cursor,
            plan: &mut plan,
        };
        for (index, step) in self.steps.iter().enumerate() {
            walk.step(step, StepPath::root(index), true);
        }
        if cursor != answers.len() {
            return Err(AnswerMismatch {
                expected: cursor,
                actual: answers.len(),
            });
        }
        Ok(plan)
    }
}

struct Walk<'a, 'b> {
    answers: &'b [Probability],
    cursor: &'b mut usize,
    plan: &'b mut Vec<PlannedStep<'a>>,
}

impl<'a> Walk<'a, '_> {
    /// Untaken branches are walked too, so every decision consumes its answers.
    fn step(&mut self, step: &'a Step, path: StepPath, active: bool) {
        match step {
            Step::Tool(step) => {
                if active {
                    self.plan.push(PlannedStep::Tool { path, step });
                }
            }
            Step::Agent(step) => {
                if active {
                    self.plan.push(PlannedStep::Agent { path, step });
                }
            }
            Step::If(step) => {
                let probability = self.take(1).first().map(|p| p.get());
                let answer = probability.is_some_and(|p| p >= CONDITION_THRESHOLD);
                if active {
                    self.plan.push(PlannedStep::Decided(StepRecord {
                        path: path.clone(),
                        result: StepResult::If {
                            answer,
                            probability: probability.unwrap_or_default(),
                        },
                    }));
                }
                self.branch(&step.then, &path, "then", active && answer);
                self.branch(&step.otherwise, &path, "else", active && !answer);
            }
            Step::Choose(step) => {
                let probabilities: Vec<f32> = self
                    .take(step.options.len())
                    .iter()
                    .map(|p| p.get())
                    .collect();
                // The first of equally likely options wins.
                let best = probabilities.iter().copied().enumerate().fold(
                    None::<(usize, f32)>,
                    |best, (index, p)| match best {
                        Some((_, top)) if top >= p => best,
                        _ => Some((index, p)),
                    },
                );
                let chosen: Vec<usize> = if step.multiple {
                    (0..probabilities.len())
                        .filter(|&index| probabilities[index] >= CONDITION_THRESHOLD)
                        .collect()
                } else {
                    best.filter(|(_, p)| *p >= CONDITION_THRESHOLD)
                        .map(|(index, _)| index)
                        .into_iter()
                        .collect()
                };
                if active {
                    self.plan.push(PlannedStep::Decided(StepRecord {
                        path: path.clone(),
                        result: StepResult::Choose {
                            choices: chosen
                                .iter()
                                .map(|&index| step.options[index].label.clone())
                                .collect(),
                            probability: best.map(|(_, p)| p),
                        },
                    }));
                }
                for (index, option) in step.options.iter().enumerate() {
                    let branch = format!("options.{index}");
                    self.branch(
                        &option.steps,
                        &path,
                        &branch,
                        active && chosen.contains(&index),
                    );
                }
                self.branch(
                    &step.otherwise,
                    &path,
                    "otherwise",
                    active && chosen.is_empty(),
                );
            }
        }
    }

    fn branch(&mut self, steps: &'a [Step], parent: &StepPath, name: &str, active: bool) {
        for (index, step) in steps.iter().enumerate() {
            self.step(step, parent.child(name, index), active);
        }
    }

    fn take(&mut self, count: usize) -> &[Probability] {
        let start = (*self.cursor).min(self.answers.len());
        let end = (*self.cursor + count).min(self.answers.len());
        *self.cursor += count;
        &self.answers[start..end]
    }
}
