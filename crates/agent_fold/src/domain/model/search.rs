//! Searchable text derived from the same vocabulary a transcript renders.
//!
//! This module deliberately starts from [`FoldedMessage`], never from ACP
//! frames. The fold is the boundary that decides which protocol material is
//! user-visible; search merely flattens that already-decided representation.

use serde_json::Value;

use super::{
    AnsweredField, AnsweredValue, Control, ControlOutcome, ElicitationOutcome,
    ElicitationPropertySchema, ElicitationRequest, ElicitationSchema, FoldedMessage, MessagePart,
    PermissionOutcome, StopReason, SubagentResult, ToolDetail, UserToolOutcome,
};

#[cfg(test)]
mod test;

impl FoldedMessage {
    /// Flatten the content a transcript exposes into text suitable for full-text search.
    ///
    /// Stable UI labels such as "Permission requested" are omitted because they
    /// would make every message match the same boilerplate. Variable content—the
    /// prose, paths, commands, outputs, questions, answers, and errors a person can
    /// actually recognize—is retained in render order. Nested subagent parts are
    /// traversed recursively.
    #[must_use]
    pub fn searchable_text(&self) -> String {
        let mut text = SearchText::default();
        for part in self.parts.iter() {
            text.part(part);
        }
        if let Some(StopReason::Failed { message }) = &self.stop {
            text.push(message);
        }
        text.finish()
    }
}

#[derive(Default)]
struct SearchText {
    value: String,
}

impl SearchText {
    fn finish(self) -> String {
        self.value
    }

    fn push(&mut self, value: &str) {
        if value.trim().is_empty() {
            return;
        }
        if !self.value.is_empty() {
            self.value.push('\n');
        }
        self.value.push_str(value);
    }

    fn json(&mut self, value: &Value) {
        if let Ok(value) = serde_json::to_string_pretty(value) {
            self.push(&value);
        }
    }

    fn part(&mut self, part: &MessagePart) {
        match part {
            MessagePart::Text { text } | MessagePart::Thought { text } => self.push(text),
            MessagePart::ToolUse { name, detail, .. } => {
                self.push(name.display());
                self.tool(detail);
            }
            MessagePart::Permission {
                options, outcome, ..
            } => {
                if let PermissionOutcome::Selected { option_id } = outcome
                    && let Some(option) = options.iter().find(|option| option.id == *option_id)
                {
                    self.push(&option.name);
                }
            }
            MessagePart::Control { control, outcome } => {
                match control {
                    Control::SetModel { model } => self.push(model),
                    Control::SetConfigOption { config_id, value } => {
                        self.push(config_id);
                        self.push(value);
                    }
                    Control::Compact | Control::Stop => {}
                }
                if let ControlOutcome::Rejected { message } = outcome {
                    self.push(message);
                }
            }
            MessagePart::Plan { entries } => {
                for entry in entries {
                    self.push(&entry.content);
                }
            }
            MessagePart::Elicitation {
                message,
                request,
                outcome,
                reported,
                tool_outcome,
                ..
            } => {
                self.push(message);
                self.elicitation_request(request);
                self.elicitation_outcome(outcome);
                if let Some(reported) = reported {
                    self.answers(reported);
                }
                if let Some(outcome) = tool_outcome {
                    self.user_tool_outcome(outcome);
                }
            }
        }
    }

    fn tool(&mut self, detail: &ToolDetail) {
        match detail {
            ToolDetail::Terminal {
                command, output, ..
            } => {
                if let Some(command) = command {
                    self.push(command);
                }
                if let Some(output) = output {
                    self.push(output.as_str());
                }
            }
            ToolDetail::Edit { diffs } => {
                for diff in diffs {
                    self.push(&diff.path.to_string_lossy());
                    if let Some(old_text) = &diff.old_text {
                        self.push(old_text);
                    }
                    self.push(&diff.new_text);
                }
            }
            ToolDetail::Read { paths }
            | ToolDetail::Delete { paths }
            | ToolDetail::Move { paths } => {
                for path in paths {
                    self.push(&path.to_string_lossy());
                }
            }
            ToolDetail::Search { paths, output } => {
                for path in paths {
                    self.push(&path.to_string_lossy());
                }
                if let Some(output) = output {
                    self.push(output);
                }
            }
            ToolDetail::Fetch { output } | ToolDetail::Think { output } => {
                if let Some(output) = output {
                    self.push(output);
                }
            }
            ToolDetail::Other { input, output, .. } => {
                if let Some(input) = input {
                    self.json(input);
                }
                if let Some(output) = output {
                    self.push(output);
                }
            }
            ToolDetail::Macro {
                input,
                output,
                error,
            } => {
                self.json(input);
                if let Some(error) = error {
                    self.push(error);
                } else if let Some(output) = output {
                    self.json(output);
                }
            }
            ToolDetail::UserTool { input, outcome } => {
                self.json(input);
                self.user_tool_outcome(outcome);
            }
            ToolDetail::Subagent {
                title,
                agent_type,
                description,
                prompt,
                children,
                result,
                ..
            } => {
                self.push(title);
                if let Some(agent_type) = agent_type {
                    self.push(agent_type);
                }
                if let Some(description) = description {
                    self.push(description);
                }
                if let Some(prompt) = prompt {
                    self.push(prompt);
                }
                for child in children {
                    self.part(child);
                }
                if let Some(result) = result {
                    self.subagent_result(result);
                }
            }
        }
    }

    fn subagent_result(&mut self, result: &SubagentResult) {
        if let Some(text) = &result.text {
            self.push(text);
        }
        if let Some(error) = &result.error {
            self.push(error);
        }
        if let Some(model) = &result.model {
            self.push(model);
        }
    }

    fn elicitation_request(&mut self, request: &ElicitationRequest) {
        match request {
            ElicitationRequest::Form { schema } => self.elicitation_schema(schema),
            ElicitationRequest::Url { url, .. } => self.push(url),
            ElicitationRequest::UserTool {
                tool,
                draft,
                schema,
            } => {
                self.push(tool);
                self.json(draft);
                self.elicitation_schema(schema);
            }
            ElicitationRequest::Unrecognized { mode, .. } => self.push(mode),
        }
    }

    fn elicitation_schema(&mut self, schema: &ElicitationSchema) {
        if let Some(title) = &schema.title {
            self.push(title);
        }
        if let Some(description) = &schema.description {
            self.push(description);
        }
        for property in &schema.properties {
            if let Some(title) = &property.title {
                self.push(title);
            } else {
                self.push(&property.name);
            }
            if let Some(description) = &property.description {
                self.push(description);
            }
            match &property.schema {
                ElicitationPropertySchema::String { options, .. }
                | ElicitationPropertySchema::MultiSelect { options, .. } => {
                    for option in options {
                        self.push(option.title.as_deref().unwrap_or(&option.value));
                        if let Some(description) = &option.description {
                            self.push(description);
                        }
                    }
                }
                ElicitationPropertySchema::Unrecognized { type_name, .. } => {
                    self.push(type_name);
                }
                ElicitationPropertySchema::Number { .. }
                | ElicitationPropertySchema::Integer { .. }
                | ElicitationPropertySchema::Boolean { .. } => {}
            }
        }
    }

    fn elicitation_outcome(&mut self, outcome: &ElicitationOutcome) {
        match outcome {
            ElicitationOutcome::Accepted { answers } => self.answers(answers),
            ElicitationOutcome::Errored { message } => self.push(message),
            ElicitationOutcome::Pending
            | ElicitationOutcome::Declined
            | ElicitationOutcome::Cancelled
            | ElicitationOutcome::Completed
            | ElicitationOutcome::Unrecognized => {}
        }
    }

    fn answers(&mut self, answers: &[AnsweredField]) {
        for answer in answers {
            self.push(&answer.label);
            match &answer.value {
                AnsweredValue::Text { text }
                | AnsweredValue::Number { text }
                | AnsweredValue::Custom { text } => self.push(text),
                AnsweredValue::Boolean { checked } => {
                    self.push(if *checked { "Yes" } else { "No" });
                }
                AnsweredValue::Choice { choice } => {
                    self.push(choice.title.as_deref().unwrap_or(&choice.value));
                }
                AnsweredValue::Choices { choices } => {
                    for choice in choices {
                        self.push(choice.title.as_deref().unwrap_or(&choice.value));
                    }
                }
                AnsweredValue::Unrecognized { raw } => self.json(raw),
            }
        }
    }

    fn user_tool_outcome(&mut self, outcome: &UserToolOutcome) {
        match outcome {
            UserToolOutcome::Sent {
                message_id,
                thread_id,
            } => {
                self.push(message_id);
                self.push(thread_id);
            }
            UserToolOutcome::Draft {
                draft_id,
                thread_id,
            } => {
                self.push(draft_id);
                if let Some(thread_id) = thread_id {
                    self.push(thread_id);
                }
            }
            UserToolOutcome::Completed { result } => self.json(result),
            UserToolOutcome::Failed { message } => self.push(message),
            UserToolOutcome::Pending
            | UserToolOutcome::Edited
            | UserToolOutcome::Rejected
            | UserToolOutcome::Unrecognized => {}
        }
    }
}
