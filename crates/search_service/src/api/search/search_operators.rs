//! Operators typed into any search that choose the kinds of item it reaches
//! and narrow them: `type:task`, `status:in_progress`, `priority:high`,
//! `assignee:me`, `author:ana@example.com`, `tag:finance`,
//! `inbox:ana@example.com`, `in:#launch`, and `from:` in a search of
//! channels or calls alone.
//!
//! They are read before the email operators ([`super::email_operators`]),
//! from the same terms, so the same typed text searches the same way from
//! every caller. `OR` between two of the same operator joins their values
//! (`tag:a OR tag:b`); repeated without it, each must hold (`tag:a tag:b`).
//! A term that names no operator, or one with an invalid value, stays a
//! search term, and so does a `from:` that the email operators read.
//! `type:` names the kinds outright; every other operator narrows the search
//! to the kinds it applies to. `assignee:`, `author:` and `from:` take `me`
//! or an address.

use item_filters::{CallFilters, CallStatus};
use models_search::MatchType;
use models_search::unified::SearchEntityFilters;
use nom::{
    IResult, Parser, bytes::complete::take_while1, character::complete::char,
    combinator::all_consuming,
};
use opensearch_client::search::documents::PropertyFilterArg;
use system_properties::{PriorityOption, StatusOption, SystemPropertyKey};
use uuid::Uuid;

use super::email_operators::name_and_value;
use crate::api::search::simple::SearchError;
use crate::domain::operator_names::{NamedIds, TypedNames};

#[cfg(test)]
mod test;

/// The term that joins two values of one operator.
const OR: &str = "OR";

/// The sub type that marks a document as a task.
const TASK_SUB_TYPE: &str = "task";

/// Most `in:#` channel names one search looks up.
pub(in crate::api::search) const MAX_CHANNEL_NAMES: usize = 5;

/// A set of the kinds of item a search reaches.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::api::search) struct Kinds(u8);

impl Kinds {
    const DOCUMENTS: Self = Self(1);
    const TASKS: Self = Self(1 << 1);
    const EMAIL: Self = Self(1 << 2);
    const CHANNELS: Self = Self(1 << 3);
    const CALLS: Self = Self(1 << 4);
    const FOLDERS: Self = Self(1 << 5);
    const AGENTS: Self = Self(1 << 6);
    const CALENDAR: Self = Self(1 << 7);
    const ALL: Self = Self(u8::MAX);
    const NONE: Self = Self(0);
    /// The kinds tags are indexed on: every kind but channels.
    const TAGGED: Self = Self(u8::MAX & !Self::CHANNELS.0);

    const fn or(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }

    const fn and(self, other: Self) -> Self {
        Self(self.0 & other.0)
    }

    const fn has(self, kinds: Self) -> bool {
        self.0 & kinds.0 != 0
    }

    fn named(name: &str) -> Option<Self> {
        Some(match name {
            "doc" => Self::DOCUMENTS,
            "task" => Self::TASKS,
            "email" => Self::EMAIL,
            "channel" => Self::CHANNELS,
            "call" => Self::CALLS,
            "folder" => Self::FOLDERS,
            "agent" => Self::AGENTS,
            "calendar" => Self::CALENDAR,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Name {
    Type,
    Status,
    Priority,
    Assignee,
    Author,
    Tag,
    Inbox,
    Channel,
    From,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Person {
    Me,
    Address(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Value {
    Kind(Kinds),
    TaskStatus(StatusOption),
    CallStatus(CallStatus),
    Priority(PriorityOption),
    Person(Person),
    /// A tag name, an inbox address or a channel name, resolved for the
    /// caller once the search has its turn.
    Name(String),
}

/// One operator, or several of the same joined by `OR`, with the terms it
/// was read from.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Group {
    name: Name,
    values: Vec<Value>,
    terms: Vec<String>,
}

impl Group {
    /// The kinds this operator can apply to.
    fn applies(&self) -> Kinds {
        self.values.iter().fold(Kinds::NONE, |kinds, value| {
            kinds.or(match (self.name, value) {
                (_, Value::Kind(kinds)) => *kinds,
                (_, Value::CallStatus(_)) => Kinds::CALLS,
                (Name::Author, _) => Kinds::DOCUMENTS.or(Kinds::TASKS),
                (Name::Status | Name::Priority | Name::Assignee, _) => Kinds::TASKS,
                (Name::Tag, _) => Kinds::TAGGED,
                (Name::Inbox, _) => Kinds::EMAIL,
                (Name::Channel | Name::From, _) => Kinds::CHANNELS.or(Kinds::CALLS),
                (Name::Type, _) => Kinds::NONE,
            })
        })
    }

    /// The kinds this operator narrows a search to when no `type:` names
    /// them: those it applies to, except that `author:` means a task's
    /// creator, as the Created by filter does.
    fn implied(&self) -> Kinds {
        match self.name {
            Name::Author => Kinds::TASKS,
            _ => self.applies(),
        }
    }

    fn call_statuses(&self) -> Vec<CallStatus> {
        let mut statuses: Vec<CallStatus> = Vec::new();
        for value in &self.values {
            if let Value::CallStatus(status) = value
                && !statuses.contains(status)
            {
                statuses.push(*status);
            }
        }
        statuses
    }

    fn option_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = Vec::new();
        for value in &self.values {
            let id = match value {
                Value::TaskStatus(status) => status.uuid(),
                Value::Priority(priority) => priority.uuid(),
                _ => continue,
            };
            let id = id.to_string();
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        ids
    }

    /// The user ids of the people this operator names, `me` being `user_id`.
    fn user_ids(&self, user_id: &str) -> Vec<String> {
        let mut ids: Vec<String> = Vec::new();
        for value in &self.values {
            let id = match value {
                Value::Person(Person::Me) => user_id.to_lowercase(),
                Value::Person(Person::Address(address)) => format!("macro|{address}"),
                _ => continue,
            };
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        ids
    }

    fn names(&self) -> impl Iterator<Item = &str> {
        self.values.iter().filter_map(|value| match value {
            Value::Name(name) => Some(name.as_str()),
            _ => None,
        })
    }
}

fn not_at_or_space(c: char) -> bool {
    c != '@' && !c.is_whitespace()
}

/// `value` when it is an address: something, `@`, something.
fn address(value: &str) -> Option<&str> {
    let parsed: IResult<&str, _> = all_consuming((
        take_while1(not_at_or_space),
        char('@'),
        take_while1(not_at_or_space),
    ))
    .parse(value);
    parsed.ok().map(|_| value)
}

fn person(value: &str) -> Option<Person> {
    if value == "me" {
        return Some(Person::Me);
    }
    address(value).map(|address| Person::Address(address.to_string()))
}

fn status(value: &str) -> Option<Value> {
    Some(match value {
        "missed" => Value::CallStatus(CallStatus::Missed),
        "attended" => Value::CallStatus(CallStatus::Attended),
        "unattended" => Value::CallStatus(CallStatus::Unattended),
        _ => Value::TaskStatus(StatusOption::try_from(value).ok()?),
    })
}

fn priority(value: &str) -> Option<PriorityOption> {
    Some(match value {
        "low" => PriorityOption::Low,
        "medium" => PriorityOption::Medium,
        "high" => PriorityOption::High,
        "urgent" => PriorityOption::Urgent,
        _ => return None,
    })
}

/// The operator `term` names, if it is one with a valid value.
fn operator(term: &str) -> Option<(Name, Value)> {
    let (name, value) = name_and_value(term).ok()?;
    if !value.chars().any(char::is_alphanumeric) {
        return None;
    }
    let lowered = value.to_lowercase();
    let name = match name.to_ascii_lowercase().as_str() {
        "type" => Name::Type,
        "status" => Name::Status,
        "priority" => Name::Priority,
        "assignee" => Name::Assignee,
        "author" => Name::Author,
        "tag" => Name::Tag,
        "inbox" => Name::Inbox,
        "in" => Name::Channel,
        "from" => Name::From,
        _ => return None,
    };
    let value = match name {
        Name::Type => Value::Kind(Kinds::named(&lowered)?),
        Name::Status => status(&lowered)?,
        Name::Priority => Value::Priority(priority(&lowered)?),
        Name::Assignee | Name::Author | Name::From => Value::Person(person(&lowered)?),
        Name::Tag => Value::Name(value.to_string()),
        Name::Inbox => Value::Name(address(&lowered)?.to_string()),
        // `in:` without a `#` names a Mail view or label.
        Name::Channel => {
            let channel = value.strip_prefix('#')?;
            if !channel.chars().any(char::is_alphanumeric) {
                return None;
            }
            Value::Name(channel.to_string())
        }
    };
    Some((name, value))
}

enum Entry {
    Word(String),
    Operator(Group),
}

/// `terms` as words and operators, joining an operator to the one before it
/// when `OR` stands between two of the same name.
fn entries(terms: Vec<String>) -> Vec<Entry> {
    let mut entries: Vec<Entry> = Vec::new();
    for term in terms {
        let Some((name, value)) = operator(&term) else {
            entries.push(Entry::Word(term));
            continue;
        };
        let joins = matches!(
            entries.as_slice(),
            [.., Entry::Operator(group), Entry::Word(or)] if group.name == name && or == OR
        );
        if joins
            && let Some(Entry::Word(or)) = entries.pop()
            && let Some(Entry::Operator(group)) = entries.last_mut()
        {
            group.values.push(value);
            group.terms.push(or);
            group.terms.push(term);
            continue;
        }
        entries.push(Entry::Operator(Group {
            name,
            values: vec![value],
            terms: vec![term],
        }));
    }
    entries
}

/// A search's terms with its operators read out of them.
#[derive(Debug, Default, PartialEq)]
pub(in crate::api::search) struct SearchOperators {
    /// The terms left to match.
    pub terms: Vec<String>,
    /// How many terms were operators, not counting `OR`.
    pub operators: usize,
    groups: Vec<Group>,
    /// The kinds `type:` named, when it named any.
    types: Option<Kinds>,
}

/// Reads the operators out of `terms`.
pub(in crate::api::search) fn read_search_operators(terms: Vec<String>) -> SearchOperators {
    let entries = entries(terms);
    let types = entries
        .iter()
        .filter_map(|entry| match entry {
            Entry::Operator(group) if group.name == Name::Type => Some(group.applies()),
            _ => None,
        })
        .reduce(Kinds::and);
    // `from:` is the email operator unless `type:` leaves email out and
    // names channels or calls, whose senders and speakers it then names.
    let reads_from = types.is_some_and(|types| {
        !types.has(Kinds::EMAIL) && types.has(Kinds::CHANNELS.or(Kinds::CALLS))
    });

    let mut read = SearchOperators {
        types,
        ..SearchOperators::default()
    };
    for entry in entries {
        match entry {
            Entry::Word(word) => read.terms.push(word),
            Entry::Operator(group) if readable(&group, reads_from) => {
                read.operators += group.values.len();
                read.groups.push(group);
            }
            Entry::Operator(group) => read.terms.extend(group.terms),
        }
    }
    read
}

/// Whether `group` can apply. A call has one status, so two different call
/// statuses joined by `OR` name no filter and stay words.
fn readable(group: &Group, reads_from: bool) -> bool {
    match group.name {
        Name::From => reads_from,
        Name::Status => group.call_statuses().len() <= 1,
        _ => true,
    }
}

/// What the operators add to a search besides its entity filters.
#[derive(Debug, Default)]
pub(in crate::api::search) struct TypedConditions {
    /// Task property filters, ANDed with the request's own.
    pub property_filters: Vec<PropertyFilterArg>,
    /// Tasks are left out of the documents searched.
    pub exclude_tasks: bool,
}

impl SearchOperators {
    /// The kinds the operators leave: those `type:` named, or every kind,
    /// narrowed by each other operator.
    fn kinds(&self) -> Kinds {
        let mut kinds = self.types.unwrap_or(Kinds::ALL);
        for group in self.groups.iter().filter(|group| group.name != Name::Type) {
            kinds = kinds.and(match self.types {
                Some(_) => group.applies(),
                None => group.implied(),
            });
        }
        kinds
    }

    fn groups_named(&self, name: Name) -> impl Iterator<Item = &Group> {
        self.groups.iter().filter(move |group| group.name == name)
    }

    /// The names to look up before [`apply_names`] can apply them.
    pub(in crate::api::search) fn names(&self) -> TypedNames {
        let collect =
            |name| -> Vec<String> { self.groups_named(name).flat_map(Group::names).map(str::to_string).collect() };
        TypedNames {
            tags: collect(Name::Tag),
            inboxes: collect(Name::Inbox),
            channels: collect(Name::Channel),
        }
    }
}

/// `ids` narrowed to those in `wanted`, ignoring case, or `wanted` when
/// `ids` allows any. False when none is left.
fn narrow_ids(ids: &mut Vec<String>, wanted: &[String]) -> bool {
    if ids.is_empty() {
        ids.extend(wanted.iter().cloned());
    } else {
        ids.retain(|id| wanted.iter().any(|want| want.eq_ignore_ascii_case(id)));
    }
    !ids.is_empty()
}

fn narrow_call_status(filters: &mut CallFilters, status: CallStatus) -> bool {
    if filters.status.is_some_and(|set| set != status)
        || filters
            .attended
            .is_some_and(|attended| attended != (status == CallStatus::Attended))
    {
        return false;
    }
    filters.status = Some(status);
    true
}

/// Leaves out every kind the search reaches.
fn leave_out_everything(filters: &mut SearchEntityFilters) {
    filters.should_include_agent_sessions = false;
    filters.should_include_documents = false;
    filters.should_include_chats = false;
    filters.should_include_emails = false;
    filters.should_include_channels = false;
    filters.should_include_projects = false;
    filters.should_include_call_records = false;
    filters.should_include_calendar_events = false;
}

/// Keeps only the kinds in `kinds`, telling tasks apart from the rest of
/// the documents by their sub type.
fn narrow_kinds(filters: &mut SearchEntityFilters, kinds: Kinds, conditions: &mut TypedConditions) {
    let documents = kinds.has(Kinds::DOCUMENTS);
    let tasks = kinds.has(Kinds::TASKS);
    filters.should_include_documents &= documents || tasks;
    let sub_types = &mut filters.document_filters.sub_types;
    let asks_tasks_only = !sub_types.is_empty() && sub_types.iter().all(|t| t == TASK_SUB_TYPE);
    if tasks && !documents {
        if sub_types.is_empty() || sub_types.iter().any(|t| t == TASK_SUB_TYPE) {
            *sub_types = vec![TASK_SUB_TYPE.to_string()];
        } else {
            filters.should_include_documents = false;
        }
    } else if documents && !tasks {
        if asks_tasks_only {
            filters.should_include_documents = false;
        } else {
            sub_types.retain(|t| t != TASK_SUB_TYPE);
            conditions.exclude_tasks = true;
        }
    }
    filters.should_include_emails &= kinds.has(Kinds::EMAIL);
    filters.should_include_channels &= kinds.has(Kinds::CHANNELS);
    filters.should_include_call_records &= kinds.has(Kinds::CALLS);
    filters.should_include_projects &= kinds.has(Kinds::FOLDERS);
    filters.should_include_chats &= kinds.has(Kinds::AGENTS);
    filters.should_include_agent_sessions &= kinds.has(Kinds::AGENTS);
    filters.should_include_calendar_events &= kinds.has(Kinds::CALENDAR);
}

fn property_filter(definition: Uuid, values: Vec<String>) -> PropertyFilterArg {
    PropertyFilterArg {
        definition_id: definition.to_string(),
        values,
        date_range: None,
        has_date: None,
    }
}

/// Reads the operators out of a search's `terms` when its match type reads
/// plain words, and applies those that need no lookup to `filters`: the
/// kinds, task status, priority and assignees, authors, call status, and
/// channel senders and call speakers. `user_id` is who `me` is. Returns the
/// operators read, with the terms left, and the conditions they add.
pub(in crate::api::search) fn apply_search_operators(
    filters: &mut SearchEntityFilters,
    terms: Vec<String>,
    match_type: MatchType,
    user_id: &str,
) -> Result<(SearchOperators, TypedConditions), SearchError> {
    let mut conditions = TypedConditions::default();
    if !matches!(match_type, MatchType::Exact | MatchType::Partial) {
        let read = SearchOperators {
            terms,
            ..SearchOperators::default()
        };
        return Ok((read, conditions));
    }
    let read = read_search_operators(terms);
    if read.operators == 0 {
        return Ok((read, conditions));
    }
    let channel_names = read.names().channels;
    if channel_names.len() > MAX_CHANNEL_NAMES {
        return Err(SearchError::TooManyChannelNames(MAX_CHANNEL_NAMES));
    }

    narrow_kinds(filters, read.kinds(), &mut conditions);
    for group in &read.groups {
        match group.name {
            Name::Status => {
                let option_ids = group.option_ids();
                if !option_ids.is_empty() {
                    conditions
                        .property_filters
                        .push(property_filter(SystemPropertyKey::STATUS_UUID, option_ids));
                }
                if let [status] = group.call_statuses().as_slice()
                    && !narrow_call_status(&mut filters.call_filters, *status)
                {
                    filters.should_include_call_records = false;
                }
            }
            Name::Priority => conditions.property_filters.push(property_filter(
                SystemPropertyKey::PRIORITY_UUID,
                group.option_ids(),
            )),
            Name::Assignee => conditions.property_filters.push(property_filter(
                SystemPropertyKey::ASSIGNEES_UUID,
                group.user_ids(user_id),
            )),
            Name::Author => {
                if !narrow_ids(&mut filters.document_filters.owners, &group.user_ids(user_id)) {
                    filters.should_include_documents = false;
                }
            }
            Name::From => {
                let people = group.user_ids(user_id);
                if !narrow_ids(&mut filters.channel_filters.sender_ids, &people) {
                    filters.should_include_channels = false;
                }
                if !narrow_ids(&mut filters.call_filters.speaker_ids, &people) {
                    filters.should_include_call_records = false;
                }
            }
            Name::Type | Name::Tag | Name::Inbox | Name::Channel => {}
        }
    }
    Ok((read, conditions))
}

/// The tags a search requires: option ids and whether it needs every one
/// of them rather than any.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(in crate::api::search) struct TagFilter {
    pub option_ids: Vec<String>,
    pub match_all: bool,
}

impl TagFilter {
    /// The request's tags as groups that must each hold, any one of a
    /// group's ids being enough.
    fn groups(self) -> Vec<Vec<String>> {
        if self.option_ids.is_empty() {
            Vec::new()
        } else if self.match_all {
            self.option_ids.into_iter().map(|id| vec![id]).collect()
        } else {
            vec![self.option_ids]
        }
    }

    /// The filter that requires each group. The search applies any of one
    /// list of ids or all of them, so several groups of more than one id
    /// are refused.
    fn requiring(groups: Vec<Vec<String>>) -> Result<Self, SearchError> {
        match groups.as_slice() {
            [] => Ok(Self::default()),
            [only] => Ok(Self {
                option_ids: only.clone(),
                match_all: false,
            }),
            _ if groups.iter().all(|group| group.len() == 1) => {
                let mut option_ids: Vec<String> = Vec::new();
                for id in groups.into_iter().flatten() {
                    if !option_ids.contains(&id) {
                        option_ids.push(id);
                    }
                }
                Ok(Self {
                    option_ids,
                    match_all: true,
                })
            }
            _ => Err(SearchError::TagConditionsDontCombine),
        }
    }
}

/// Applies the operators that name something by name, as `named` resolved
/// them for the caller: `tag:` joins the request's own `tags`, `inbox:`
/// narrows the inboxes searched and `in:#` the channels and calls. A name
/// that reaches nothing leaves out the kinds its operator narrows, as a
/// `label:` naming nothing does, so no kind the operators kept can match.
pub(in crate::api::search) fn apply_names(
    read: &SearchOperators,
    named: &NamedIds,
    filters: &mut SearchEntityFilters,
    tags: TagFilter,
) -> Result<TagFilter, SearchError> {
    let mut tag_groups = tags.clone().groups();
    let mut typed_tags = false;
    for group in read.groups_named(Name::Tag) {
        typed_tags = true;
        let mut ids: Vec<String> = Vec::new();
        for id in group.names().flat_map(|name| named.tag(name)) {
            let id = id.to_string();
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        if ids.is_empty() {
            leave_out_everything(filters);
            return Ok(tags);
        }
        tag_groups.push(ids);
    }

    for group in read.groups_named(Name::Inbox) {
        let link_ids: Vec<String> = group
            .names()
            .flat_map(|address| named.inbox(address))
            .map(Uuid::to_string)
            .collect();
        if link_ids.is_empty() || !narrow_ids(&mut filters.email_filters.link_ids, &link_ids) {
            filters.should_include_emails = false;
        }
    }

    for group in read.groups_named(Name::Channel) {
        let channel_ids: Vec<String> = group
            .names()
            .flat_map(|name| named.channel(name))
            .map(Uuid::to_string)
            .collect();
        if channel_ids.is_empty()
            || !narrow_ids(&mut filters.channel_filters.channel_ids, &channel_ids)
        {
            filters.should_include_channels = false;
        }
        if channel_ids.is_empty()
            || !narrow_ids(&mut filters.call_filters.channel_ids, &channel_ids)
        {
            filters.should_include_call_records = false;
        }
    }

    if typed_tags {
        TagFilter::requiring(tag_groups)
    } else {
        Ok(tags)
    }
}

/// Whether `filters` still reach a kind whose search needs a word to
/// match: every kind but email, which its operators can search alone.
pub(in crate::api::search) fn reaches_beyond_email(
    filters: &SearchEntityFilters,
    include_crm: bool,
) -> bool {
    include_crm
        || filters.should_include_agent_sessions
        || filters.should_include_documents
        || filters.should_include_chats
        || filters.should_include_channels
        || filters.should_include_projects
        || filters.should_include_call_records
        || filters.should_include_calendar_events
}
