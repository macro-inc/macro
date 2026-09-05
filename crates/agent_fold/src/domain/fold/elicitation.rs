//! Folding `elicitation/create`, its answer, and `elicitation/complete`.
//!
//! A question is a part in the transcript (history) and, while it is open,
//! the one [`PendingElicitation`] on the metadata (the live pointer a surface
//! answers from). The two diverge on purpose: the part stays `Pending` forever
//! on a session that died mid-question, while the metadata slot clears the
//! moment the turn that asked ends - the agent has moved on and nothing
//! should still offer the form.
//!
//! Only ACP is read here. What a harness adds to it - a select's free-text
//! "Other" companion, the answer it reports afterwards - comes through the
//! [`HarnessReader`] like every other harness convention.

use std::collections::{BTreeMap, HashSet};

use agent_client_protocol::RawJsonRpcParams;
use agent_client_protocol::schema::v1::{
    CompleteElicitationNotification, CreateElicitationRequest, CreateElicitationResponse,
    ElicitationAction, ElicitationContentValue, ElicitationMode,
    ElicitationPropertySchema as AcpPropertySchema, ElicitationSchema as AcpSchema,
    ElicitationScope, EnumOption, MultiSelectItems, RequestId,
};
use serde_json::Value;

use super::convert::{deserialize_params, param};
use super::state::{Changed, FoldState, ToolPath};
use crate::domain::error::FoldError;
use crate::domain::harness::{HarnessReader, ToolFrame};
use crate::domain::model::{
    AnsweredChoice, AnsweredField, AnsweredValue, ElicitationOption, ElicitationOutcome,
    ElicitationProperty, ElicitationPropertySchema, ElicitationRequest, ElicitationRequestId,
    ElicitationSchema, MessagePart, PendingElicitation, ToolUseId,
};

impl FoldState {
    /// Handle an `elicitation/create`: add (or absorb into) a part, record
    /// the request id so its response can be matched, and point the metadata
    /// at it when nothing else is pending.
    ///
    /// Returns the message change and whether the metadata moved; `None` when
    /// the frame derived nothing (a null id, params that do not parse, or a
    /// question with no message to attach to).
    pub(super) fn request_elicitation(
        &mut self,
        request_id: &RequestId,
        params: Option<&RawJsonRpcParams>,
    ) -> Option<(Changed, bool)> {
        let Some(id) = ElicitationRequestId::from_request_id(request_id) else {
            self.warn(FoldError::Unknown {
                kind: "elicitation/create with a null id".to_owned(),
            });
            return None;
        };
        let Some(request) = deserialize_params::<CreateElicitationRequest>(params) else {
            self.warn(FoldError::Unknown {
                kind: "elicitation/create".to_owned(),
            });
            return None;
        };

        let (tool_call, elicitation_request) = decode_request(self.reader(), &request, params);
        let message_text = request.message.clone();

        // Absorb the tool call the question was asked for, when this fold has
        // it open: the part takes the tool's place so the question renders
        // once, in the position the tool row already had - nested under a
        // subagent if that is where the call sat - and later updates for that
        // tool id land on the question (see `patch_tool_call`).
        let absorbed = tool_call
            .as_ref()
            .and_then(|tool| self.tool_positions.get(tool).cloned())
            .filter(|at| matches!(self.part_at_mut(at), Some(MessagePart::ToolUse { .. })));

        // A form asked on behalf of one of Macro's user tools is that tool's
        // review: the call is what is being decided, and a client with the
        // tool's composer renders the draft rather than the form.
        let elicitation_request = match elicitation_request {
            ElicitationRequest::Form { schema } => {
                let absorbed_user_tool = absorbed.as_ref().and_then(|at| self.user_tool_at(at));
                match absorbed_user_tool.or_else(|| user_tool_from_meta(&request)) {
                    Some((tool, draft)) => ElicitationRequest::UserTool {
                        tool,
                        draft: Box::new(draft),
                        schema: Box::new(schema),
                    },
                    None => ElicitationRequest::Form { schema },
                }
            }
            other => other,
        };

        let part = MessagePart::Elicitation {
            request_id: id.clone(),
            tool_call: tool_call.clone(),
            message: message_text.clone(),
            request: elicitation_request.clone(),
            outcome: ElicitationOutcome::Pending,
            reported: None,
            tool_outcome: None,
        };
        let (changed, at) = match absorbed {
            Some(at) => {
                *self.part_at_mut(&at)? = part;
                (Changed::updated(at.message), at)
            }
            None => {
                let (changed, position) = self.push_agent_part(part)?;
                let at = ToolPath {
                    message: changed.message,
                    path: vec![position],
                };
                (changed, at)
            }
        };

        self.pending_elicitations
            .insert(request_id.clone(), at.clone());

        // One question at a time is a Macro rule the session machine enforces
        // by refusing a second create; the fold mirrors it by never letting a
        // second one take the slot, so a refused request still gets its part
        // (and its `Errored` outcome) without ever being offered to the user.
        let metadata_changed = if self.metadata.pending_elicitation.is_none() {
            self.metadata.pending_elicitation = Some(PendingElicitation {
                request_id: id,
                turn: self.messages[at.message].id.0,
                tool_call,
                message: message_text,
                request: elicitation_request,
            });
            true
        } else {
            false
        };

        Some((changed, metadata_changed))
    }

    /// Handle the response to an `elicitation/create`. `None` when the id
    /// matches no outstanding elicitation, so the caller can try the
    /// permission map instead.
    pub(super) fn resolve_elicitation(
        &mut self,
        response_id: &RequestId,
        value: Option<&Value>,
        error: Option<&str>,
    ) -> Option<(Changed, bool)> {
        let at = self.pending_elicitations.remove(response_id)?;

        // The schema the question was asked with: what the submitted content
        // is shaped against, so a reader never re-correlates the two.
        let schema = match self.part_at(&at) {
            Some(MessagePart::Elicitation { request, .. }) => schema_of(request).cloned(),
            _ => None,
        };

        let outcome = match (value, error) {
            (_, Some(message)) => ElicitationOutcome::Errored {
                message: message.to_owned(),
            },
            (None, None) => ElicitationOutcome::Errored {
                message: String::new(),
            },
            (Some(value), None) => {
                match serde_json::from_value::<CreateElicitationResponse>(value.clone()) {
                    Ok(response) => match response.action {
                        ElicitationAction::Accept(accept) => ElicitationOutcome::Accepted {
                            answers: accept
                                .content
                                .map(|content| shape_answers(schema.as_ref(), &content))
                                .unwrap_or_default(),
                        },
                        ElicitationAction::Decline => ElicitationOutcome::Declined,
                        ElicitationAction::Cancel => ElicitationOutcome::Cancelled,
                        // `#[non_exhaustive]`, and `Other` is untagged.
                        _ => ElicitationOutcome::Unrecognized,
                    },
                    Err(_) => ElicitationOutcome::Unrecognized,
                }
            }
        };
        let accepted = matches!(outcome, ElicitationOutcome::Accepted { .. });

        let Some(MessagePart::Elicitation {
            outcome: existing,
            request,
            request_id,
            ..
        }) = self.part_at_mut(&at)
        else {
            return None;
        };
        *existing = outcome;
        let answered_id = request_id.clone();

        // A URL consent may still be completed by the agent later.
        if accepted && let ElicitationRequest::Url { elicitation_id, .. } = request {
            let elicitation_id = elicitation_id.clone();
            self.completable_elicitations
                .insert(elicitation_id, at.clone());
        }

        let metadata_changed =
            self.clear_pending_elicitation_if(|pending| pending.request_id == answered_id);

        Some((Changed::updated(at.message), metadata_changed))
    }

    /// Handle an `elicitation/complete`: a URL interaction the user accepted
    /// has finished. Unknown and already-completed ids are ignored, as the
    /// protocol requires.
    pub(super) fn complete_elicitation(
        &mut self,
        params: Option<&RawJsonRpcParams>,
    ) -> Option<Changed> {
        let notification = deserialize_params::<CompleteElicitationNotification>(params)?;
        let at = self
            .completable_elicitations
            .remove(notification.elicitation_id.0.as_ref())?;
        let Some(MessagePart::Elicitation { outcome, .. }) = self.part_at_mut(&at) else {
            return None;
        };
        if !matches!(outcome, ElicitationOutcome::Accepted { .. }) {
            return None;
        }
        *outcome = ElicitationOutcome::Completed;
        Some(Changed::updated(at.message))
    }

    /// A `tool_call_update` for a tool id whose part is now an elicitation:
    /// the harness telling us what it made of the answer, or - for a user
    /// tool's review - the tool reporting how it ended once the user
    /// answered. Returns `None` when the update carries nothing this fold
    /// reads.
    pub(super) fn patch_absorbed_elicitation(
        &mut self,
        at: &ToolPath,
        frame: &ToolFrame<'_>,
    ) -> Option<Changed> {
        let reader = self.reader();
        let answer = reader.reported_elicitation_answer(frame);
        let Some(MessagePart::Elicitation {
            request,
            reported,
            tool_outcome,
            ..
        }) = self.part_at_mut(at)
        else {
            return None;
        };
        let mut changed = false;
        if let Some(answer) = answer.as_ref().and_then(shape_reported) {
            *reported = Some(answer);
            changed = true;
        }
        if let (ElicitationRequest::UserTool { tool, .. }, Some(raw)) =
            (&*request, frame.raw_output)
        {
            *tool_outcome = Some(crate::domain::harness::user_tool_outcome(reader, tool, raw));
            changed = true;
        }
        changed.then(|| Changed::updated(at.message))
    }

    /// A `tool_call` for an id a pending question already names: the question
    /// asked on the call's behalf arrived first. The question keeps its row
    /// and becomes the call's position, so the call's later updates land on
    /// it, and a user tool's draft fills from the call's input when the
    /// question came without one. `None` when no question names the call.
    pub(super) fn absorb_late_tool_call(
        &mut self,
        id: &ToolUseId,
        frame: &ToolFrame<'_>,
    ) -> Option<Changed> {
        if self.tool_positions.contains_key(id) {
            return None;
        }
        let at = self
            .pending_elicitations
            .values()
            .find(|at| {
                matches!(
                    self.part_at(at),
                    Some(MessagePart::Elicitation { tool_call: Some(named), .. }) if named == id
                )
            })
            .cloned()?;
        if let Some(MessagePart::Elicitation {
            request: ElicitationRequest::UserTool { draft, .. },
            ..
        }) = self.part_at_mut(&at)
            && draft.is_null()
            && let Some(input) = frame.raw_input
        {
            **draft = input.clone();
        }
        self.tool_positions.insert(id.clone(), at.clone());
        Some(Changed::updated(at.message))
    }

    /// The Macro user tool at `at`, with its draft, when the part there is a
    /// tool call this fold classified as one.
    fn user_tool_at(&mut self, at: &ToolPath) -> Option<(String, Value)> {
        match self.part_at_mut(at) {
            Some(MessagePart::ToolUse {
                name,
                detail: crate::domain::model::ToolDetail::UserTool { input, .. },
                ..
            }) => Some((name.display().to_owned(), input.clone())),
            _ => None,
        }
    }

    /// Drop the metadata's pending elicitation when `matches` says so.
    /// Returns whether the metadata moved.
    pub(super) fn clear_pending_elicitation_if(
        &mut self,
        matches: impl FnOnce(&PendingElicitation) -> bool,
    ) -> bool {
        match &self.metadata.pending_elicitation {
            Some(pending) if matches(pending) => {
                self.metadata.pending_elicitation = None;
                true
            }
            _ => false,
        }
    }

    /// After a prompt response: if no turn is open any more, the agent has
    /// moved past whatever it asked, and nothing should still offer the form.
    /// The part keeps its `Pending` outcome; only the live pointer clears.
    pub(super) fn turn_ended_clears_elicitation(&mut self) -> bool {
        if self.turn.is_some() {
            return false;
        }
        self.clear_pending_elicitation_if(|_| true)
    }

    /// Forget everything about outstanding elicitations: the connection that
    /// asked is gone and its request ids with it.
    pub(super) fn forget_elicitations(&mut self) -> bool {
        self.pending_elicitations.clear();
        self.completable_elicitations.clear();
        self.clear_pending_elicitation_if(|_| true)
    }
}

/// The tool call (if any) and the renderable request, decoded from ACP's
/// typed request plus the raw params for what the typed form loses.
fn decode_request(
    reader: &dyn HarnessReader,
    request: &CreateElicitationRequest,
    params: Option<&RawJsonRpcParams>,
) -> (Option<ToolUseId>, ElicitationRequest) {
    let raw_schema = param(params, "requestedSchema");
    match &request.mode {
        ElicitationMode::Form(form) => (
            scope_tool_call(&form.scope),
            ElicitationRequest::Form {
                schema: collapse_custom_answers(
                    reader,
                    decode_schema(&form.requested_schema, raw_schema),
                    raw_schema,
                ),
            },
        ),
        ElicitationMode::Url(url) => (
            scope_tool_call(&url.scope),
            ElicitationRequest::Url {
                elicitation_id: url.elicitation_id.0.to_string(),
                url: url.url.clone(),
            },
        ),
        // `Other`, or a mode ACP adds later. The raw params are the payload.
        _ => {
            let raw = match params {
                Some(RawJsonRpcParams::Object(map)) => Value::Object(map.clone()),
                _ => Value::Null,
            };
            let mode = raw
                .get("mode")
                .and_then(Value::as_str)
                .unwrap_or("<missing>")
                .to_owned();
            let tool_call = raw
                .get("toolCallId")
                .and_then(Value::as_str)
                .map(|id| ToolUseId(id.to_owned()));
            (tool_call, ElicitationRequest::Unrecognized { mode, raw })
        }
    }
}

/// The user tool a request names under `_meta.macro.userTool`, with the
/// draft it carries there - how Macro's own agent labels a review, so the
/// fold reads it even when the call it is scoped to is not open here. The
/// name is required; the draft defaults to nothing.
fn user_tool_from_meta(request: &CreateElicitationRequest) -> Option<(String, Value)> {
    let user_tool = request
        .meta
        .as_ref()?
        .get(crate::domain::harness::macro_inmem::NAMESPACE)?
        .get("userTool")?;
    let name = user_tool.get("name")?.as_str()?.to_owned();
    let draft = user_tool.get("draft").cloned().unwrap_or(Value::Null);
    Some((name, draft))
}

fn scope_tool_call(scope: &ElicitationScope) -> Option<ToolUseId> {
    match scope {
        ElicitationScope::Session(scope) => scope
            .tool_call_id
            .as_ref()
            .map(|id| ToolUseId(id.0.to_string())),
        _ => None,
    }
}

/// Mirror ACP's schema, keeping the agent's property order.
///
/// The SDK decodes `properties` into a `BTreeMap`, which sorts keys; the raw
/// object (insertion-ordered - `serde_json/preserve_order` is on workspace
/// wide) says what order the agent actually declared. Keys the raw object
/// lacks, or that fail to decode, are skipped: a partially typed schema is
/// still a form.
fn decode_schema(schema: &AcpSchema, raw: Option<&Value>) -> ElicitationSchema {
    let raw_properties = raw
        .and_then(|raw| raw.get("properties"))
        .and_then(Value::as_object);
    let order: Vec<&str> = match raw_properties {
        Some(map) => map.keys().map(String::as_str).collect(),
        None => schema.properties.keys().map(String::as_str).collect(),
    };

    let properties = order
        .into_iter()
        .filter_map(|name| {
            let typed = schema.properties.get(name)?;
            let raw = raw_properties.and_then(|map| map.get(name));
            Some(decode_property(name, typed, raw))
        })
        .collect();

    ElicitationSchema {
        title: schema.title.clone(),
        description: schema.description.clone(),
        properties,
        required: schema.required.clone().unwrap_or_default(),
    }
}

/// Collapse each select + free-text "Other" companion pair the harness
/// declared into one property whose `custom_field` names the companion key.
///
/// Both single (`String` with options) and multi (`MultiSelect`) selects take
/// a companion. The pair arrives with no `required` from Claude Code (Codex
/// requires the select only when it has no companion), but an empty
/// submission is useless to the agent, so the collapsed field is marked
/// required: the user must pick or type.
fn collapse_custom_answers(
    reader: &dyn HarnessReader,
    mut schema: ElicitationSchema,
    raw: Option<&Value>,
) -> ElicitationSchema {
    let raw_properties = raw
        .and_then(|raw| raw.get("properties"))
        .and_then(Value::as_object);
    let companions: Vec<(String, String)> = schema
        .properties
        .iter()
        .filter(|property| {
            // Only a free-text string can be a companion; a select never is.
            matches!(
                &property.schema,
                ElicitationPropertySchema::String { options, .. } if options.is_empty()
            )
        })
        .filter_map(|property| {
            let raw_property = raw_properties?.get(&property.name)?;
            let target = reader.custom_answer_for(&property.name, raw_property)?;
            Some((property.name.clone(), target))
        })
        .collect();

    for (companion, target) in &companions {
        let Some(select) = schema
            .properties
            .iter_mut()
            .find(|property| property.name == *target)
        else {
            continue;
        };
        let attached = match &mut select.schema {
            ElicitationPropertySchema::String {
                options,
                custom_field,
                ..
            } if !options.is_empty() => {
                *custom_field = Some(companion.clone());
                true
            }
            ElicitationPropertySchema::MultiSelect { custom_field, .. } => {
                *custom_field = Some(companion.clone());
                true
            }
            _ => false,
        };
        if !attached {
            continue;
        }
        schema
            .properties
            .retain(|property| property.name != *companion);
        if !schema.required.iter().any(|name| name == target) {
            schema.required.push(target.clone());
        }
        schema.required.retain(|name| name != companion);
    }
    schema
}

fn decode_property(
    name: &str,
    typed: &AcpPropertySchema,
    raw: Option<&Value>,
) -> ElicitationProperty {
    let (title, description, schema) = match typed {
        AcpPropertySchema::String(string) => (
            string.title.clone(),
            string.description.clone(),
            ElicitationPropertySchema::String {
                min_length: string.min_length,
                max_length: string.max_length,
                pattern: string.pattern.clone(),
                format: string
                    .format
                    .and_then(|format| serde_json::to_value(format).ok())
                    .and_then(|format| format.as_str().map(str::to_owned)),
                default: string.default.clone(),
                options: match (&string.one_of, &string.enum_values) {
                    (Some(titled), _) => titled.iter().map(titled_option).collect(),
                    (None, Some(values)) => {
                        values.iter().map(|value| untitled_option(value)).collect()
                    }
                    (None, None) => Vec::new(),
                },
                custom_field: None,
            },
        ),
        AcpPropertySchema::Number(number) => (
            number.title.clone(),
            number.description.clone(),
            ElicitationPropertySchema::Number {
                minimum: number.minimum,
                maximum: number.maximum,
                default: number.default,
            },
        ),
        AcpPropertySchema::Integer(integer) => (
            integer.title.clone(),
            integer.description.clone(),
            ElicitationPropertySchema::Integer {
                minimum: integer.minimum,
                maximum: integer.maximum,
                default: integer.default,
            },
        ),
        AcpPropertySchema::Boolean(boolean) => (
            boolean.title.clone(),
            boolean.description.clone(),
            ElicitationPropertySchema::Boolean {
                default: boolean.default,
            },
        ),
        AcpPropertySchema::Array(multi) => (
            multi.title.clone(),
            multi.description.clone(),
            ElicitationPropertySchema::MultiSelect {
                min_items: multi.min_items,
                max_items: multi.max_items,
                options: match &multi.items {
                    MultiSelectItems::String(items) => items
                        .values
                        .iter()
                        .map(|value| untitled_option(value))
                        .collect(),
                    MultiSelectItems::Titled(items) => {
                        items.options.iter().map(titled_option).collect()
                    }
                    // `Other`, or an item type ACP adds later: no choices this
                    // fold can offer.
                    _ => Vec::new(),
                },
                default: multi.default.clone().unwrap_or_default(),
                custom_field: None,
            },
        ),
        // `Other`, or a property type ACP adds later.
        _ => {
            let raw = raw.cloned().unwrap_or(Value::Null);
            let type_name = raw
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("<missing>")
                .to_owned();
            (
                raw.get("title").and_then(Value::as_str).map(str::to_owned),
                raw.get("description")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                ElicitationPropertySchema::Unrecognized { type_name, raw },
            )
        }
    };
    ElicitationProperty {
        name: name.to_owned(),
        title,
        description,
        schema,
    }
}

fn titled_option(option: &EnumOption) -> ElicitationOption {
    ElicitationOption {
        value: option.value.clone(),
        title: Some(option.title.clone()),
        description: option.description.clone(),
    }
}

fn untitled_option(value: &str) -> ElicitationOption {
    ElicitationOption {
        value: value.to_owned(),
        title: None,
        description: None,
    }
}

/// The form schema a request was asked with, when it has one.
fn schema_of(request: &ElicitationRequest) -> Option<&ElicitationSchema> {
    match request {
        ElicitationRequest::Form { schema } => Some(schema),
        ElicitationRequest::UserTool { schema, .. } => Some(schema),
        ElicitationRequest::Url { .. } | ElicitationRequest::Unrecognized { .. } => None,
    }
}

/// Shape submitted content against the schema that asked for it.
///
/// The schema's properties come first, in the order the agent declared them,
/// so a transcript reads in the order the form was filled; then any key no
/// property claimed, labelled by the key it arrived under. Properties the
/// content did not answer are skipped rather than rendered empty.
///
/// The "Other" idiom is resolved here: a non-blank value under a property's
/// `custom_field` wins over a choice under the property's own name, and
/// claims both keys. Real harnesses send both (see the
/// `elicitation_claude_single_select` fixture, where `question_0` is `"Red"`
/// and `question_0_custom` is `"blue"`, and Claude Code itself reports the
/// answer as `"blue"`).
fn shape_answers(
    schema: Option<&ElicitationSchema>,
    content: &BTreeMap<String, ElicitationContentValue>,
) -> Vec<AnsweredField> {
    let mut answers = Vec::new();
    let mut claimed: HashSet<&str> = HashSet::new();

    for property in schema
        .map(|schema| schema.properties.as_slice())
        .unwrap_or_default()
    {
        let label = property
            .title
            .clone()
            .unwrap_or_else(|| property.name.clone());
        claimed.insert(property.name.as_str());

        if let Some(key) = custom_field_of(&property.schema) {
            claimed.insert(key);
            if let Some(ElicitationContentValue::String(text)) = content.get(key)
                && !text.trim().is_empty()
            {
                answers.push(AnsweredField {
                    name: property.name.clone(),
                    label,
                    value: AnsweredValue::Custom { text: text.clone() },
                });
                continue;
            }
        }

        let Some(value) = content.get(&property.name) else {
            continue;
        };
        answers.push(AnsweredField {
            name: property.name.clone(),
            label,
            value: answered_value(Some(&property.schema), value),
        });
    }

    for (key, value) in content {
        if claimed.contains(key.as_str()) {
            continue;
        }
        answers.push(AnsweredField {
            name: key.clone(),
            label: key.clone(),
            value: answered_value(None, value),
        });
    }

    answers
}

/// The key a property's free-text escape arrives under, when it has one.
fn custom_field_of(schema: &ElicitationPropertySchema) -> Option<&str> {
    match schema {
        ElicitationPropertySchema::String { custom_field, .. }
        | ElicitationPropertySchema::MultiSelect { custom_field, .. } => custom_field.as_deref(),
        _ => None,
    }
}

/// One value, read through the property that asked for it when there is one:
/// that is what resolves a string to the option it names, and its title.
fn answered_value(
    schema: Option<&ElicitationPropertySchema>,
    value: &ElicitationContentValue,
) -> AnsweredValue {
    let options = match schema {
        Some(
            ElicitationPropertySchema::String { options, .. }
            | ElicitationPropertySchema::MultiSelect { options, .. },
        ) => options.as_slice(),
        _ => &[],
    };
    match value {
        ElicitationContentValue::String(text) if !options.is_empty() => AnsweredValue::Choice {
            choice: choice_for(options, text),
        },
        ElicitationContentValue::String(text) => AnsweredValue::Text { text: text.clone() },
        ElicitationContentValue::Integer(number) => AnsweredValue::Number {
            text: number.to_string(),
        },
        ElicitationContentValue::Number(number) => AnsweredValue::Number {
            text: number.to_string(),
        },
        ElicitationContentValue::Boolean(checked) => AnsweredValue::Boolean { checked: *checked },
        ElicitationContentValue::StringArray(values) => AnsweredValue::Choices {
            choices: values
                .iter()
                .map(|value| choice_for(options, value))
                .collect(),
        },
        // `#[non_exhaustive]`: a value kind ACP adds later.
        _ => AnsweredValue::Unrecognized {
            raw: serde_json::to_value(value).unwrap_or_default(),
        },
    }
}

/// A chosen value with the title it was offered under, or untitled when no
/// option declared it.
fn choice_for(options: &[ElicitationOption], value: &str) -> AnsweredChoice {
    AnsweredChoice {
        value: value.to_owned(),
        title: options
            .iter()
            .find(|option| option.value == value)
            .and_then(|option| option.title.clone()),
    }
}

/// Shape a harness's reported answer, which is keyed by question prose rather
/// than by schema property - so every entry is its own label, and the values
/// are read as plain JSON rather than through ACP's typed content.
fn shape_reported(reported: &Value) -> Option<Vec<AnsweredField>> {
    let object = reported.as_object()?;
    Some(
        object
            .iter()
            .map(|(key, value)| AnsweredField {
                name: key.clone(),
                label: key.clone(),
                value: reported_value(value),
            })
            .collect(),
    )
}

/// A reported value, narrowed to the shared vocabulary where it fits.
fn reported_value(value: &Value) -> AnsweredValue {
    match value {
        Value::String(text) => AnsweredValue::Text { text: text.clone() },
        Value::Bool(checked) => AnsweredValue::Boolean { checked: *checked },
        Value::Number(number) => AnsweredValue::Number {
            text: number.to_string(),
        },
        Value::Array(items) => items
            .iter()
            .map(|item| item.as_str().map(str::to_owned))
            .collect::<Option<Vec<_>>>()
            .map_or_else(
                || AnsweredValue::Unrecognized { raw: value.clone() },
                |values| AnsweredValue::Choices {
                    choices: values
                        .into_iter()
                        .map(|value| AnsweredChoice { value, title: None })
                        .collect(),
                },
            ),
        Value::Null | Value::Object(_) => AnsweredValue::Unrecognized { raw: value.clone() },
    }
}
