//! Operators typed into an email search, as Gmail and Superhuman read them:
//! `subject:lunch`, `from:ana`, `in:sent`, `is:unread`, `has:attachment`,
//! `label:travel`, `after:2017/06/01`, `newer_than:3d`, and a minus before
//! any of them or a plain word to leave matching mail out.
//!
//! The terms come from [`super::terms::split_search_terms`], so a quoted value
//! (`subject:"team lunch"`) arrives as one term. A term that names no known
//! operator, or a known one with an invalid value, stays a search term; with
//! a minus in front it leaves out the mail containing that word instead.
//! Every operator becomes an [`EmailFilters`] field, so the same typed text
//! searches the same way from every caller of the search service.

use chrono::{DateTime, Days, Months, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use item_filters::{
    EmailFilters, EmailLabelMatch, EmailSearchView, EmailTextMatch, EmailTextPart,
    SharedEmailFilter,
};
use models_search::MatchType;
use models_search::unified::SearchEntityFilters;
use nom::{
    IResult, Parser,
    bytes::complete::{take_while_m_n, take_while1},
    character::complete::{char, one_of},
    combinator::{all_consuming, map_res},
};

#[cfg(test)]
mod test;

/// The moment and the time zone a search's dates are read in.
#[derive(Debug, Clone, Copy)]
pub(in crate::api::search) struct QueryClock {
    pub now: DateTime<Utc>,
    pub zone: Tz,
}

/// A search's terms with its email operators read out of them.
#[derive(Debug, Default, PartialEq)]
pub(in crate::api::search) struct EmailQuery {
    /// The terms left to match anywhere in a message.
    pub terms: Vec<String>,
    /// The conditions the operators set. `shared` is left at its default;
    /// the operators' choice is [`EmailQuery::shared`].
    pub filters: EmailFilters,
    /// The shared threads an operator asked for, when one did.
    pub shared: Option<SharedEmailFilter>,
    /// How many terms were named operators, and once applied, words left out.
    pub operators: usize,
    /// Words and phrases a minus leaves out (`-lunch`). Nothing about them
    /// says email, so they apply only to a search that is about email
    /// anyway ([`EmailQuery::leave_out_words`]).
    pub excluded_words: Vec<String>,
    /// Whether a relative date (`newer_than:`, `older_than:`) was read
    /// against [`QueryClock::now`].
    pub reads_now: bool,
    /// Two operators asked for opposite things, so no mail can match.
    pub contradiction: bool,
}

/// A view `in:` names. Each means what the Mail list of the same name shows,
/// as the web app's `in:` filter maps it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MailView {
    Inbox,
    Signal,
    Noise,
    Archived,
    Sent,
    Drafts,
    Calendar,
    Shared,
    Favorites,
}

impl MailView {
    fn named(name: &str) -> Option<Self> {
        Some(match name {
            "inbox" => Self::Inbox,
            "signal" => Self::Signal,
            "noise" => Self::Noise,
            "archived" => Self::Archived,
            "sent" => Self::Sent,
            "drafts" => Self::Drafts,
            "calendar" => Self::Calendar,
            "shared" => Self::Shared,
            "favorites" => Self::Favorites,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SpanUnit {
    Day,
    Week,
    Month,
    Year,
}

/// A span of the viewer's calendar, such as three days or one month.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CalendarSpan {
    count: u32,
    unit: SpanUnit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Operator {
    Text(EmailTextPart, String),
    In(MailView),
    /// `in:` naming something that is not a view, as Superhuman names labels.
    Label(String),
    Unread,
    Read,
    Starred,
    IsShared,
    HasAttachment,
    After(NaiveDate),
    Before(NaiveDate),
    NewerThan(CalendarSpan),
    OlderThan(CalendarSpan),
}

/// `name:value`, with a name of letters and underscores and any value.
fn name_and_value(term: &str) -> IResult<&str, &str> {
    let (value, (name, _)) = (
        take_while1(|c: char| c.is_ascii_alphabetic() || c == '_'),
        char(':'),
    )
        .parse(term)?;
    Ok((name, value))
}

fn number<'a>(
    digits: usize,
) -> impl Parser<&'a str, Output = u32, Error = nom::error::Error<&'a str>> {
    map_res(
        take_while_m_n(1, digits, |c: char| c.is_ascii_digit()),
        str::parse::<u32>,
    )
}

/// `2017/06/01` or `2017-06-01`, as Gmail takes them.
fn date(value: &str) -> Option<NaiveDate> {
    let date_parts = (number(4), one_of("/-"), number(2), one_of("/-"), number(2));
    let (_, (year, first, month, second, day)) = all_consuming(date_parts).parse(value).ok()?;
    if first != second {
        return None;
    }
    NaiveDate::from_ymd_opt(i32::try_from(year).ok()?, month, day)
}

/// `3d`, `2w`, `1m` or `1y`.
fn calendar_span(value: &str) -> Option<CalendarSpan> {
    let unit = one_of("dwmy").map(|unit| match unit {
        'd' => SpanUnit::Day,
        'w' => SpanUnit::Week,
        'm' => SpanUnit::Month,
        _ => SpanUnit::Year,
    });
    let (_, (count, unit)) = all_consuming((number(4), unit)).parse(value).ok()?;
    Some(CalendarSpan { count, unit })
}

/// The operator `term` names, if it is one with a valid value.
fn operator(term: &str) -> Option<Operator> {
    let (name, value) = name_and_value(term).ok()?;
    if !value.chars().any(char::is_alphanumeric) {
        return None;
    }
    let lowered = value.to_lowercase();
    let text = |part| Some(Operator::Text(part, value.to_string()));
    match name.to_ascii_lowercase().as_str() {
        "subject" => text(EmailTextPart::Subject),
        "from" => text(EmailTextPart::From),
        "to" => text(EmailTextPart::To),
        "cc" => text(EmailTextPart::Cc),
        "bcc" => text(EmailTextPart::Bcc),
        "label" => Some(Operator::Label(value.to_string())),
        "in" => match MailView::named(&lowered) {
            Some(view) => Some(Operator::In(view)),
            // Focus is a ranked list only the web app reads.
            None if lowered == "focus" => None,
            None => Some(Operator::Label(value.to_string())),
        },
        "is" => match lowered.as_str() {
            "unread" => Some(Operator::Unread),
            "read" => Some(Operator::Read),
            "starred" => Some(Operator::Starred),
            "shared" => Some(Operator::IsShared),
            _ => None,
        },
        "has" => (lowered == "attachment").then_some(Operator::HasAttachment),
        "after" => date(value).map(Operator::After),
        "before" => date(value).map(Operator::Before),
        "newer_than" => calendar_span(&lowered).map(Operator::NewerThan),
        "older_than" => calendar_span(&lowered).map(Operator::OlderThan),
        _ => None,
    }
}

/// Longest a daylight-saving change skips, in minutes.
const LONGEST_SKIPPED_MINUTES: i64 = 180;

/// The instant `local` names in `zone`. A time a daylight-saving change
/// repeats is its earlier instant; a time the change skips is the first
/// moment after the skip, since every skip starts and ends on a whole minute.
fn local_instant(local: NaiveDateTime, zone: Tz) -> Option<DateTime<Utc>> {
    if let Some(instant) = zone.from_local_datetime(&local).earliest() {
        return Some(instant.with_timezone(&Utc));
    }
    let minute = local.with_second(0)?.with_nanosecond(0)?;
    (1..=LONGEST_SKIPPED_MINUTES).find_map(|minutes| {
        zone.from_local_datetime(&(minute + chrono::Duration::minutes(minutes)))
            .earliest()
            .map(|instant| instant.with_timezone(&Utc))
    })
}

/// The start of `day` in `zone`.
fn start_of_day(day: NaiveDate, zone: Tz) -> Option<DateTime<Utc>> {
    local_instant(day.and_hms_opt(0, 0, 0)?, zone)
}

/// `span` before the clock's moment, counted on the viewer's calendar, so a
/// day is a calendar day whatever a daylight-saving change does to its hours.
fn span_before_now(span: CalendarSpan, clock: QueryClock) -> Option<DateTime<Utc>> {
    let local = clock.now.with_timezone(&clock.zone).naive_local();
    let earlier = match span.unit {
        SpanUnit::Day => local.checked_sub_days(Days::new(span.count.into())),
        SpanUnit::Week => local.checked_sub_days(Days::new(u64::from(span.count) * 7)),
        SpanUnit::Month => local.checked_sub_months(Months::new(span.count)),
        SpanUnit::Year => local.checked_sub_months(Months::new(span.count.checked_mul(12)?)),
    }?;
    local_instant(earlier, clock.zone)
}

/// Reads the conditions in as they come, noting when one contradicts another.
#[derive(Default)]
struct Conditions {
    query: EmailQuery,
    /// The last view an `in:` named; only one applies.
    view: Option<MailView>,
}

impl Conditions {
    fn require(&mut self, slot: fn(&mut EmailFilters) -> &mut Option<bool>, value: bool) {
        let current = slot(&mut self.query.filters);
        if current.is_some_and(|set| set != value) {
            self.query.contradiction = true;
        }
        *current = Some(value);
    }

    fn require_shared(&mut self, shared: SharedEmailFilter) {
        if self.query.shared.is_some_and(|set| set != shared) {
            self.query.contradiction = true;
        }
        self.query.shared = Some(shared);
    }

    fn sent_after(&mut self, after: DateTime<Utc>) {
        let filters = &mut self.query.filters;
        filters.sent_after = Some(filters.sent_after.map_or(after, |set| set.max(after)));
    }

    fn sent_before(&mut self, before: DateTime<Utc>) {
        let filters = &mut self.query.filters;
        filters.sent_before = Some(filters.sent_before.map_or(before, |set| set.min(before)));
    }

    fn label(&mut self, name: String, exclude: bool) {
        self.query
            .filters
            .label_names
            .push(EmailLabelMatch { name, exclude });
    }

    fn text(&mut self, part: EmailTextPart, text: String, exclude: bool) {
        self.query.filters.text_matches.push(EmailTextMatch {
            part,
            text,
            exclude,
        });
    }

    /// Applies `operator`, or with `exclude` leaves out what it matches.
    /// Returns false when that cannot be applied before paging, so the term
    /// is read as a word instead.
    fn apply(&mut self, operator: Operator, exclude: bool, clock: QueryClock) -> bool {
        match operator {
            Operator::Text(part, text) => self.text(part, text, exclude),
            Operator::Label(name) => self.label(name, exclude),
            Operator::In(view) if !exclude => self.view = Some(view),
            Operator::In(view) => match view {
                MailView::Inbox => self.require(|f| &mut f.done, true),
                MailView::Archived => self.require(|f| &mut f.done, false),
                MailView::Shared => self.require_shared(SharedEmailFilter::Exclude),
                MailView::Favorites => self.require(|f| &mut f.favorite, false),
                MailView::Sent => self.query.filters.exclude_views.push(EmailSearchView::Sent),
                MailView::Drafts => self
                    .query
                    .filters
                    .exclude_views
                    .push(EmailSearchView::Drafts),
                MailView::Calendar => self
                    .query
                    .filters
                    .exclude_views
                    .push(EmailSearchView::Calendar),
                // Each is two conditions, the inbox and an importance, and
                // leaving it out would need either one to fail: an OR across
                // the index and Postgres, which no filter applies before
                // paging.
                MailView::Signal | MailView::Noise => return false,
            },
            Operator::Unread => self.require(|f| &mut f.is_read, exclude),
            Operator::Read => self.require(|f| &mut f.is_read, !exclude),
            Operator::Starred => self.require(|f| &mut f.favorite, !exclude),
            Operator::IsShared if exclude => self.require_shared(SharedEmailFilter::Exclude),
            Operator::IsShared => self.require_shared(SharedEmailFilter::Only),
            Operator::HasAttachment => self.require(|f| &mut f.has_attachment, !exclude),
            Operator::After(day) | Operator::Before(day) => {
                let Some(start) = start_of_day(day, clock.zone) else {
                    return false;
                };
                let is_after = matches!(operator, Operator::After(_));
                if is_after != exclude {
                    self.sent_after(start);
                } else {
                    self.sent_before(start);
                }
            }
            Operator::NewerThan(span) | Operator::OlderThan(span) => {
                let Some(boundary) = span_before_now(span, clock) else {
                    return false;
                };
                self.query.reads_now = true;
                let is_newer = matches!(operator, Operator::NewerThan(_));
                if is_newer != exclude {
                    self.sent_after(boundary);
                } else {
                    self.sent_before(boundary);
                }
            }
        }
        true
    }

    /// Applies the view the last `in:` named, as the Mail list of that name
    /// filters it.
    fn apply_view(&mut self) {
        let Some(view) = self.view else {
            return;
        };
        match view {
            MailView::Inbox => self.require(|f| &mut f.done, false),
            MailView::Signal | MailView::Noise => {
                self.require(|f| &mut f.importance, view == MailView::Signal);
                self.require(|f| &mut f.done, false);
            }
            MailView::Archived => self.require(|f| &mut f.done, true),
            MailView::Sent | MailView::Drafts => {
                let named = if view == MailView::Sent {
                    EmailSearchView::Sent
                } else {
                    EmailSearchView::Drafts
                };
                if self.query.filters.view.is_some_and(|set| set != named) {
                    self.query.contradiction = true;
                }
                self.query.filters.view = Some(named);
            }
            MailView::Calendar => self.query.filters.calendar_only = Some(true),
            MailView::Shared => self.require_shared(SharedEmailFilter::Only),
            MailView::Favorites => self.require(|f| &mut f.favorite, true),
        }
    }
}

/// Reads the email operators out of `terms`. A minus before a plain word or
/// phrase goes to [`EmailQuery::excluded_words`]. A minus alone stays a term,
/// which [`super::terms::drop_wordless_terms`] has already removed, and so
/// does a term that starts with two (`--force`).
pub(in crate::api::search) fn read_email_operators(
    terms: Vec<String>,
    clock: QueryClock,
) -> EmailQuery {
    let mut conditions = Conditions::default();
    for term in terms {
        let (exclude, body) = match term.strip_prefix('-') {
            Some(body) if !body.starts_with('-') && body.chars().any(char::is_alphanumeric) => {
                (true, body)
            }
            _ => (false, term.as_str()),
        };

        if let Some(operator) = operator(body)
            && conditions.apply(operator, exclude, clock)
        {
            conditions.query.operators += 1;
            continue;
        }

        if exclude {
            conditions.query.excluded_words.push(body.to_string());
        } else {
            conditions.query.terms.push(term);
        }
    }
    conditions.apply_view();
    conditions.query
}

impl EmailQuery {
    /// Leaves out the mail containing each word or phrase a minus named.
    fn leave_out_words(&mut self) {
        for text in self.excluded_words.drain(..) {
            self.filters.text_matches.push(EmailTextMatch {
                part: EmailTextPart::Any,
                text,
                exclude: true,
            });
            self.operators += 1;
        }
    }
}

/// Whether `a` and `b` can both hold, and the one value that meets both.
fn both(a: Option<bool>, b: Option<bool>) -> Result<Option<bool>, ()> {
    match (a, b) {
        (Some(a), Some(b)) if a != b => Err(()),
        (a, b) => Ok(a.or(b)),
    }
}

/// The request's email filters narrowed by the query's operators, or `None`
/// when they ask for opposite things and no mail can match.
pub(in crate::api::search) fn with_operators(
    mut filters: EmailFilters,
    query: &EmailQuery,
) -> Option<EmailFilters> {
    if query.contradiction {
        return None;
    }
    let typed = &query.filters;

    filters.importance = both(filters.importance, typed.importance).ok()?;
    filters.is_read = both(filters.is_read, typed.is_read).ok()?;
    filters.done = both(filters.done, typed.done).ok()?;
    filters.favorite = both(filters.favorite, typed.favorite).ok()?;
    filters.has_attachment = both(filters.has_attachment, typed.has_attachment).ok()?;
    if typed.calendar_only == Some(true) {
        filters.calendar_only = Some(true);
    }
    filters.view = match (filters.view, typed.view) {
        (Some(set), Some(typed)) if set != typed => return None,
        (set, typed) => set.or(typed),
    };
    filters.shared = match (filters.shared, query.shared) {
        (shared, None) => shared,
        (SharedEmailFilter::Only, Some(SharedEmailFilter::Exclude)) => return None,
        (_, Some(typed)) => typed,
    };

    filters
        .exclude_views
        .extend(typed.exclude_views.iter().copied());
    filters
        .text_matches
        .extend(typed.text_matches.iter().cloned());
    filters
        .label_names
        .extend(typed.label_names.iter().cloned());
    filters.sent_after = filters.sent_after.max(typed.sent_after);
    filters.sent_before = match (filters.sent_before, typed.sent_before) {
        (Some(set), Some(typed)) => Some(set.min(typed)),
        (set, typed) => set.or(typed),
    };
    Some(filters)
}

/// The filters a query's operators became, as the response reports them,
/// with the shared threads an operator chose.
pub(in crate::api::search) fn reported_filters(query: &EmailQuery) -> EmailFilters {
    EmailFilters {
        shared: query.shared.unwrap_or_default(),
        ..query.filters.clone()
    }
}

/// Reads the email operators out of a search's `terms` when the search
/// reaches email and its match type reads plain words. A search that types
/// a named operator becomes an email search, since no other kind of item can
/// meet it, as a tag filter drops the kinds that carry no tags. A minus
/// before a plain word says nothing about email, so it leaves mail out only
/// beside a named operator or in a search of email alone (`include_crm` asks
/// for CRM companies too); otherwise the word stays a term. Returns the terms
/// left and the operators read, or the terms unchanged and `None`.
pub(in crate::api::search) fn apply_email_operators(
    filters: &mut SearchEntityFilters,
    include_crm: bool,
    terms: Vec<String>,
    match_type: MatchType,
    clock: QueryClock,
) -> (Vec<String>, Option<EmailQuery>) {
    let reads_words = matches!(match_type, MatchType::Exact | MatchType::Partial);
    if !filters.should_include_emails || !reads_words {
        return (terms, None);
    }
    let email_only = !include_crm
        && !filters.should_include_agent_sessions
        && !filters.should_include_documents
        && !filters.should_include_chats
        && !filters.should_include_channels
        && !filters.should_include_projects
        && !filters.should_include_call_records
        && !filters.should_include_calendar_events;
    let mut query = read_email_operators(terms.clone(), clock);
    let leaves_out_words = email_only && !query.excluded_words.is_empty();
    if query.operators == 0 && !leaves_out_words {
        return (terms, None);
    }
    query.leave_out_words();

    filters.should_include_agent_sessions = false;
    filters.should_include_documents = false;
    filters.should_include_chats = false;
    filters.should_include_channels = false;
    filters.should_include_projects = false;
    filters.should_include_call_records = false;
    filters.should_include_calendar_events = false;
    match with_operators(std::mem::take(&mut filters.email_filters), &query) {
        Some(email_filters) => filters.email_filters = email_filters,
        None => filters.should_include_emails = false,
    }
    (query.terms.clone(), Some(query))
}

/// Parses a request's IANA time zone name.
pub(in crate::api::search) fn time_zone(name: Option<&str>) -> Option<Tz> {
    match name {
        None => Some(Tz::UTC),
        Some(name) => name.parse().ok(),
    }
}
