//! Text derived from the same vocabulary a transcript renders: everything a
//! reader can open, and the part of it search indexes.
//!
//! This module deliberately starts from [`FoldedMessage`], never from ACP
//! frames. The fold is the boundary that decides which protocol material is
//! user-visible; these functions merely flatten that already-decided
//! representation.

use dynamic_ui::{TagNode, View, Widget};
use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, take_until},
    combinator::opt,
    sequence::{delimited, pair},
};
use serde_json::Value;

use super::{
    AnsweredField, AnsweredValue, Author, Control, ControlOutcome, ElicitationOutcome,
    ElicitationPropertySchema, ElicitationRequest, ElicitationSchema, FoldedMessage, MessagePart,
    PermissionOutcome, StopReason, SubagentResult, ToolDetail, ToolStatus, UserToolOutcome,
};

#[cfg(test)]
mod test;

impl FoldedMessage {
    /// Flatten everything a reader can open in the transcript: prose,
    /// thoughts, and every tool call's paths, commands, outputs and errors.
    ///
    /// Stable UI labels such as "Permission requested" are omitted because they
    /// would make every message match the same boilerplate. Variable content—the
    /// prose, paths, commands, outputs, questions, answers, and errors a person can
    /// actually recognize—is retained in render order. Nested subagent parts are
    /// traversed recursively.
    #[must_use]
    pub fn readable_text(&self) -> String {
        self.text(TextScope::Readable)
    }

    /// Flatten what the transcript shows without expanding anything, for the
    /// search index.
    ///
    /// Thoughts, the work inside tool calls, answered questions' forms, and an
    /// error's own text stay collapsed in the transcript, so a match there
    /// would land on text the reader cannot see. What remains is the
    /// conversation itself, plus the few tool-derived texts shown by default:
    /// a subagent's title and type, a user tool's subject or title, a
    /// presented view's own text, the server an approval names, and a failure
    /// notice.
    #[must_use]
    pub fn searchable_text(&self) -> String {
        self.text(TextScope::Shown)
    }

    fn text(&self, scope: TextScope) -> String {
        let mut text = SearchText {
            value: String::new(),
            scope,
            hides_agent_context: scope == TextScope::Shown
                && matches!(self.author, Author::User { .. }),
        };
        for part in self.parts.iter() {
            text.part(part);
        }
        if let Some(StopReason::Failed { message, notice }) = &self.stop {
            match scope {
                TextScope::Readable => text.push(message),
                // An opaque failure shows its message only behind the failed
                // line's disclosure; a classified one shows its notice card.
                TextScope::Shown => {
                    if let Some(notice) = notice {
                        text.push(&notice.title);
                        text.push(&notice.body);
                    }
                }
            }
        }
        text.finish()
    }
}

/// How much of a message to flatten.
#[derive(Clone, Copy, PartialEq, Eq)]
enum TextScope {
    /// Everything a reader can open.
    Readable,
    /// Only what the transcript shows without expanding.
    Shown,
}

struct SearchText {
    value: String,
    scope: TextScope,
    /// A prompt's text parts drop the agent-context block the transcript hides.
    hides_agent_context: bool,
}

const AGENT_CONTEXT_OPEN: &str = "<m-agent-context>";
const AGENT_CONTEXT_CLOSE: &str = "</m-agent-context>";

/// A prompt's text without the leading `<m-agent-context>` block: the context
/// the harness composes into every prompt it delivers (the time, the agent's
/// identity, who is asking, a thread's private context). The transcript hides
/// exactly such a block (`stripAgentContext` in `@macro-inc/lexical-core`): one
/// at the start, holding a version 1 payload and nothing else, with the blank
/// line after it. Any other text is returned whole.
fn without_agent_context(text: &str) -> &str {
    fn line_break(input: &str) -> IResult<&str, &str> {
        alt((tag("\r\n"), tag("\n"))).parse(input)
    }

    fn block(input: &str) -> IResult<&str, &str> {
        let (rest, payload) = delimited(
            tag(AGENT_CONTEXT_OPEN),
            take_until(AGENT_CONTEXT_CLOSE),
            tag(AGENT_CONTEXT_CLOSE),
        )
        .parse(input)?;
        let (rest, _) = opt(pair(line_break, line_break)).parse(rest)?;
        Ok((rest, payload))
    }

    match block(text) {
        Ok((rest, payload)) if is_agent_context(payload) => rest,
        _ => text,
    }
}

fn is_agent_context(payload: &str) -> bool {
    let Ok(Value::Object(fields)) = serde_json::from_str::<Value>(payload) else {
        return false;
    };
    // JavaScript's `version === 1` also takes `1.0`.
    fields.len() == 2
        && fields.get("version").and_then(Value::as_f64) == Some(1.0)
        && fields.get("text").is_some_and(Value::is_string)
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
            MessagePart::Text { text } => {
                if self.hides_agent_context {
                    self.push(without_agent_context(text));
                } else {
                    self.push(text);
                }
            }
            MessagePart::Thought { text } => {
                if self.scope == TextScope::Readable {
                    self.push(text);
                }
            }
            // The file's name is what a person would recognize and search
            // for; its static file URL is opaque and would only add noise.
            MessagePart::Attachment { name, .. } => self.push(name),
            MessagePart::ToolUse {
                name,
                detail,
                status,
                ..
            } => match self.scope {
                TextScope::Readable => {
                    self.push(name.display());
                    self.tool(detail);
                }
                TextScope::Shown => self.shown_tool(detail, *status),
            },
            // The resolved row words the outcome from the option's kind, never
            // its name, so the name is not shown.
            MessagePart::Permission { .. } if self.scope == TextScope::Shown => {}
            MessagePart::Permission {
                options, outcome, ..
            } => {
                if let PermissionOutcome::Selected { option_id } = outcome
                    && let Some(option) = options.iter().find(|option| option.id == *option_id)
                {
                    self.push(&option.name);
                }
            }
            MessagePart::ToolApproval {
                server_name,
                tool_name,
                ..
            } => {
                self.push(server_name);
                // The transcript words the tool for a person, never by name.
                if self.scope == TextScope::Readable {
                    self.push(tool_name);
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
                if let ControlOutcome::Rejected { message } = outcome
                    && self.scope == TextScope::Readable
                {
                    self.push(message);
                }
            }
            MessagePart::Plan { entries } => {
                for entry in entries {
                    self.push(&entry.content);
                }
            }
            MessagePart::TaskNotification { summary, event, .. } => {
                self.push(summary);
                if let Some(event) = event {
                    self.push(event);
                }
            }
            // A reviewed user tool's card shows the draft's subject or title;
            // any other question shows its message. Forms and answers sit
            // behind the card's disclosure.
            MessagePart::Elicitation {
                request: ElicitationRequest::UserTool { draft, .. },
                ..
            } if self.scope == TextScope::Shown => self.draft_heading(draft),
            MessagePart::Elicitation { message, .. } if self.scope == TextScope::Shown => {
                self.push(message);
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

    /// The text a collapsed transcript shows for a tool call. Calls grouped
    /// under "Used N tools" show none; the ungrouped kinds show their title,
    /// subject, or view.
    fn shown_tool(&mut self, detail: &ToolDetail, status: ToolStatus) {
        match detail {
            ToolDetail::Subagent {
                title, agent_type, ..
            } => {
                self.push(title);
                if let Some(agent_type) = agent_type {
                    self.push(agent_type);
                }
            }
            ToolDetail::UserTool { input, .. } => self.draft_heading(input),
            // A failed view, by status or by an error beside a decoded view,
            // shows only that it failed.
            ToolDetail::View { view, error } => {
                if let Some(view) = view
                    && error.is_none()
                    && status != ToolStatus::Failed
                {
                    self.view(view);
                }
            }
            ToolDetail::Terminal { .. }
            | ToolDetail::Edit { .. }
            | ToolDetail::Read { .. }
            | ToolDetail::Delete { .. }
            | ToolDetail::Move { .. }
            | ToolDetail::Search { .. }
            | ToolDetail::Fetch { .. }
            | ToolDetail::Think { .. }
            | ToolDetail::Other { .. }
            | ToolDetail::Macro { .. } => {}
        }
    }

    /// The one thing a user tool's card shows beside its name: an email's
    /// subject or an event's title.
    fn draft_heading(&mut self, draft: &Value) {
        for field in ["subject", "title"] {
            if let Some(text) = draft.get(field).and_then(Value::as_str) {
                self.push(text);
            }
        }
    }

    /// A view's own text. Widgets that name entities by id, and agent-update
    /// cards, show what they load live with the reader's access, which the
    /// fold does not hold.
    fn view(&mut self, view: &View) {
        if let Some(title) = &view.title {
            self.push(title);
        }
        for widget in &view.widgets {
            self.widget(widget);
        }
    }

    fn widget(&mut self, widget: &Widget) {
        match widget {
            Widget::Md { markdown } => self.push(markdown),
            Widget::Timeline { title, events } => {
                if let Some(title) = title {
                    self.push(title);
                }
                for event in events {
                    self.push(&event.title);
                    if let Some(description) = &event.description {
                        self.push(description);
                    }
                }
            }
            Widget::List { title, .. }
            | Widget::Events { title, .. }
            | Widget::Cards { title, .. } => {
                if let Some(title) = title {
                    self.push(title);
                }
            }
            Widget::Tags { title, tags } => {
                if let Some(title) = title {
                    self.push(title);
                }
                self.tags(tags);
            }
            Widget::Connect { name, .. } => self.push(name),
            Widget::AgentUpdates { .. } | Widget::ChannelMessage { .. } => {}
            Widget::BotCredential { label, .. } => {
                if let Some(label) = label {
                    self.push(label);
                }
            }
            // A container lays its children out and renders no title.
            Widget::Container { children, .. } => {
                for child in children {
                    self.widget(child);
                }
            }
        }
    }

    fn tags(&mut self, tags: &[TagNode]) {
        for tag in tags {
            self.push(&tag.label);
            if let Some(description) = &tag.description {
                self.push(description);
            }
            if let Some(children) = &tag.children {
                self.tags(children);
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
            ToolDetail::Other {
                input,
                output,
                result,
                error,
                ..
            } => {
                if let Some(input) = input {
                    self.json(input);
                }
                if let Some(error) = error {
                    self.push(error);
                }
                // The text blocks and the unwrapped result usually carry the
                // same words; either alone is enough to find the call by.
                match (result, output) {
                    (Some(result), _) => self.json(result),
                    (None, Some(output)) => self.push(output),
                    (None, None) => {}
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
            ToolDetail::View { view, error } => {
                if let Some(value) = view
                    .as_ref()
                    .and_then(|view| serde_json::to_value(view).ok())
                {
                    self.json(&value);
                }
                if let Some(error) = error {
                    self.push(error);
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
