//! Notion's REST wire shapes, and how they flatten into the domain model.
//!
//! These differ from the domain types in kind, not just in derives: values
//! are tagged by a `type` field naming a sibling field, text is arrays of
//! rich-text runs, and absence is spelled several ways.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use indexmap::IndexMap;
use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::domain::model::{
    NotionDataSource, NotionFile, NotionId, NotionOption, NotionPage, NotionParent,
    NotionPropertyKind, NotionPropertySchema, NotionUser, NotionValue,
};

/// A paginated list; items stay raw so one odd item can be skipped.
#[derive(Deserialize)]
pub(super) struct WireList {
    #[serde(default)]
    pub results: Vec<serde_json::Value>,
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub has_more: bool,
    pub request_status: Option<WireRequestStatus>,
}

impl WireList {
    /// The cursor of the next page, when Notion says there is one.
    pub fn next(&self) -> Option<String> {
        self.next_cursor.clone().filter(|_| self.has_more)
    }

    /// Whether Notion stopped short of the full result (its 10,000 row cap).
    pub fn incomplete(&self) -> bool {
        self.request_status
            .as_ref()
            .is_some_and(|status| status.kind == "incomplete")
    }
}

#[derive(Deserialize)]
pub(super) struct WireRequestStatus {
    #[serde(rename = "type")]
    kind: String,
}

/// A search result.
#[derive(Deserialize)]
#[serde(tag = "object", rename_all = "snake_case")]
pub(super) enum WireObject {
    Page(WirePage),
    DataSource(WireDataSource),
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
pub(super) struct WirePage {
    pub id: NotionId,
    #[serde(default)]
    url: String,
    parent: WireParent,
    created_time: DateTime<Utc>,
    last_edited_time: DateTime<Utc>,
    #[serde(default)]
    in_trash: bool,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    pub properties: BTreeMap<String, WireProperty>,
}

#[derive(Deserialize)]
pub(super) struct WireProperty {
    pub id: String,
    #[serde(flatten)]
    pub value: WireValue,
}

/// A property value, tagged by `type` with the value in the field it names.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum WireValue {
    Title {
        #[serde(default)]
        title: Vec<WireText>,
    },
    RichText {
        #[serde(default)]
        rich_text: Vec<WireText>,
    },
    Number {
        number: Option<f64>,
    },
    Select {
        select: Option<WireName>,
    },
    Status {
        status: Option<WireName>,
    },
    MultiSelect {
        #[serde(default)]
        multi_select: Vec<WireName>,
    },
    Date {
        date: Option<WireDate>,
    },
    People {
        #[serde(default)]
        people: Vec<WireReference>,
        #[serde(default)]
        has_more: bool,
    },
    Files {
        #[serde(default)]
        files: Vec<WireFile>,
    },
    Checkbox {
        #[serde(default)]
        checkbox: bool,
    },
    Url {
        url: Option<String>,
    },
    Email {
        email: Option<String>,
    },
    PhoneNumber {
        phone_number: Option<String>,
    },
    Relation {
        #[serde(default)]
        relation: Vec<WireReference>,
        #[serde(default)]
        has_more: bool,
    },
    Formula {
        formula: WireFormula,
    },
    Rollup {
        rollup: WireRollup,
    },
    CreatedTime {
        created_time: String,
    },
    LastEditedTime {
        last_edited_time: String,
    },
    CreatedBy {
        created_by: WireReference,
    },
    LastEditedBy {
        last_edited_by: WireReference,
    },
    UniqueId {
        unique_id: WireUniqueId,
    },
    #[serde(other)]
    Unsupported,
}

impl WireValue {
    /// Whether Notion truncated this value's references (at 25).
    pub fn truncated(&self) -> bool {
        matches!(
            self,
            Self::People { has_more: true, .. } | Self::Relation { has_more: true, .. }
        )
    }
}

#[derive(Deserialize)]
pub(super) struct WireText {
    #[serde(default)]
    plain_text: String,
}

#[derive(Deserialize)]
pub(super) struct WireName {
    name: String,
}

#[derive(Deserialize)]
pub(super) struct WireDate {
    start: String,
    end: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct WireReference {
    pub id: NotionId,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum WireFile {
    File {
        #[serde(default)]
        name: String,
        file: WireHostedFile,
    },
    External {
        #[serde(default)]
        name: String,
        external: WireExternalFile,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
pub(super) struct WireHostedFile {
    url: String,
    expiry_time: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
pub(super) struct WireExternalFile {
    url: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum WireFormula {
    String {
        string: Option<String>,
    },
    Number {
        number: Option<f64>,
    },
    Boolean {
        boolean: Option<bool>,
    },
    Date {
        date: Option<WireDate>,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum WireRollup {
    Number {
        number: Option<f64>,
    },
    Date {
        date: Option<WireDate>,
    },
    Array {
        #[serde(default)]
        array: Vec<WireValue>,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
pub(super) struct WireUniqueId {
    number: Option<u64>,
    prefix: Option<String>,
}

/// One item of a paginated property-item list, for truncated references.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum WirePropertyItem {
    Relation {
        relation: WireReference,
    },
    People {
        people: WireReference,
    },
    #[serde(other)]
    Other,
}

impl WirePropertyItem {
    pub fn reference(self) -> Option<NotionId> {
        match self {
            Self::Relation { relation } => Some(relation.id),
            Self::People { people } => Some(people.id),
            Self::Other => None,
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum WireParent {
    PageId {
        page_id: NotionId,
    },
    DatabaseId {
        database_id: NotionId,
    },
    DataSourceId {
        data_source_id: NotionId,
        database_id: NotionId,
    },
    Workspace,
    BlockId {
        block_id: NotionId,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
pub(super) struct WireDataSource {
    id: NotionId,
    #[serde(default)]
    title: Vec<WireText>,
    parent: WireParent,
    database_parent: Option<WireParent>,
    #[serde(default)]
    in_trash: bool,
    #[serde(default)]
    archived: bool,
    #[serde(default)]
    properties: IndexMap<String, WireSchemaProperty>,
}

#[derive(Deserialize)]
struct WireSchemaProperty {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(flatten)]
    config: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize, Default)]
struct WireOptions {
    #[serde(default)]
    options: Vec<WireOption>,
}

#[derive(Deserialize)]
struct WireOption {
    #[serde(default)]
    id: String,
    name: String,
    #[serde(default)]
    color: String,
}

#[derive(Deserialize, Default)]
struct WireRelationConfig {
    data_source_id: Option<NotionId>,
}

#[derive(Deserialize, Default)]
struct WireUniqueIdConfig {
    prefix: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct WireDatabase {
    #[serde(default)]
    pub data_sources: Vec<WireReference>,
}

#[derive(Deserialize)]
pub(super) struct WireMarkdown {
    pub markdown: String,
    #[serde(default)]
    pub unknown_block_ids: Vec<NotionId>,
}

#[derive(Deserialize)]
pub(super) struct WireUser {
    id: NotionId,
    #[serde(rename = "type")]
    kind: Option<String>,
    name: Option<String>,
    person: Option<WirePerson>,
}

#[derive(Deserialize)]
struct WirePerson {
    email: Option<String>,
}

/// Notion's error body.
#[derive(Deserialize)]
pub(super) struct WireError {
    pub code: Option<String>,
    pub message: Option<String>,
}

impl From<WireParent> for NotionParent {
    fn from(parent: WireParent) -> Self {
        match parent {
            WireParent::PageId { page_id } => Self::Page { id: page_id },
            WireParent::DatabaseId { database_id } => Self::Database { id: database_id },
            WireParent::DataSourceId {
                data_source_id,
                database_id,
            } => Self::DataSource {
                data_source: data_source_id,
                database: database_id,
            },
            WireParent::Workspace => Self::Workspace,
            WireParent::BlockId { block_id } => Self::Block { id: block_id },
            WireParent::Other => Self::Other,
        }
    }
}

impl WirePage {
    /// The page, its title lifted out of the property values.
    pub fn into_page(self) -> NotionPage {
        let mut title = String::new();
        let mut properties = BTreeMap::new();
        for (name, property) in self.properties {
            match property.value {
                WireValue::Title { title: runs } => title = plain_text(&runs),
                value => {
                    properties.insert(name, value.into_value());
                }
            }
        }
        NotionPage {
            id: self.id,
            title,
            url: self.url,
            parent: self.parent.into(),
            last_edited: self.last_edited_time,
            created: self.created_time,
            in_trash: self.in_trash || self.archived,
            properties,
        }
    }
}

impl WireValue {
    pub fn into_value(self) -> NotionValue {
        match self {
            Self::Title { title: runs } | Self::RichText { rich_text: runs } => {
                non_empty(plain_text(&runs)).map_or(NotionValue::Empty, NotionValue::Text)
            }
            Self::Number { number } => number.map_or(NotionValue::Empty, NotionValue::Number),
            Self::Select { select: option } | Self::Status { status: option } => option
                .map_or(NotionValue::Empty, |option| {
                    NotionValue::Option(option.name)
                }),
            Self::MultiSelect { multi_select } if multi_select.is_empty() => NotionValue::Empty,
            Self::MultiSelect { multi_select } => {
                NotionValue::Options(multi_select.into_iter().map(|option| option.name).collect())
            }
            Self::Date { date } => date_value(date),
            Self::People { people, .. } if people.is_empty() => NotionValue::Empty,
            Self::People { people, .. } => {
                NotionValue::People(people.into_iter().map(|person| person.id).collect())
            }
            Self::Files { files } => {
                let files: Vec<NotionFile> = files.into_iter().filter_map(file).collect();
                if files.is_empty() {
                    NotionValue::Empty
                } else {
                    NotionValue::Files(files)
                }
            }
            Self::Checkbox { checkbox } => NotionValue::Checkbox(checkbox),
            Self::Url { url } => url
                .and_then(non_empty)
                .map_or(NotionValue::Empty, NotionValue::Url),
            Self::Email { email } => email
                .and_then(non_empty)
                .map_or(NotionValue::Empty, NotionValue::Email),
            Self::PhoneNumber { phone_number } => phone_number
                .and_then(non_empty)
                .map_or(NotionValue::Empty, NotionValue::Phone),
            Self::Relation { relation, .. } if relation.is_empty() => NotionValue::Empty,
            Self::Relation { relation, .. } => {
                NotionValue::Relation(relation.into_iter().map(|page| page.id).collect())
            }
            Self::Formula { formula } => match formula {
                WireFormula::String { string } => string
                    .and_then(non_empty)
                    .map_or(NotionValue::Empty, NotionValue::Text),
                WireFormula::Number { number } => {
                    number.map_or(NotionValue::Empty, NotionValue::Number)
                }
                WireFormula::Boolean { boolean } => {
                    boolean.map_or(NotionValue::Empty, NotionValue::Checkbox)
                }
                WireFormula::Date { date } => date_value(date),
                WireFormula::Other => NotionValue::Empty,
            },
            Self::Rollup { rollup } => match rollup {
                WireRollup::Number { number } => {
                    number.map_or(NotionValue::Empty, NotionValue::Number)
                }
                WireRollup::Date { date } => date_value(date),
                WireRollup::Array { array } => {
                    let values: Vec<NotionValue> = array
                        .into_iter()
                        .map(Self::into_value)
                        .filter(|value| *value != NotionValue::Empty)
                        .collect();
                    if values.is_empty() {
                        NotionValue::Empty
                    } else {
                        NotionValue::List(values)
                    }
                }
                WireRollup::Other => NotionValue::Empty,
            },
            Self::CreatedTime { created_time: time }
            | Self::LastEditedTime {
                last_edited_time: time,
            } => NotionValue::Timestamp(time),
            Self::CreatedBy { created_by: user }
            | Self::LastEditedBy {
                last_edited_by: user,
            } => NotionValue::People(vec![user.id]),
            Self::UniqueId { unique_id } => match (unique_id.number, unique_id.prefix) {
                (None, _) => NotionValue::Empty,
                (Some(number), Some(prefix)) if !prefix.is_empty() => {
                    NotionValue::UniqueId(format!("{prefix}-{number}"))
                }
                (Some(number), _) => NotionValue::UniqueId(number.to_string()),
            },
            Self::Unsupported => NotionValue::Empty,
        }
    }
}

impl WireDataSource {
    pub fn into_data_source(self) -> Result<NotionDataSource, String> {
        let WireParent::DatabaseId { database_id } = self.parent else {
            return Err(format!("data source {} is not under a database", self.id));
        };
        let properties = self
            .properties
            .into_values()
            .map(|property| {
                let kind = property_kind(&property.kind, &property.config)
                    .map_err(|error| format!("property {}: {error}", property.name))?;
                Ok(NotionPropertySchema {
                    id: property.id,
                    name: property.name,
                    kind,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(NotionDataSource {
            id: self.id,
            database_id,
            title: plain_text(&self.title),
            database_parent: self
                .database_parent
                .map_or(NotionParent::Other, NotionParent::from),
            in_trash: self.in_trash || self.archived,
            properties,
        })
    }
}

impl WireUser {
    /// The member, or `None` for a bot.
    pub fn into_user(self) -> Option<NotionUser> {
        if self.kind.as_deref() == Some("bot") {
            return None;
        }
        Some(NotionUser {
            id: self.id,
            name: self.name.and_then(non_empty),
            email: self
                .person
                .and_then(|person| person.email)
                .and_then(non_empty),
        })
    }
}

fn property_kind(
    kind: &str,
    config: &serde_json::Map<String, serde_json::Value>,
) -> Result<NotionPropertyKind, serde_json::Error> {
    Ok(match kind {
        "title" => NotionPropertyKind::Title,
        "rich_text" => NotionPropertyKind::RichText,
        "number" => NotionPropertyKind::Number,
        "select" => NotionPropertyKind::Select {
            options: options(config, kind)?,
        },
        "multi_select" => NotionPropertyKind::MultiSelect {
            options: options(config, kind)?,
        },
        "status" => NotionPropertyKind::Status {
            options: options(config, kind)?,
        },
        "date" => NotionPropertyKind::Date,
        "people" => NotionPropertyKind::People,
        "files" => NotionPropertyKind::Files,
        "checkbox" => NotionPropertyKind::Checkbox,
        "url" => NotionPropertyKind::Url,
        "email" => NotionPropertyKind::Email,
        "phone_number" => NotionPropertyKind::PhoneNumber,
        "formula" => NotionPropertyKind::Formula,
        "relation" => NotionPropertyKind::Relation {
            data_source_id: type_config::<WireRelationConfig>(config, kind)?.data_source_id,
        },
        "rollup" => NotionPropertyKind::Rollup,
        "created_time" => NotionPropertyKind::CreatedTime,
        "created_by" => NotionPropertyKind::CreatedBy,
        "last_edited_time" => NotionPropertyKind::LastEditedTime,
        "last_edited_by" => NotionPropertyKind::LastEditedBy,
        "unique_id" => NotionPropertyKind::UniqueId {
            prefix: type_config::<WireUniqueIdConfig>(config, kind)?
                .prefix
                .and_then(non_empty),
        },
        other => NotionPropertyKind::Unsupported {
            notion_type: other.to_owned(),
        },
    })
}

fn options(
    config: &serde_json::Map<String, serde_json::Value>,
    kind: &str,
) -> Result<Vec<NotionOption>, serde_json::Error> {
    Ok(type_config::<WireOptions>(config, kind)?
        .options
        .into_iter()
        .map(|option| NotionOption {
            id: option.id,
            name: option.name,
            color: option.color,
        })
        .collect())
}

/// The configuration object in the field named after the property's type.
fn type_config<Config: DeserializeOwned + Default>(
    config: &serde_json::Map<String, serde_json::Value>,
    kind: &str,
) -> Result<Config, serde_json::Error> {
    match config.get(kind) {
        None | Some(serde_json::Value::Null) => Ok(Config::default()),
        Some(value) => Config::deserialize(value),
    }
}

fn file(file: WireFile) -> Option<NotionFile> {
    match file {
        WireFile::File { name, file } => Some(NotionFile {
            name,
            url: file.url,
            expires: file.expiry_time,
        }),
        WireFile::External { name, external } => Some(NotionFile {
            name,
            url: external.url,
            expires: None,
        }),
        WireFile::Other => None,
    }
}

fn date_value(date: Option<WireDate>) -> NotionValue {
    date.map_or(NotionValue::Empty, |date| NotionValue::Date {
        start: date.start,
        end: date.end,
    })
}

fn plain_text(runs: &[WireText]) -> String {
    runs.iter().map(|run| run.plain_text.as_str()).collect()
}

fn non_empty(text: String) -> Option<String> {
    (!text.is_empty()).then_some(text)
}

#[cfg(test)]
mod test;
