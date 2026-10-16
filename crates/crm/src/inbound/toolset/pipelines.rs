//! Agent tools over CRM pipelines, in the CRM's own words: pipelines hold
//! entries, each entry tracks a company or contact, and fields such as Stage,
//! Owner and Revenue belong to the entry. Every tool is a thin adapter over
//! [`PipelineWorkflowService`], which resolves names and labels against the
//! pipeline's schema and writes through the pipeline's own access boundary.

mod add_to_pipeline;
mod create_pipeline;
mod edit_pipeline;
mod find_pipeline_entries;
mod list_pipelines;
mod remove_from_pipeline;
mod update_pipeline_entries;

#[cfg(test)]
mod test;

use std::collections::BTreeMap;
use std::sync::Arc;

use ai_toolset::{AsyncToolCollection, ToolCallError};
use bot_id::BotId;
use databases::domain::models::{DatabaseError, Viewer};
use entity_access::domain::models::{AccessError, AccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    pipeline_workflows::{
        FieldInput, FieldKind, FieldValue, NewField, NewFieldKind, PipelineEntryView,
        PipelineField, PipelineOverview, PipelineRecord, PipelineWorkflowService, WorkflowError,
    },
    pipelines::{PipelineError, PipelineRecordType, PipelineSharing},
};

pub use add_to_pipeline::{AddToPipeline, AddToPipelineResponse};
pub use create_pipeline::{CreatePipeline, CreatePipelineResponse};
pub use edit_pipeline::{EditPipeline, EditPipelineResponse};
pub use find_pipeline_entries::{FindPipelineEntries, FindPipelineEntriesResponse};
pub use list_pipelines::{ListPipelines, ListPipelinesResponse};
pub use remove_from_pipeline::{RemoveFromPipeline, RemoveFromPipelineResponse};
pub use update_pipeline_entries::{UpdatePipelineEntries, UpdatePipelineEntriesResponse};

/// The pipeline workflows and the agent the tools act as.
pub struct PipelineToolContext<Workflows> {
    /// Resolves names, authorizes and writes through the pipeline service.
    pub service: Arc<Workflows>,
    /// The agent acting for the requesting user; attribution only.
    pub actor: BotId,
}

impl<Workflows> Clone for PipelineToolContext<Workflows> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            actor: self.actor,
        }
    }
}

impl<Workflows> PipelineToolContext<Workflows> {
    /// The tools over `service`, acting as the Macro AI bot.
    pub fn new(service: Workflows) -> Self {
        Self {
            service: Arc::new(service),
            actor: bot_id::MACRO_AI_BOT_ID,
        }
    }

    /// The requesting user, with this context's agent acting for them.
    fn viewer(&self, user_id: MacroUserIdStr<'static>) -> Viewer {
        Viewer {
            user_id,
            acting_bot: Some(self.actor),
        }
    }
}

/// Every pipeline tool.
pub fn pipeline_toolset<Workflows: PipelineWorkflowService>()
-> AsyncToolCollection<PipelineToolContext<Workflows>> {
    AsyncToolCollection::new()
        .add_tool::<ListPipelines, PipelineToolContext<Workflows>>()
        .add_tool::<FindPipelineEntries, PipelineToolContext<Workflows>>()
        .add_tool::<AddToPipeline, PipelineToolContext<Workflows>>()
        .add_tool::<UpdatePipelineEntries, PipelineToolContext<Workflows>>()
        .add_tool::<RemoveFromPipeline, PipelineToolContext<Workflows>>()
        .add_tool::<CreatePipeline, PipelineToolContext<Workflows>>()
        .add_tool::<EditPipeline, PipelineToolContext<Workflows>>()
}

/// A field and the value to write or match, as text.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolFieldValue {
    /// The field's name.
    #[schemars(
        description = "The field's name exactly as ListPipelines shows it, e.g. \"Stage\", \"Owner\", \"Revenue\"."
    )]
    pub field: String,
    /// One value as text.
    #[schemars(
        description = "The value as text: a stage or other option label (\"Negotiation\"), a person as \"me\", an email or a macro| user id, a number (\"48000\"), true/false, or a date (\"2026-10-12\"). Omit both value and values to empty the field (or, in a filter, to match empty fields)."
    )]
    #[serde(default)]
    pub value: Option<String>,
    /// Several values.
    #[schemars(
        description = "Several values, for a field that holds several (tags, people). In a filter, an entry matches if it holds any of them, e.g. [\"Demo\", \"Trial\"] for either stage."
    )]
    #[serde(default)]
    pub values: Option<Vec<String>>,
}

impl ToolFieldValue {
    fn pair(&self) -> (String, FieldInput) {
        let input = match (&self.values, &self.value) {
            (Some(values), _) if !values.is_empty() => FieldInput::Many(values.clone()),
            (_, Some(value)) => FieldInput::One(value.clone()),
            _ => FieldInput::Clear,
        };
        (self.field.clone(), input)
    }
}

fn pairs(values: &[ToolFieldValue]) -> Vec<(String, FieldInput)> {
    values.iter().map(ToolFieldValue::pair).collect()
}

/// What a pipeline's entries track. Documented on the fields that use it: a
/// doc comment on a variant would turn the schema into `oneOf`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[expect(
    missing_docs,
    reason = "variant docs would make the tool schema a oneOf"
)]
pub enum ToolRecordType {
    Company,
    Contact,
}

impl From<PipelineRecordType> for ToolRecordType {
    fn from(value: PipelineRecordType) -> Self {
        match value {
            PipelineRecordType::Company => Self::Company,
            PipelineRecordType::Contact => Self::Contact,
        }
    }
}

impl From<ToolRecordType> for PipelineRecordType {
    fn from(value: ToolRecordType) -> Self {
        match value {
            ToolRecordType::Company => Self::Company,
            ToolRecordType::Contact => Self::Contact,
        }
    }
}

/// The type of a field to add. Documented on the fields that use it.
#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[expect(
    missing_docs,
    reason = "variant docs would make the tool schema a oneOf"
)]
pub enum ToolNewFieldType {
    Text,
    Number,
    Checkbox,
    Date,
    Link,
    Select,
    MultiSelect,
    Person,
    People,
}

impl From<ToolNewFieldType> for NewFieldKind {
    fn from(value: ToolNewFieldType) -> Self {
        match value {
            ToolNewFieldType::Text => Self::Text,
            ToolNewFieldType::Number => Self::Number,
            ToolNewFieldType::Checkbox => Self::Checkbox,
            ToolNewFieldType::Date => Self::Date,
            ToolNewFieldType::Link => Self::Link,
            ToolNewFieldType::Select => Self::Select,
            ToolNewFieldType::MultiSelect => Self::MultiSelect,
            ToolNewFieldType::Person => Self::Person,
            ToolNewFieldType::People => Self::People,
        }
    }
}

/// A field to add to a pipeline.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolNewField {
    /// Its name.
    #[schemars(description = "The new field's name, unique in the pipeline.")]
    pub name: String,
    /// Its type.
    #[schemars(
        description = "text, number, checkbox, date, link, select (one label from a list, like a stage or priority), multi_select (several labels), person (one Macro user) or people (several)."
    )]
    #[serde(rename = "type")]
    pub field_type: ToolNewFieldType,
    /// A select field's options.
    #[schemars(description = "For select and multi_select: the labels to choose from, in order.")]
    #[serde(default)]
    pub options: Vec<String>,
}

impl From<&ToolNewField> for NewField {
    fn from(field: &ToolNewField) -> Self {
        Self {
            name: field.name.clone(),
            kind: field.field_type.into(),
            options: field.options.clone(),
        }
    }
}

/// What a field holds, as the model reads it.
#[derive(Debug, Clone, Copy, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolFieldType {
    /// The company the entry tracks.
    Company,
    /// The contact the entry tracks.
    Contact,
    /// Free text.
    Text,
    /// A number.
    Number,
    /// True or false.
    Checkbox,
    /// A date-time.
    Date,
    /// URLs.
    Link,
    /// Labels from `options`, such as a stage.
    Select,
    /// Tags.
    Tags,
    /// Macro users, written as "me", an email or a macro| id.
    Person,
    /// Ids of other Macro items.
    Item,
    /// Linked rows; read-only here.
    Relation,
    /// Computed; read-only.
    Formula,
}

impl From<FieldKind> for ToolFieldType {
    fn from(kind: FieldKind) -> Self {
        match kind {
            FieldKind::Record(PipelineRecordType::Company) => Self::Company,
            FieldKind::Record(PipelineRecordType::Contact) => Self::Contact,
            FieldKind::Text => Self::Text,
            FieldKind::Number => Self::Number,
            FieldKind::Checkbox => Self::Checkbox,
            FieldKind::Date => Self::Date,
            FieldKind::Link => Self::Link,
            FieldKind::Select => Self::Select,
            FieldKind::Tags => Self::Tags,
            FieldKind::Person => Self::Person,
            FieldKind::Entity(_) => Self::Item,
            FieldKind::Relation => Self::Relation,
            FieldKind::Formula => Self::Formula,
        }
    }
}

/// One field of a pipeline.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolField {
    /// The name to use in `field`.
    pub name: String,
    /// What it holds.
    #[serde(rename = "type")]
    pub field_type: ToolFieldType,
    /// Whether it holds several values.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub multiple: bool,
    /// For a select field, its labels in order: for Stage, the pipeline's
    /// stages from first to last.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    /// Whether every entry must have a value.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub required: bool,
    /// Whether the user cannot write it.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub read_only: bool,
}

impl From<&PipelineField> for ToolField {
    fn from(field: &PipelineField) -> Self {
        Self {
            name: field.name.clone(),
            field_type: field.kind.into(),
            multiple: field.multiple,
            options: field
                .options
                .iter()
                .map(|(_, label)| label.clone())
                .collect(),
            required: field.required,
            read_only: !field.writable,
        }
    }
}

/// What the user may do with a pipeline.
#[derive(Debug, Clone, Copy, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolPipelineAccess {
    /// Read its entries.
    View,
    /// Add, change and remove entries, and change its fields.
    Edit,
    /// Edit, and change who it is shared with.
    Owner,
}

/// A pipeline as the model sees it.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolPipeline {
    /// Pass as `pipelineId`.
    pub id: Uuid,
    /// Its name.
    pub name: String,
    /// What each entry tracks: `company` or `contact`.
    pub tracks: ToolRecordType,
    /// What the user may do with it.
    pub access: ToolPipelineAccess,
    /// Whether the owner's team may edit it; otherwise it is private.
    pub shared_with_team: bool,
    /// Its fields in column order; the first names the tracked record.
    pub fields: Vec<ToolField>,
    /// Its version now; pass as `baseVersion` to refuse an update if the
    /// pipeline changed in between.
    pub version: i64,
}

impl From<&PipelineOverview> for ToolPipeline {
    fn from(overview: &PipelineOverview) -> Self {
        let pipeline = &overview.pipeline.pipeline;
        Self {
            id: pipeline.id,
            name: pipeline.name.clone(),
            tracks: pipeline.record_type.into(),
            access: match overview.pipeline.grant {
                AccessLevel::View | AccessLevel::Comment => ToolPipelineAccess::View,
                AccessLevel::Edit => ToolPipelineAccess::Edit,
                AccessLevel::Owner => ToolPipelineAccess::Owner,
            },
            shared_with_team: pipeline.sharing == PipelineSharing::Team,
            fields: overview.fields.iter().map(ToolField::from).collect(),
            version: overview.version.0,
        }
    }
}

/// The company or contact an entry tracks.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolRecord {
    /// The CRM company or contact id.
    pub id: Uuid,
    /// Its name; missing when the user cannot see the record.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// A company's domain or a contact's email.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl From<&PipelineRecord> for ToolRecord {
    fn from(record: &PipelineRecord) -> Self {
        Self {
            id: record.id,
            name: record.name.clone(),
            detail: record.detail.clone(),
        }
    }
}

/// One pipeline entry.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntry {
    /// Pass as `entryId`.
    pub entry_id: Uuid,
    /// The company or contact it tracks.
    pub record: ToolRecord,
    /// Its filled-in fields by name: text, a number, true/false, a date, or a
    /// list when a field holds several values. People are macro| user ids.
    pub fields: BTreeMap<String, serde_json::Value>,
}

impl From<&PipelineEntryView> for ToolEntry {
    fn from(entry: &PipelineEntryView) -> Self {
        Self {
            entry_id: entry.entry_id.into_uuid(),
            record: (&entry.record).into(),
            fields: entry
                .fields
                .iter()
                .map(|(name, value)| (name.clone(), json(value)))
                .collect(),
        }
    }
}

/// A field value as JSON: one value plainly, several as a list.
pub(crate) fn json(value: &FieldValue) -> serde_json::Value {
    use serde_json::Value;
    let many = |values: &[String]| match values {
        [one] => Value::String(one.clone()),
        values => Value::from(values.to_vec()),
    };
    match value {
        FieldValue::Text(text) => Value::String(text.clone()),
        FieldValue::Number(number) => {
            serde_json::Number::from_f64(*number).map_or(Value::Null, Value::Number)
        }
        FieldValue::Checkbox(checked) => Value::Bool(*checked),
        FieldValue::Date(date) => Value::String(date.to_rfc3339()),
        FieldValue::Labels(values) | FieldValue::Links(values) | FieldValue::References(values) => {
            many(values)
        }
    }
}

/// The record a summary line names.
pub(crate) fn record_name(record: &ToolRecord) -> String {
    record
        .name
        .clone()
        .or_else(|| record.detail.clone())
        .unwrap_or_else(|| record.id.to_string())
}

/// A workflow failure in words the model can act on.
pub(crate) fn workflow_error(error: WorkflowError) -> ToolCallError {
    let description = match &error {
        WorkflowError::Invalid(message) => message.clone(),
        WorkflowError::NoTeam => {
            "The user is not in a team, so they have no CRM pipelines.".to_owned()
        }
        WorkflowError::Pipeline(PipelineError::NotFound)
        | WorkflowError::Access(AccessError::NotFound(_))
        | WorkflowError::Pipeline(PipelineError::Access(AccessError::NotFound(_))) => {
            "No pipeline with that id exists for this user. Call ListPipelines for the user's \
             pipelines and their ids."
                .to_owned()
        }
        WorkflowError::Access(
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_),
        )
        | WorkflowError::Pipeline(PipelineError::Access(
            AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_),
        )) => "The user does not have permission to do that to this pipeline. Reading needs view \
               access; changing entries or fields needs edit access."
            .to_owned(),
        WorkflowError::Access(AccessError::Unavailable(_))
        | WorkflowError::Pipeline(PipelineError::Access(AccessError::Unavailable(_))) => {
            "Access to the pipeline could not be checked right now. Retry the call.".to_owned()
        }
        WorkflowError::Pipeline(PipelineError::Invalid(message)) => (*message).to_owned(),
        WorkflowError::Pipeline(PipelineError::Database(DatabaseError::VersionConflict)) => {
            "The pipeline changed since it was read, so nothing was written. Read the entries \
             again with FindPipelineEntries and retry with its version."
                .to_owned()
        }
        WorkflowError::Pipeline(PipelineError::Database(
            refusal @ (DatabaseError::InvalidOp(_)
            | DatabaseError::InvalidSchemaOperation(_)
            | DatabaseError::OptionInUse
            | DatabaseError::RowInUse),
        )) => format!("The change was refused, so nothing changed: {refusal}."),
        WorkflowError::Pipeline(PipelineError::Crm(error)) | WorkflowError::Crm(error) => {
            super::crm_error_description(error)
        }
        _ => "The CRM pipeline service failed.".to_owned(),
    };
    ToolCallError {
        description,
        internal_error: anyhow::Error::new(error),
    }
}
