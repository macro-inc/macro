use super::*;
use chrono::TimeZone;
use item_filters::{EmailLabelMatch, EmailSearchView, EmailTextMatch, EmailTextPart};

fn clock(zone: Tz) -> QueryClock {
    QueryClock {
        now: Utc.with_ymd_and_hms(2026, 3, 10, 15, 0, 0).unwrap(),
        zone,
    }
}

fn read(query: &str) -> EmailQuery {
    read_in(query, Tz::UTC)
}

fn read_in(query: &str, zone: Tz) -> EmailQuery {
    let terms = crate::api::search::terms::split_search_terms(&[query.to_string()]);
    read_email_operators(terms, clock(zone))
}

fn text(part: EmailTextPart, text: &str, exclude: bool) -> EmailTextMatch {
    EmailTextMatch {
        part,
        text: text.to_string(),
        exclude,
    }
}

fn utc(year: i32, month: u32, day: u32, hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, hour, 0, 0).unwrap()
}

#[test]
fn plain_words_stay_terms() {
    let query = read("budget review");

    assert_eq!(query.terms, ["budget", "review"]);
    assert_eq!(query.operators, 0);
    assert_eq!(query.filters, EmailFilters::default());
}

#[test]
fn subject_matches_a_word_or_a_quoted_phrase() {
    let query = read(r#"menu subject:lunch SUBJECT:"team lunch""#);

    assert_eq!(query.terms, ["menu"]);
    assert_eq!(
        query.filters.text_matches,
        [
            text(EmailTextPart::Subject, "lunch", false),
            text(EmailTextPart::Subject, "team lunch", false),
        ]
    );
    assert_eq!(query.operators, 2);
}

#[test]
fn people_operators_name_their_part_of_the_message() {
    let query = read("from:ana to:bo cc:cy bcc:di@example.com");

    assert!(query.terms.is_empty());
    assert_eq!(
        query.filters.text_matches,
        [
            text(EmailTextPart::From, "ana", false),
            text(EmailTextPart::To, "bo", false),
            text(EmailTextPart::Cc, "cy", false),
            text(EmailTextPart::Bcc, "di@example.com", false),
        ]
    );
}

#[test]
fn a_minus_leaves_out_an_operator_a_word_or_a_phrase() {
    let query = read(r#"-from:ana -lunch -"team lunch" - e-mail --force"#);

    assert_eq!(query.terms, ["-", "e-mail", "--force"]);
    assert_eq!(
        query.filters.text_matches,
        [text(EmailTextPart::From, "ana", true)]
    );
    assert_eq!(query.excluded_words, ["lunch", "team lunch"]);
    assert_eq!(query.operators, 1);
}

#[test]
fn unknown_operators_and_invalid_values_stay_words() {
    let query = read("is:important has:pdf before:2017/13/01 newer_than:3h in:focus subject: re:");

    assert_eq!(
        query.terms,
        [
            "is:important",
            "has:pdf",
            "before:2017/13/01",
            "newer_than:3h",
            "in:focus",
            "subject:",
            "re:"
        ]
    );
    assert_eq!(query.operators, 0);
    assert_eq!(query.filters, EmailFilters::default());
}

#[test]
fn is_and_has_operators_set_thread_states_and_stack() {
    let query = read("in:sent is:unread is:starred has:attachment");

    assert!(query.terms.is_empty());
    assert_eq!(query.filters.view, Some(EmailSearchView::Sent));
    assert_eq!(query.filters.is_read, Some(false));
    assert_eq!(query.filters.favorite, Some(true));
    assert_eq!(query.filters.has_attachment, Some(true));
    assert_eq!(query.operators, 4);
}

#[test]
fn negated_states_flip() {
    let query = read("-is:unread -is:starred -has:attachment -is:shared");

    assert_eq!(query.filters.is_read, Some(true));
    assert_eq!(query.filters.favorite, Some(false));
    assert_eq!(query.filters.has_attachment, Some(false));
    assert_eq!(query.shared, Some(SharedEmailFilter::Exclude));
}

#[test]
fn aliases_name_the_same_filter() {
    assert_eq!(read("in:favorites").filters, read("is:starred").filters);
    assert_eq!(read("in:shared").shared, read("is:shared").shared);
    assert_eq!(read("in:shared").shared, Some(SharedEmailFilter::Only));
}

#[test]
fn views_map_as_the_mail_lists_filter_them() {
    let inbox = read("in:inbox");
    assert_eq!(inbox.filters.done, Some(false));

    let signal = read("in:signal");
    assert_eq!(signal.filters.importance, Some(true));
    assert_eq!(signal.filters.done, Some(false));

    let noise = read("in:noise");
    assert_eq!(noise.filters.importance, Some(false));

    assert_eq!(read("in:archived").filters.done, Some(true));
    assert_eq!(
        read("in:drafts").filters.view,
        Some(EmailSearchView::Drafts)
    );
    assert_eq!(read("in:calendar").filters.calendar_only, Some(true));
}

#[test]
fn the_last_view_named_wins() {
    let query = read("in:sent in:archived");

    assert_eq!(query.filters.view, None);
    assert_eq!(query.filters.done, Some(true));
    assert!(!query.contradiction);
}

#[test]
fn leaving_out_a_view_stacks_with_the_view_named() {
    let query = read("in:archived -in:sent -in:drafts -in:calendar -in:favorites");

    assert_eq!(query.filters.done, Some(true));
    assert_eq!(
        query.filters.exclude_views,
        [
            EmailSearchView::Sent,
            EmailSearchView::Drafts,
            EmailSearchView::Calendar
        ]
    );
    assert_eq!(query.filters.favorite, Some(false));
    assert_eq!(read("-in:inbox").filters.done, Some(true));
    assert_eq!(read("-in:archived").filters.done, Some(false));
}

#[test]
fn leaving_out_signal_or_noise_is_a_word_left_out() {
    let query = read("-in:signal");

    assert_eq!(query.excluded_words, ["in:signal"]);
    assert_eq!(query.operators, 0);
    assert_eq!(query.filters.importance, None);
    assert_eq!(query.filters.done, None);
}

#[test]
fn opposite_operators_contradict() {
    assert!(read("in:inbox -in:inbox").contradiction);
    assert!(read("is:read is:unread").contradiction);
    assert!(read("is:shared -is:shared").contradiction);
    assert!(!read("is:unread is:unread").contradiction);
}

#[test]
fn labels_come_from_label_and_from_in_with_a_name_that_is_no_view() {
    let query = read(r#"label:travel in:Fundraising -label:"big deals""#);

    assert_eq!(
        query.filters.label_names,
        [
            EmailLabelMatch {
                name: "travel".to_string(),
                exclude: false
            },
            EmailLabelMatch {
                name: "Fundraising".to_string(),
                exclude: false
            },
            EmailLabelMatch {
                name: "big deals".to_string(),
                exclude: true
            },
        ]
    );
}

#[test]
fn dates_start_at_midnight_in_the_viewer_zone() {
    let query = read_in(
        "after:2017/06/01 before:2017-06-08",
        chrono_tz::America::New_York,
    );

    assert_eq!(query.filters.sent_after, Some(utc(2017, 6, 1, 4)));
    assert_eq!(query.filters.sent_before, Some(utc(2017, 6, 8, 4)));
    assert!(!query.reads_now);
}

#[test]
fn a_date_needs_one_separator() {
    assert_eq!(read("after:2017/06-01").terms, ["after:2017/06-01"]);
}

#[test]
fn negated_dates_swap_their_bound() {
    let query = read("-after:2017/06/01 -before:2017/01/01");

    assert_eq!(query.filters.sent_before, Some(utc(2017, 6, 1, 0)));
    assert_eq!(query.filters.sent_after, Some(utc(2017, 1, 1, 0)));
}

#[test]
fn several_bounds_keep_the_narrowest() {
    let query = read("after:2017/01/01 after:2017/03/01 before:2018/01/01 before:2017/12/01");

    assert_eq!(query.filters.sent_after, Some(utc(2017, 3, 1, 0)));
    assert_eq!(query.filters.sent_before, Some(utc(2017, 12, 1, 0)));
}

#[test]
fn relative_dates_count_calendar_units_back_from_now() {
    let query = read("newer_than:3d older_than:1m");

    assert_eq!(query.filters.sent_after, Some(utc(2026, 3, 7, 15)));
    assert_eq!(query.filters.sent_before, Some(utc(2026, 2, 10, 15)));
    assert!(query.reads_now);

    assert_eq!(
        read("newer_than:2w").filters.sent_after,
        Some(utc(2026, 2, 24, 15))
    );
    assert_eq!(
        read("newer_than:1y").filters.sent_after,
        Some(utc(2025, 3, 10, 15))
    );
}

#[test]
fn a_day_back_across_a_daylight_saving_change_keeps_the_wall_clock_time() {
    // 2026-03-08 is the spring change in New York: 15:00 UTC on 10 March is
    // 11:00 EDT, and 11:00 EST three calendar days earlier is 16:00 UTC.
    let query = read_in("newer_than:3d", chrono_tz::America::New_York);

    assert_eq!(query.filters.sent_after, Some(utc(2026, 3, 7, 16)));
}

#[test]
fn a_day_whose_midnight_is_skipped_starts_at_its_first_moment() {
    // Santiago moved its clocks from 00:00 to 01:00 on 2017-08-13.
    let query = read_in("after:2017/08/13", chrono_tz::America::Santiago);

    assert_eq!(query.filters.sent_after, Some(utc(2017, 8, 13, 4)));
}

#[test]
fn operators_narrow_the_request_filters() {
    let request = EmailFilters {
        is_read: Some(false),
        sent_after: Some(utc(2017, 1, 1, 0)),
        text_matches: vec![text(EmailTextPart::From, "ana", false)],
        ..Default::default()
    };
    let query = read("subject:lunch is:unread after:2016/01/01 before:2018/01/01 is:shared");

    let merged = with_operators(request, &query).unwrap();

    assert_eq!(merged.is_read, Some(false));
    assert_eq!(merged.sent_after, Some(utc(2017, 1, 1, 0)));
    assert_eq!(merged.sent_before, Some(utc(2018, 1, 1, 0)));
    assert_eq!(merged.shared, SharedEmailFilter::Only);
    assert_eq!(
        merged.text_matches,
        [
            text(EmailTextPart::From, "ana", false),
            text(EmailTextPart::Subject, "lunch", false),
        ]
    );
}

#[test]
fn operators_that_contradict_the_request_match_nothing() {
    let read_only = EmailFilters {
        is_read: Some(true),
        ..Default::default()
    };
    assert_eq!(with_operators(read_only, &read("is:unread")), None);

    let shared_only = EmailFilters {
        shared: SharedEmailFilter::Only,
        ..Default::default()
    };
    assert_eq!(with_operators(shared_only, &read("-is:shared")), None);

    let drafts = EmailFilters {
        view: Some(EmailSearchView::Drafts),
        ..Default::default()
    };
    assert_eq!(with_operators(drafts, &read("in:sent")), None);
}

#[test]
fn a_time_zone_is_an_iana_name() {
    assert_eq!(time_zone(None), Some(Tz::UTC));
    assert_eq!(
        time_zone(Some("Europe/Paris")),
        Some(chrono_tz::Europe::Paris)
    );
    assert_eq!(time_zone(Some("Mars/Olympus")), None);
}

fn every_kind() -> SearchEntityFilters {
    SearchEntityFilters::from(item_filters::EntityFilters::default())
}

fn terms(query: &str) -> Vec<String> {
    crate::api::search::terms::split_search_terms(&[query.to_string()])
}

#[test]
fn an_operator_makes_the_search_an_email_search() {
    let mut filters = every_kind();
    assert!(filters.should_include_documents);

    let (left, query) = apply_email_operators(
        &mut filters,
        false,
        terms("budget subject:lunch"),
        MatchType::Partial,
        clock(Tz::UTC),
    );

    assert_eq!(left, ["budget"]);
    assert_eq!(query.map(|query| query.operators), Some(1));
    assert!(filters.should_include_emails);
    assert!(!filters.should_include_documents);
    assert!(!filters.should_include_chats);
    assert!(!filters.should_include_channels);
    assert!(!filters.should_include_projects);
    assert!(!filters.should_include_call_records);
    assert!(!filters.should_include_calendar_events);
    assert!(!filters.should_include_agent_sessions);
    assert_eq!(
        filters.email_filters.text_matches,
        [text(EmailTextPart::Subject, "lunch", false)]
    );
}

#[test]
fn a_search_without_operators_keeps_every_kind() {
    let mut filters = every_kind();

    let (left, query) = apply_email_operators(
        &mut filters,
        false,
        terms("budget"),
        MatchType::Partial,
        clock(Tz::UTC),
    );

    assert_eq!(left, ["budget"]);
    assert_eq!(query, None);
    assert!(filters.should_include_documents);
}

#[test]
fn a_search_that_leaves_out_email_reads_operators_as_words() {
    let mut filters = SearchEntityFilters::from(item_filters::EntityFilters {
        email_filters: EmailFilters {
            email_thread_ids: vec![uuid::Uuid::nil().to_string()],
            ..EmailFilters::default()
        },
        ..item_filters::EntityFilters::default()
    });
    assert!(!filters.should_include_emails);

    let (left, query) = apply_email_operators(
        &mut filters,
        false,
        terms("subject:lunch"),
        MatchType::Partial,
        clock(Tz::UTC),
    );

    assert_eq!(left, ["subject:lunch"]);
    assert_eq!(query, None);
    assert!(filters.should_include_documents);
}

#[test]
fn raw_query_syntax_is_left_alone() {
    let mut filters = every_kind();

    let (left, query) = apply_email_operators(
        &mut filters,
        false,
        terms("subject:lunch"),
        MatchType::Regexp,
        clock(Tz::UTC),
    );

    assert_eq!(left, ["subject:lunch"]);
    assert_eq!(query, None);
}

#[test]
fn contradicting_operators_search_nothing() {
    let mut filters = every_kind();

    apply_email_operators(
        &mut filters,
        false,
        terms("is:read is:unread"),
        MatchType::Partial,
        clock(Tz::UTC),
    );

    assert!(!filters.should_include_emails);
    assert!(!filters.should_include_documents);
}

fn email_only() -> SearchEntityFilters {
    let nil = || vec![uuid::Uuid::nil().to_string()];
    SearchEntityFilters::from(item_filters::EntityFilters {
        document_filters: item_filters::DocumentFilters {
            document_ids: nil(),
            ..Default::default()
        },
        chat_filters: item_filters::ChatFilters {
            chat_ids: nil(),
            ..Default::default()
        },
        channel_filters: item_filters::ChannelFilters {
            channel_ids: nil(),
            ..Default::default()
        },
        project_filters: item_filters::ProjectFilters {
            project_ids: nil(),
            ..Default::default()
        },
        call_filters: item_filters::CallFilters {
            channel_ids: nil(),
            ..Default::default()
        },
        calendar_event_filters: item_filters::CalendarEventFilters {
            calendar_event_ids: nil(),
            ..Default::default()
        },
        ..Default::default()
    })
}

#[test]
fn a_minus_word_alone_keeps_every_kind() {
    for query in ["budget -40", "budget -v", "budget --force", "budget -lunch"] {
        let mut filters = every_kind();

        let (left, read) = apply_email_operators(
            &mut filters,
            false,
            terms(query),
            MatchType::Partial,
            clock(Tz::UTC),
        );

        assert_eq!(left, terms(query), "{query}");
        assert_eq!(read, None, "{query}");
        assert!(filters.should_include_documents, "{query}");
        assert!(filters.should_include_channels, "{query}");
        assert!(filters.email_filters.text_matches.is_empty(), "{query}");
    }
}

#[test]
fn a_minus_word_beside_a_named_operator_leaves_mail_out() {
    let mut filters = every_kind();

    let (left, read) = apply_email_operators(
        &mut filters,
        false,
        terms("budget -lunch subject:plan"),
        MatchType::Partial,
        clock(Tz::UTC),
    );

    assert_eq!(left, ["budget"]);
    assert_eq!(read.map(|query| query.operators), Some(2));
    assert!(!filters.should_include_documents);
    assert_eq!(
        filters.email_filters.text_matches,
        [
            text(EmailTextPart::Subject, "plan", false),
            text(EmailTextPart::Any, "lunch", true),
        ]
    );
}

#[test]
fn an_email_search_leaves_out_a_minus_word() {
    let mut filters = email_only();

    let (left, read) = apply_email_operators(
        &mut filters,
        false,
        terms("budget -40 -lunch --force"),
        MatchType::Partial,
        clock(Tz::UTC),
    );

    assert_eq!(left, ["budget", "--force"]);
    assert_eq!(read.map(|query| query.operators), Some(2));
    assert!(filters.should_include_emails);
    assert_eq!(
        filters.email_filters.text_matches,
        [
            text(EmailTextPart::Any, "40", true),
            text(EmailTextPart::Any, "lunch", true),
        ]
    );
}

#[test]
fn a_search_with_crm_companies_is_not_an_email_search() {
    let mut filters = email_only();

    let (left, read) = apply_email_operators(
        &mut filters,
        true,
        terms("budget -lunch"),
        MatchType::Partial,
        clock(Tz::UTC),
    );

    assert_eq!(left, ["budget", "-lunch"]);
    assert_eq!(read, None);
}

fn read_at(query: &str, now: DateTime<Utc>, zone: Tz) -> EmailQuery {
    read_email_operators(terms(query), QueryClock { now, zone })
}

#[test]
fn a_relative_date_on_a_skipped_hour_starts_after_the_skip() {
    // 06:30 UTC on 9 March 2026 is 02:30 in New York; a day earlier, 02:30 on
    // 8 March, is skipped by the spring change (02:00 to 03:00 EDT).
    let query = read_at(
        "newer_than:1d",
        Utc.with_ymd_and_hms(2026, 3, 9, 6, 30, 0).unwrap(),
        chrono_tz::America::New_York,
    );

    assert!(query.terms.is_empty());
    assert_eq!(query.filters.sent_after, Some(utc(2026, 3, 8, 7)));
}

#[test]
fn a_relative_date_on_a_repeated_hour_takes_its_earlier_instant() {
    // 06:30 UTC on 2 November 2026 is 01:30 EST in New York; 01:30 on
    // 1 November happens twice, at 05:30 UTC (EDT) and 06:30 UTC (EST).
    let query = read_at(
        "older_than:1d",
        Utc.with_ymd_and_hms(2026, 11, 2, 6, 30, 0).unwrap(),
        chrono_tz::America::New_York,
    );

    assert!(query.terms.is_empty());
    assert_eq!(
        query.filters.sent_before,
        Some(Utc.with_ymd_and_hms(2026, 11, 1, 5, 30, 0).unwrap())
    );
}

#[derive(serde::Deserialize)]
struct TypedOperator {
    typed: String,
    operator: bool,
}

/// The terms Mail's search field draws as operators, which its web tests read
/// too: each is read as exactly one operator here, and each other one stays a
/// word.
#[test]
fn mail_search_draws_exactly_the_operators_the_service_reads() {
    let cases: Vec<TypedOperator> = serde_json::from_str(include_str!("typed_operators.json"))
        .expect("typed_operators.json lists terms and whether each is an operator");

    let wrong: Vec<&str> = cases
        .iter()
        .filter(|case| {
            let query = read(&case.typed);
            let read_as_operator = query.operators == 1
                && query.terms.is_empty()
                && query.excluded_words.is_empty();
            read_as_operator != case.operator
        })
        .map(|case| case.typed.as_str())
        .collect();

    assert!(wrong.is_empty(), "read otherwise than listed: {wrong:?}");
}
