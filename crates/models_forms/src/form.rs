//! A form's own facts, and the requests that create and change them.

use chrono::{DateTime, Utc};
use models_databases::{ColumnId, DatabaseId, TableId};
use serde::{Deserialize, Deserializer, Serialize};

use crate::ids::FormId;

/// Who may respond to a form.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    specta::Type,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "snake_case")]
pub enum Audience {
    /// Signed-in Macro users the form is shared with; one response each,
    /// editable while the form is open.
    Members,
    /// Anyone with the link. Anonymous visitors respond anonymously and
    /// without a limit; a signed-in visitor responds as themselves.
    Public,
}

/// Whether a form takes responses, as its owner set it. A form also stops
/// taking them once its closing time passes.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    specta::Type,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "snake_case")]
pub enum FormStatus {
    /// Taking responses.
    Open,
    /// Closed by its owner.
    Closed,
}

/// The caller's level on a form: view responds, edit changes questions and
/// reads responses, owner also sets the audience, closes and trashes it.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub enum FormAccess {
    /// May respond.
    View,
    /// May change the questions and read the responses.
    Edit,
    /// May also change who responds, close and trash the form.
    Owner,
}

/// A form: a view of one database table whose rows are its responses.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Form {
    /// The form.
    #[schema(value_type = Uuid)]
    pub id: FormId,
    /// Its display name. A standalone form follows the database it created;
    /// a form attached to an existing table has its own name.
    pub name: String,
    /// What respondents read under the name.
    pub description: String,
    /// Its owner.
    pub owner_id: String,
    /// The database holding its responses.
    #[schema(value_type = Uuid)]
    pub database_id: DatabaseId,
    /// The table whose rows are its responses.
    #[schema(value_type = Uuid)]
    pub table_id: TableId,
    /// The date column each submission stamps; `null` once deleted.
    #[schema(value_type = Option<Uuid>, required = true)]
    pub submitted_column_id: Option<ColumnId>,
    /// The person column each signed-in submission names its respondent in;
    /// `null` once deleted.
    #[schema(value_type = Option<Uuid>, required = true)]
    pub respondent_column_id: Option<ColumnId>,
    /// Who may respond.
    pub audience: Audience,
    /// Whether respondents may read option tallies.
    pub tally_visible: bool,
    /// Whether its owner closed it.
    pub status: FormStatus,
    /// When it stops taking responses, if it does.
    #[schema(required = true)]
    pub closes_at: Option<DateTime<Utc>>,
    /// What a respondent reads once their response is saved; empty for the
    /// default.
    pub confirmation_message: String,
    /// When it was created.
    pub created_at: DateTime<Utc>,
    /// When its facts or layout last changed.
    pub updated_at: DateTime<Utc>,
}

impl Form {
    /// Whether the form takes responses at `now`: open, and not past its
    /// closing time.
    pub fn accepts_responses_at(&self, now: DateTime<Utc>) -> bool {
        self.status == FormStatus::Open && self.closes_at.is_none_or(|closes_at| now < closes_at)
    }
}

/// A request to create a form.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateForm {
    /// Its name; a new database takes it too.
    pub name: String,
    /// Where its responses go.
    pub source: FormSource,
}

/// Where a new form's responses go.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FormSource {
    /// A new database named like the form, whose one table, "Responses",
    /// starts with only the form's own columns.
    New,
    /// An existing table in a database the caller owns. The form starts with a
    /// question per column.
    Table {
        /// The table's database.
        #[serde(rename = "databaseId")]
        #[schema(value_type = Uuid)]
        database_id: DatabaseId,
        /// The table.
        #[serde(rename = "tableId")]
        #[schema(value_type = Uuid)]
        table_id: TableId,
    },
}

/// A change to a form's facts; what is left out stays. The description and
/// confirmation message take edit, the rest owner. A form is renamed
/// through the entity mutation router.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(
    Debug, Clone, PartialEq, Default, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub struct UpdateForm {
    /// Its new description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    #[specta(optional)]
    pub description: Option<String>,
    /// Its new confirmation message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    #[specta(optional)]
    pub confirmation_message: Option<String>,
    /// Who may respond from now on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    #[specta(optional)]
    pub audience: Option<Audience>,
    /// Open or close it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    #[specta(optional)]
    pub status: Option<FormStatus>,
    /// When it stops taking responses, or `null` for never.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[schema(value_type = Option<DateTime<Utc>>)]
    #[specta(type = Option<DateTime<Utc>>, optional)]
    pub closes_at: Option<Option<DateTime<Utc>>>,
    /// Whether respondents may read option tallies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    #[specta(optional)]
    pub tally_visible: Option<bool>,
}

impl UpdateForm {
    /// Whether the change touches a fact only the owner may change.
    pub fn needs_owner(&self) -> bool {
        self.audience.is_some()
            || self.status.is_some()
            || self.closes_at.is_some()
            || self.tally_visible.is_some()
    }
}

/// A field that is `Some` whenever it is present, so `null` reads as
/// `Some(None)` and a missing one, by `default`, as `None`.
fn present<'de, Value, Input>(deserializer: Input) -> Result<Option<Value>, Input::Error>
where
    Value: Deserialize<'de>,
    Input: Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
}

/// A form the caller reaches through a grant, as the forms catalog lists
/// it, with the caller's level on it.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ListedForm {
    /// The form's facts.
    pub form: Form,
    /// The caller's level on it.
    pub access: FormAccess,
}
