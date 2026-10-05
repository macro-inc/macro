//! A form's layout as a Loro document, so several editors can change it at
//! once and merge without losing each other's edits.

mod repair;
#[cfg(test)]
mod test;

use std::collections::{BTreeMap, HashMap, HashSet};

use loro::{
    Container, ExportMode, LoroDoc, LoroMap, LoroMovableList, LoroText, LoroValue, UpdateOptions,
    ValueOrContainer, VersionVector,
};
use models_forms::{FormLayout, FormQuestionId, FormSection, FormSectionId, FormSectionKind};
use serde_json::{Map as JsonMap, Value as JsonValue};

/// The schema format this module reads and writes.
pub const FORMAT_VERSION: i64 = 1;

/// The largest snapshot or update accepted, in bytes.
pub const MAXIMUM_DOCUMENT_BYTES: usize = 4 * 1024 * 1024;

/// The largest encoded revision accepted, in bytes.
pub const MAXIMUM_REVISION_BYTES: usize = 64 * 1024;

/// The map holding [`FORMAT_KEY`].
pub const METADATA: &str = "metadata";
/// The schema format's key in [`METADATA`].
pub const FORMAT_KEY: &str = "format";
/// The movable list of section ids, in order.
pub const SECTION_ORDER: &str = "sectionOrder";
/// The map from section id to the section's fields.
pub const SECTIONS: &str = "sections";
/// The map from section id to the movable list of its question ids.
pub const QUESTION_ORDERS: &str = "questionOrders";
/// The map from question id to the question's fields.
pub const QUESTIONS: &str = "questions";

/// A section's kind, a plain string.
pub const KIND: &str = "kind";
/// The section fields held as rich text; every other field but [`KIND`] is
/// a JSON string.
pub const SECTION_TEXT_FIELDS: [&str; 3] = ["title", "description", "message"];
/// A question's section, a plain string; the one source of its parent.
pub const SECTION_ID: &str = "sectionId";
/// The question field held as rich text; every other question field is a
/// plain value.
pub const HELP_TEXT: &str = "helpText";

const ID: &str = "id";
const QUESTIONS_FIELD: &str = "questions";

/// A layout read from a document, with the version it was read at.
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedLayoutDraft {
    /// The layout.
    pub layout: FormLayout,
    /// The document's encoded version vector.
    pub revision: Vec<u8>,
}

/// The edit that turns a document's layout into another.
#[derive(Debug, Clone, PartialEq)]
pub struct LayoutDraftUpdate {
    /// The version the edit was made against.
    pub expected_revision: Vec<u8>,
    /// The Loro update holding only the changed fields.
    pub update: Vec<u8>,
}

/// Why a layout document could not be read or written.
#[derive(Debug, thiserror::Error)]
pub enum LayoutDraftError {
    /// The input is larger than [`MAXIMUM_DOCUMENT_BYTES`].
    #[error("the document is {length} bytes, over the {maximum}-byte limit")]
    TooLarge {
        /// Its length.
        length: usize,
        /// The limit.
        maximum: usize,
    },
    /// Loro could not decode the bytes.
    #[error("the bytes are not a Loro document")]
    Decode(#[source] loro::LoroError),
    /// The bytes depend on changes that are not in them.
    #[error("the document depends on changes it does not hold")]
    IncompleteHistory,
    /// Loro could not encode the document.
    #[error("the document could not be exported")]
    Encode(#[source] loro::LoroEncodeError),
    /// Loro refused an edit.
    #[error("the document refused an edit")]
    Edit(#[source] loro::LoroError),
    /// The document names no schema format.
    #[error("the document names no schema format")]
    MissingFormat,
    /// The document's schema format is not [`FORMAT_VERSION`].
    #[error("the document's schema format {0} is not supported")]
    UnsupportedFormat(String),
    /// A value in the document has the wrong shape.
    #[error("{location} should be {expected}")]
    Malformed {
        /// Where, as a path of keys.
        location: String,
        /// What it should be.
        expected: &'static str,
    },
    /// A JSON field of the document does not parse.
    #[error("{location} is not JSON")]
    InvalidJson {
        /// Where, as a path of keys.
        location: String,
        /// Why.
        #[source]
        source: serde_json::Error,
    },
    /// A section read from the document is not a layout section.
    #[error("section {section} is not a layout section")]
    InvalidSection {
        /// The section's key.
        section: String,
        /// Why.
        #[source]
        source: serde_json::Error,
    },
    /// The layout names one section twice.
    #[error("section {0:?} appears twice")]
    DuplicateSection(FormSectionId),
    /// The layout names one question twice.
    #[error("question {0:?} appears twice")]
    DuplicateQuestion(FormQuestionId),
    /// The revision is not an encoded version vector.
    #[error("the revision is not a Loro version")]
    Revision(#[source] loro::LoroError),
    /// Loro gave up diffing a text.
    #[error("a text could not be diffed")]
    TextDiff(#[source] loro::UpdateTimeoutError),
}

/// A section as the document stores it: its kind, its fields but the
/// questions, and its questions if it is the kind that holds them.
#[derive(Debug, Clone, PartialEq)]
struct SectionRecord {
    id: String,
    kind: String,
    fields: BTreeMap<String, JsonValue>,
    questions: Option<Vec<QuestionRecord>>,
}

/// A question as the document stores it, without its section.
#[derive(Debug, Clone, PartialEq)]
struct QuestionRecord {
    id: String,
    fields: BTreeMap<String, JsonValue>,
}

/// A new document holding `layout`.
pub fn seed_layout(layout: &FormLayout) -> Result<Vec<u8>, LayoutDraftError> {
    let next = section_records(layout)?;
    let document = LoroDoc::new();
    document
        .get_map(METADATA)
        .insert(FORMAT_KEY, FORMAT_VERSION)
        .map_err(LayoutDraftError::Edit)?;
    apply_records(&document, &[], &next)?;
    document.commit();
    document
        .export(ExportMode::Snapshot)
        .map_err(LayoutDraftError::Encode)
}

/// The layout a snapshot holds, and its revision.
pub fn read_layout(snapshot: &[u8]) -> Result<DecodedLayoutDraft, LayoutDraftError> {
    let document = load(snapshot)?;
    let layout = layout_from_records(read_records(&document)?)?;
    Ok(DecodedLayoutDraft {
        layout,
        revision: document.oplog_vv().encode(),
    })
}

/// The update that turns the snapshot's layout into `layout`, touching only
/// what differs. A document with records that cannot be read, or in another
/// format, is repaired in the same history: the unreadable records are
/// rewritten from `layout`, and the readable ones are diffed as usual.
pub fn replace_layout(
    snapshot: &[u8],
    layout: &FormLayout,
) -> Result<LayoutDraftUpdate, LayoutDraftError> {
    replace_in(load(snapshot)?, layout)
}

fn replace_in(
    document: LoroDoc,
    layout: &FormLayout,
) -> Result<LayoutDraftUpdate, LayoutDraftError> {
    let next = section_records(layout)?;
    let expected = document.oplog_vv();
    let previous = match read_records(&document).and_then(layout_from_records) {
        // Diffed as the layout models it, so fields it does not model are kept.
        Ok(previous) => section_records(&previous)?,
        Err(
            LayoutDraftError::MissingFormat
            | LayoutDraftError::UnsupportedFormat(_)
            | LayoutDraftError::Malformed { .. }
            | LayoutDraftError::InvalidJson { .. }
            | LayoutDraftError::InvalidSection { .. },
        ) => repair::clear_unreadable(&document)?,
        Err(error) => return Err(error),
    };
    apply_records(&document, &previous, &next)?;
    document.commit();
    let update = document
        .export(ExportMode::updates(&expected))
        .map_err(LayoutDraftError::Encode)?;
    Ok(LayoutDraftUpdate {
        expected_revision: expected.encode(),
        update,
    })
}

/// Whether the `candidate` revision holds every change of `prior`.
pub fn revision_includes(candidate: &[u8], prior: &[u8]) -> Result<bool, LayoutDraftError> {
    let candidate = decode_revision(candidate)?;
    let prior = decode_revision(prior)?;
    Ok(candidate.includes_vv(&prior))
}

/// Revision equality is semantic: Loro's encoded map order is not canonical.
pub fn revision_matches(left: &[u8], right: &[u8]) -> Result<bool, LayoutDraftError> {
    Ok(decode_revision(left)? == decode_revision(right)?)
}

fn decode_revision(revision: &[u8]) -> Result<VersionVector, LayoutDraftError> {
    if revision.len() > MAXIMUM_REVISION_BYTES {
        return Err(LayoutDraftError::TooLarge {
            length: revision.len(),
            maximum: MAXIMUM_REVISION_BYTES,
        });
    }
    VersionVector::decode(revision).map_err(LayoutDraftError::Revision)
}

fn load(bytes: &[u8]) -> Result<LoroDoc, LayoutDraftError> {
    if bytes.len() > MAXIMUM_DOCUMENT_BYTES {
        return Err(LayoutDraftError::TooLarge {
            length: bytes.len(),
            maximum: MAXIMUM_DOCUMENT_BYTES,
        });
    }
    let document = LoroDoc::new();
    let status = document.import(bytes).map_err(LayoutDraftError::Decode)?;
    if status.pending.is_some() {
        return Err(LayoutDraftError::IncompleteHistory);
    }
    Ok(document)
}

fn section_records(layout: &FormLayout) -> Result<Vec<SectionRecord>, LayoutDraftError> {
    let mut section_ids = HashSet::new();
    let mut question_ids = HashSet::new();
    let mut records = Vec::with_capacity(layout.sections.len());
    for section in &layout.sections {
        let section_id = section.id();
        if !section_ids.insert(section_id) {
            return Err(LayoutDraftError::DuplicateSection(section_id));
        }
        let id = section_id.as_uuid().to_string();
        let location = format!("layout.sections.{id}");
        let JsonValue::Object(mut fields) = to_json(section, &location)? else {
            return Err(malformed(location, "an object"));
        };
        fields.remove(ID);
        let kind = match fields.remove(KIND) {
            Some(JsonValue::String(kind)) => kind,
            _ => return Err(malformed(format!("{location}.{KIND}"), "a string")),
        };
        let questions = match fields.remove(QUESTIONS_FIELD) {
            None => None,
            Some(JsonValue::Array(questions)) => Some(
                questions
                    .into_iter()
                    .map(|question| question_record(question, &location, &mut question_ids))
                    .collect::<Result<Vec<_>, _>>()?,
            ),
            Some(_) => return Err(malformed(format!("{location}.{QUESTIONS_FIELD}"), "a list")),
        };
        records.push(SectionRecord {
            id,
            kind,
            fields: fields.into_iter().collect(),
            questions,
        });
    }
    Ok(records)
}

fn question_record(
    question: JsonValue,
    section_location: &str,
    question_ids: &mut HashSet<FormQuestionId>,
) -> Result<QuestionRecord, LayoutDraftError> {
    let location = format!("{section_location}.{QUESTIONS_FIELD}");
    let JsonValue::Object(mut fields) = question else {
        return Err(malformed(location, "an object"));
    };
    let id = fields
        .remove(ID)
        .ok_or_else(|| malformed(format!("{location}.{ID}"), "a question id"))?;
    let question_id: FormQuestionId =
        serde_json::from_value(id).map_err(|source| LayoutDraftError::InvalidJson {
            location: format!("{location}.{ID}"),
            source,
        })?;
    if !question_ids.insert(question_id) {
        return Err(LayoutDraftError::DuplicateQuestion(question_id));
    }
    Ok(QuestionRecord {
        id: question_id.as_uuid().to_string(),
        fields: fields.into_iter().collect(),
    })
}

fn layout_from_records(records: Vec<SectionRecord>) -> Result<FormLayout, LayoutDraftError> {
    let sections = records
        .into_iter()
        .map(|record| {
            let mut object: JsonMap<String, JsonValue> = record.fields.into_iter().collect();
            object.insert(ID.to_owned(), JsonValue::String(record.id.clone()));
            object.insert(KIND.to_owned(), JsonValue::String(record.kind));
            if let Some(questions) = record.questions {
                let questions = questions
                    .into_iter()
                    .map(|question| {
                        let mut object: JsonMap<String, JsonValue> =
                            question.fields.into_iter().collect();
                        object.insert(ID.to_owned(), JsonValue::String(question.id));
                        JsonValue::Object(object)
                    })
                    .collect();
                object.insert(QUESTIONS_FIELD.to_owned(), JsonValue::Array(questions));
            }
            serde_json::from_value::<FormSection>(JsonValue::Object(object)).map_err(|source| {
                LayoutDraftError::InvalidSection {
                    section: record.id,
                    source,
                }
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(FormLayout { sections })
}

/// The document's sections in order. Order lists are read for position
/// only: membership in the `sections` and `questions` maps decides what
/// exists, and a question's `sectionId` decides where it lives. An id an
/// order repeats counts once, at its first place; one it lacks comes last,
/// by id. A question whose section is gone is left out. Booking steps come
/// last whatever their stored place, so concurrent inserts cannot put a
/// section after one; two concurrent booking steps are both read, for an
/// editor to remove one.
fn read_records(document: &LoroDoc) -> Result<Vec<SectionRecord>, LayoutDraftError> {
    check_format(document)?;
    let sections = document.get_map(SECTIONS);
    let question_orders = document.get_map(QUESTION_ORDERS);

    let mut questions_by_section: HashMap<String, HashMap<String, QuestionRecord>> = HashMap::new();
    let questions = document.get_map(QUESTIONS);
    for key in questions.keys() {
        let id = key.to_string();
        let location = format!("{QUESTIONS}.{id}");
        let Some(map) = child_map(&questions, &id, &location)? else {
            continue;
        };
        let (section_id, record) = read_question(&map, id.clone(), &location)?;
        questions_by_section
            .entry(section_id)
            .or_default()
            .insert(id, record);
    }

    let section_keys = keys(&sections);
    let section_ids = ordered_ids(
        &document.get_movable_list(SECTION_ORDER),
        SECTION_ORDER,
        "a section id",
        &section_keys,
    )?;
    let mut records = section_ids
        .into_iter()
        .map(|id| {
            let members = questions_by_section.remove(&id).unwrap_or_default();
            read_section_with_questions(&sections, &question_orders, &id, members)
        })
        .collect::<Result<Vec<_>, _>>()?;
    records.sort_by_key(is_booking);
    Ok(records)
}

fn is_booking(record: &SectionRecord) -> bool {
    record.kind == FormSectionKind::Booking.as_ref()
}

/// The section under `id` with its questions, from `members`, in order.
fn read_section_with_questions(
    sections: &LoroMap,
    question_orders: &LoroMap,
    id: &str,
    mut members: HashMap<String, QuestionRecord>,
) -> Result<SectionRecord, LayoutDraftError> {
    let location = format!("{SECTIONS}.{id}");
    let Some(map) = child_map(sections, id, &location)? else {
        return Err(malformed(location, "a map"));
    };
    let mut record = read_section(&map, id.to_owned(), &location)?;
    let order_location = format!("{QUESTION_ORDERS}.{id}");
    if let Some(order) = child_movable_list(question_orders, id, &order_location)? {
        let member_ids: Vec<String> = members.keys().cloned().collect();
        let order = ordered_ids(&order, &order_location, "a question id", &member_ids)?;
        record.questions = Some(
            order
                .into_iter()
                .filter_map(|question_id| members.remove(&question_id))
                .collect(),
        );
    }
    Ok(record)
}

fn keys(map: &LoroMap) -> Vec<String> {
    map.keys().map(|key| key.to_string()).collect()
}

fn check_format(document: &LoroDoc) -> Result<(), LayoutDraftError> {
    match document.get_map(METADATA).get(FORMAT_KEY) {
        None => Err(LayoutDraftError::MissingFormat),
        Some(ValueOrContainer::Value(LoroValue::I64(format))) if format == FORMAT_VERSION => Ok(()),
        // Loro's JavaScript binding stores every number as a double.
        Some(ValueOrContainer::Value(LoroValue::Double(format)))
            if format == FORMAT_VERSION as f64 =>
        {
            Ok(())
        }
        Some(ValueOrContainer::Value(LoroValue::I64(format))) => {
            Err(LayoutDraftError::UnsupportedFormat(format.to_string()))
        }
        Some(ValueOrContainer::Value(LoroValue::Double(format))) => {
            Err(LayoutDraftError::UnsupportedFormat(format.to_string()))
        }
        Some(_) => Err(malformed(format!("{METADATA}.{FORMAT_KEY}"), "a number")),
    }
}

/// The ids `order` lists that are among `members`, first places first, then
/// the members it lacks by id.
fn ordered_ids(
    order: &LoroMovableList,
    location: &str,
    expected: &'static str,
    members: &[String],
) -> Result<Vec<String>, LayoutDraftError> {
    let members: HashSet<&str> = members.iter().map(String::as_str).collect();
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    for index in 0..order.len() {
        let id = match order.get(index) {
            Some(ValueOrContainer::Value(LoroValue::String(id))) => id.to_string(),
            _ => return Err(malformed(format!("{location}.{index}"), expected)),
        };
        if members.contains(id.as_str()) && seen.insert(id.clone()) {
            ids.push(id);
        }
    }
    let mut unordered: Vec<String> = members
        .into_iter()
        .filter(|id| !seen.contains(*id))
        .map(str::to_owned)
        .collect();
    unordered.sort();
    ids.extend(unordered);
    Ok(ids)
}

fn read_section(
    map: &LoroMap,
    id: String,
    location: &str,
) -> Result<SectionRecord, LayoutDraftError> {
    let kind = match map.get(KIND) {
        Some(ValueOrContainer::Value(LoroValue::String(kind))) => kind.to_string(),
        _ => return Err(malformed(format!("{location}.{KIND}"), "a string")),
    };
    let mut fields = BTreeMap::new();
    for key in map.keys() {
        let key = key.to_string();
        if key == KIND {
            continue;
        }
        let field_location = format!("{location}.{key}");
        let value = if SECTION_TEXT_FIELDS.contains(&key.as_str()) {
            match map.get(&key) {
                Some(ValueOrContainer::Container(Container::Text(text))) => {
                    JsonValue::String(text.to_string())
                }
                _ => return Err(malformed(field_location, "text")),
            }
        } else {
            match map.get(&key) {
                Some(ValueOrContainer::Value(LoroValue::String(json))) => {
                    serde_json::from_str(&json).map_err(|source| LayoutDraftError::InvalidJson {
                        location: field_location,
                        source,
                    })?
                }
                _ => return Err(malformed(field_location, "a JSON string")),
            }
        };
        fields.insert(key, value);
    }
    Ok(SectionRecord {
        id,
        kind,
        fields,
        questions: None,
    })
}

fn read_question(
    map: &LoroMap,
    id: String,
    location: &str,
) -> Result<(String, QuestionRecord), LayoutDraftError> {
    let section_id = match map.get(SECTION_ID) {
        Some(ValueOrContainer::Value(LoroValue::String(section_id))) => section_id.to_string(),
        _ => {
            return Err(malformed(
                format!("{location}.{SECTION_ID}"),
                "a section id",
            ));
        }
    };
    let mut fields = BTreeMap::new();
    for key in map.keys() {
        let key = key.to_string();
        if key == SECTION_ID {
            continue;
        }
        let field_location = format!("{location}.{key}");
        let value = match (key.as_str(), map.get(&key)) {
            (HELP_TEXT, Some(ValueOrContainer::Container(Container::Text(text)))) => {
                JsonValue::String(text.to_string())
            }
            (HELP_TEXT, _) => return Err(malformed(field_location, "text")),
            (_, Some(ValueOrContainer::Value(value))) => plain_json(value)
                .ok_or_else(|| malformed(field_location.clone(), "a plain value"))?,
            (_, _) => return Err(malformed(field_location, "a plain value")),
        };
        fields.insert(key, value);
    }
    Ok((section_id, QuestionRecord { id, fields }))
}

fn plain_json(value: LoroValue) -> Option<JsonValue> {
    match value {
        LoroValue::Null => Some(JsonValue::Null),
        LoroValue::Bool(value) => Some(JsonValue::Bool(value)),
        LoroValue::I64(value) => Some(JsonValue::from(value)),
        LoroValue::Double(value) => serde_json::Number::from_f64(value).map(JsonValue::Number),
        LoroValue::String(value) => Some(JsonValue::String(value.to_string())),
        LoroValue::Binary(_) | LoroValue::List(_) | LoroValue::Map(_) | LoroValue::Container(_) => {
            None
        }
    }
}

fn plain_loro(value: &JsonValue, location: &str) -> Result<LoroValue, LayoutDraftError> {
    match value {
        JsonValue::Null => Ok(LoroValue::Null),
        JsonValue::Bool(value) => Ok(LoroValue::Bool(*value)),
        JsonValue::String(value) => Ok(LoroValue::from(value.as_str())),
        JsonValue::Number(number) => match (number.as_i64(), number.as_f64()) {
            (Some(integer), _) => Ok(LoroValue::I64(integer)),
            (None, Some(double)) => Ok(LoroValue::Double(double)),
            (None, None) => Err(malformed(location.to_owned(), "a plain value")),
        },
        JsonValue::Array(_) | JsonValue::Object(_) => {
            Err(malformed(location.to_owned(), "a plain value"))
        }
    }
}

/// Writes the edits from `previous` to `next` into `document`. Whatever the
/// two agree on is left alone, so concurrent edits to it survive; an edit to
/// a section or question since deleted is dropped rather than recreating it.
fn apply_records(
    document: &LoroDoc,
    previous: &[SectionRecord],
    next: &[SectionRecord],
) -> Result<(), LayoutDraftError> {
    let sections = document.get_map(SECTIONS);
    let question_orders = document.get_map(QUESTION_ORDERS);
    let questions = document.get_map(QUESTIONS);
    let previous_sections: HashMap<&str, &SectionRecord> = previous
        .iter()
        .map(|section| (section.id.as_str(), section))
        .collect();
    let next_sections: HashMap<&str, &SectionRecord> = next
        .iter()
        .map(|section| (section.id.as_str(), section))
        .collect();

    for section in previous {
        if !next_sections.contains_key(section.id.as_str()) {
            sections
                .delete(&section.id)
                .map_err(LayoutDraftError::Edit)?;
            question_orders
                .delete(&section.id)
                .map_err(LayoutDraftError::Edit)?;
        }
    }
    for section in next {
        let location = format!("{SECTIONS}.{}", section.id);
        match previous_sections.get(section.id.as_str()) {
            None => {
                let map = sections
                    .insert_container(&section.id, LoroMap::new())
                    .map_err(LayoutDraftError::Edit)?;
                map.insert(KIND, section.kind.as_str())
                    .map_err(LayoutDraftError::Edit)?;
                for (key, value) in &section.fields {
                    write_section_field(&map, key, value, &location)?;
                }
                if section.questions.is_some() {
                    question_orders
                        .insert_container(&section.id, LoroMovableList::new())
                        .map_err(LayoutDraftError::Edit)?;
                }
            }
            Some(before) => {
                let Some(map) = child_map(&sections, &section.id, &location)? else {
                    continue;
                };
                if before.kind != section.kind {
                    map.insert(KIND, section.kind.as_str())
                        .map_err(LayoutDraftError::Edit)?;
                }
                for (key, value) in &section.fields {
                    if before.fields.get(key) != Some(value) {
                        write_section_field(&map, key, value, &location)?;
                    }
                }
                for key in before.fields.keys() {
                    if !section.fields.contains_key(key) {
                        map.delete(key).map_err(LayoutDraftError::Edit)?;
                    }
                }
                match (&before.questions, &section.questions) {
                    (None, Some(_)) => {
                        question_orders
                            .insert_container(&section.id, LoroMovableList::new())
                            .map_err(LayoutDraftError::Edit)?;
                    }
                    (Some(_), None) => {
                        question_orders
                            .delete(&section.id)
                            .map_err(LayoutDraftError::Edit)?;
                    }
                    (None, None) | (Some(_), Some(_)) => {}
                }
            }
        }
    }
    reorder(
        &document.get_movable_list(SECTION_ORDER),
        &previous
            .iter()
            .map(|section| section.id.clone())
            .collect::<Vec<_>>(),
        &next
            .iter()
            .map(|section| section.id.clone())
            .collect::<Vec<_>>(),
    )?;

    let previous_questions = question_placements(previous);
    let next_questions = question_placements(next);
    for (id, _) in previous_questions.iter() {
        if !next_questions.contains_key(id) {
            questions.delete(id).map_err(LayoutDraftError::Edit)?;
        }
    }
    for (id, (section_id, question)) in next_questions.iter() {
        let location = format!("{QUESTIONS}.{id}");
        match previous_questions.get(id) {
            None => {
                let map = questions
                    .insert_container(id, LoroMap::new())
                    .map_err(LayoutDraftError::Edit)?;
                map.insert(SECTION_ID, *section_id)
                    .map_err(LayoutDraftError::Edit)?;
                for (key, value) in &question.fields {
                    write_question_field(&map, key, value, &location)?;
                }
            }
            Some((before_section_id, before)) => {
                let Some(map) = child_map(&questions, id, &location)? else {
                    continue;
                };
                if before_section_id != section_id {
                    map.insert(SECTION_ID, *section_id)
                        .map_err(LayoutDraftError::Edit)?;
                }
                for (key, value) in &question.fields {
                    if before.fields.get(key) != Some(value) {
                        write_question_field(&map, key, value, &location)?;
                    }
                }
                for key in before.fields.keys() {
                    if !question.fields.contains_key(key) {
                        map.delete(key).map_err(LayoutDraftError::Edit)?;
                    }
                }
            }
        }
    }
    for section in next {
        let Some(next_order) = &section.questions else {
            continue;
        };
        let location = format!("{QUESTION_ORDERS}.{}", section.id);
        let Some(order) = child_movable_list(&question_orders, &section.id, &location)? else {
            continue;
        };
        let previous_order: Vec<String> = previous_sections
            .get(section.id.as_str())
            .and_then(|before| before.questions.as_ref())
            .map(|questions| {
                questions
                    .iter()
                    .map(|question| question.id.clone())
                    .collect()
            })
            .unwrap_or_default();
        let next_order: Vec<String> = next_order
            .iter()
            .map(|question| question.id.clone())
            .collect();
        reorder(&order, &previous_order, &next_order)?;
    }
    Ok(())
}

fn question_placements(sections: &[SectionRecord]) -> BTreeMap<&str, (&str, &QuestionRecord)> {
    sections
        .iter()
        .flat_map(|section| {
            section
                .questions
                .iter()
                .flatten()
                .map(|question| (question.id.as_str(), (section.id.as_str(), question)))
        })
        .collect()
}

/// Turns `order` from `previous` into `next`: ids that left are deleted,
/// ids both hold are moved (the fewest, keeping the longest run already in
/// order), and new ids are inserted after their nearest predecessor. Ids
/// neither names, such as a collaborator's concurrent insert, stay put.
fn reorder(
    order: &LoroMovableList,
    previous: &[String],
    next: &[String],
) -> Result<(), LayoutDraftError> {
    let previous_ranks: HashMap<&str, usize> = previous
        .iter()
        .enumerate()
        .map(|(rank, id)| (id.as_str(), rank))
        .collect();
    let next_ids: HashSet<&str> = next.iter().map(String::as_str).collect();

    for index in (0..order.len()).rev() {
        if let Some(ValueOrContainer::Value(LoroValue::String(id))) = order.get(index)
            && previous_ranks.contains_key(id.as_str())
            && !next_ids.contains(id.as_str())
        {
            order.delete(index, 1).map_err(LayoutDraftError::Edit)?;
        }
    }

    let kept: Vec<&str> = next
        .iter()
        .map(String::as_str)
        .filter(|id| previous_ranks.contains_key(id) && position(order, id).is_some())
        .collect();
    let ranks: Vec<usize> = kept.iter().map(|id| previous_ranks[id]).collect();
    let stable: HashSet<&str> = longest_increasing_run(&ranks)
        .into_iter()
        .map(|index| kept[index])
        .collect();
    let first_stable = kept.iter().copied().find(|id| stable.contains(id));
    for (index, id) in kept.iter().enumerate() {
        if stable.contains(id) {
            continue;
        }
        let Some(from) = position(order, id) else {
            continue;
        };
        let to = if index > 0 {
            let Some(anchor) = position(order, kept[index - 1]) else {
                continue;
            };
            if from < anchor { anchor } else { anchor + 1 }
        } else {
            let Some(anchor) = first_stable.and_then(|anchor| position(order, anchor)) else {
                continue;
            };
            if from < anchor { anchor - 1 } else { anchor }
        };
        if from != to {
            order.mov(from, to).map_err(LayoutDraftError::Edit)?;
        }
    }

    for (index, id) in next.iter().enumerate() {
        if previous_ranks.contains_key(id.as_str()) {
            continue;
        }
        let at = next[..index]
            .iter()
            .rev()
            .find_map(|before| position(order, before))
            .map_or(0, |anchor| anchor + 1);
        order
            .insert(at, id.as_str())
            .map_err(LayoutDraftError::Edit)?;
    }
    Ok(())
}

/// The indexes of one longest strictly increasing subsequence of `ranks`.
fn longest_increasing_run(ranks: &[usize]) -> Vec<usize> {
    let mut lengths = vec![1_usize; ranks.len()];
    let mut predecessors: Vec<Option<usize>> = vec![None; ranks.len()];
    for index in 0..ranks.len() {
        for earlier in 0..index {
            if ranks[earlier] < ranks[index] && lengths[earlier] + 1 > lengths[index] {
                lengths[index] = lengths[earlier] + 1;
                predecessors[index] = Some(earlier);
            }
        }
    }
    let mut run = Vec::new();
    let mut cursor = (0..ranks.len()).max_by_key(|index| (lengths[*index], usize::MAX - index));
    while let Some(index) = cursor {
        run.push(index);
        cursor = predecessors[index];
    }
    run.reverse();
    run
}

fn position(order: &LoroMovableList, id: &str) -> Option<usize> {
    (0..order.len()).find(|index| {
        matches!(
            order.get(*index),
            Some(ValueOrContainer::Value(LoroValue::String(entry))) if entry.as_str() == id
        )
    })
}

fn write_section_field(
    map: &LoroMap,
    key: &str,
    value: &JsonValue,
    location: &str,
) -> Result<(), LayoutDraftError> {
    let location = format!("{location}.{key}");
    if SECTION_TEXT_FIELDS.contains(&key) {
        let JsonValue::String(text) = value else {
            return Err(malformed(location, "a string"));
        };
        return write_text(map, key, text, &location);
    }
    let json = serde_json::to_string(value)
        .map_err(|source| LayoutDraftError::InvalidJson { location, source })?;
    map.insert(key, json).map_err(LayoutDraftError::Edit)
}

fn write_question_field(
    map: &LoroMap,
    key: &str,
    value: &JsonValue,
    location: &str,
) -> Result<(), LayoutDraftError> {
    let location = format!("{location}.{key}");
    if key == HELP_TEXT {
        let JsonValue::String(text) = value else {
            return Err(malformed(location, "a string"));
        };
        return write_text(map, key, text, &location);
    }
    map.insert(key, plain_loro(value, &location)?)
        .map_err(LayoutDraftError::Edit)
}

/// Diffs `value` into the text under `key`, so a concurrent edit to the same
/// text merges character by character.
fn write_text(
    map: &LoroMap,
    key: &str,
    value: &str,
    location: &str,
) -> Result<(), LayoutDraftError> {
    let text = match map.get(key) {
        Some(ValueOrContainer::Container(Container::Text(text))) => text,
        None => map
            .insert_container(key, LoroText::new())
            .map_err(LayoutDraftError::Edit)?,
        Some(_) => return Err(malformed(location.to_owned(), "text")),
    };
    text.update(value, UpdateOptions::default())
        .map_err(LayoutDraftError::TextDiff)
}

fn child_map(
    parent: &LoroMap,
    key: &str,
    location: &str,
) -> Result<Option<LoroMap>, LayoutDraftError> {
    match parent.get(key) {
        None => Ok(None),
        Some(ValueOrContainer::Container(Container::Map(map))) => Ok(Some(map)),
        Some(_) => Err(malformed(location.to_owned(), "a map")),
    }
}

fn child_movable_list(
    parent: &LoroMap,
    key: &str,
    location: &str,
) -> Result<Option<LoroMovableList>, LayoutDraftError> {
    match parent.get(key) {
        None => Ok(None),
        Some(ValueOrContainer::Container(Container::MovableList(list))) => Ok(Some(list)),
        Some(_) => Err(malformed(location.to_owned(), "a movable list")),
    }
}

fn to_json(section: &FormSection, location: &str) -> Result<JsonValue, LayoutDraftError> {
    serde_json::to_value(section).map_err(|source| LayoutDraftError::InvalidJson {
        location: location.to_owned(),
        source,
    })
}

fn malformed(location: String, expected: &'static str) -> LayoutDraftError {
    LayoutDraftError::Malformed { location, expected }
}
