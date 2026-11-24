//! Email search words, and the conditions typed Mail search operators
//! become, against a real OpenSearch: each runs inside the unified request,
//! with its sort and highlighter, and keeps exactly the messages it names.

use std::{collections::BTreeSet, sync::LazyLock};

use anyhow::bail;
use models_search_cursor::SearchCursorOption;
use opensearch::{DeleteByQueryParts, OpenSearch};
use opensearch_client::{
    OpensearchClient,
    date_format::EpochMillis,
    search::{
        emails::{EmailLabelCondition, EmailTextCondition, EmailTextFields},
        model::SearchGotoContent,
        unified::{UnifiedEmailSearchArgs, UnifiedSearchArgs},
    },
    upsert::{email::UpsertEmailArgs, properties::IndexedProperty},
};
use uuid::Uuid;

use crate::{OTHER, SEARCH_INDICES, VIEWER, count_documents, refresh, test_clients};

const EMAILS: &str = "emails";
const LINK: &str = "5ea4c400-0000-4000-8000-00000000e000";
/// The inbox of the other person's mail, which can reach the viewer only as a
/// thread shared with them.
const OTHER_LINK: &str = "5ea4c400-0000-4000-8000-00000000e001";
const TAG_DEFINITION: &str = "5ea4c400-0000-4000-8000-00000000e0de";
const TAG_OPTION: &str = "5ea4c400-0000-4000-8000-00000000e0e0";

/// 2024-06-01, 2025-03-01 and 2025-11-01 at midnight UTC.
const JUNE_2024: i64 = 1_717_200_000_000;
const MARCH_2025: i64 = 1_740_787_200_000;
const NOVEMBER_2025: i64 = 1_761_955_200_000;
const JANUARY_2025: i64 = 1_735_689_600_000;

fn thread(n: u128) -> Uuid {
    Uuid::from_u128(0x5ea4_c400_0000_4000_8000_0000_0000_e100 + n)
}

struct Message {
    thread: Uuid,
    owner: &'static str,
    subject: &'static str,
    content: &'static str,
    sender: (&'static str, &'static str),
    recipients: Vec<(&'static str, &'static str)>,
    cc: Vec<(&'static str, &'static str)>,
    bcc: Vec<(&'static str, &'static str)>,
    labels: Vec<&'static str>,
    sent_at_millis: Option<i64>,
    tagged: bool,
}

const ANA: (&str, &str) = ("Ana Lopez", "ana@probe.example");
const BO: (&str, &str) = ("Bo Chen", "bo@probe.example");
const CY: (&str, &str) = ("Cy Diaz", "cy@probe.example");
const DI: (&str, &str) = ("Di Eve", "di@probe.example");

fn messages() -> Vec<Message> {
    vec![
        Message {
            thread: thread(1),
            owner: VIEWER,
            subject: "Team lunch on Friday",
            content: "menu attached",
            sender: ANA,
            recipients: vec![BO],
            cc: Vec::new(),
            bcc: Vec::new(),
            labels: vec!["INBOX", "travel"],
            sent_at_millis: Some(MARCH_2025),
            tagged: false,
        },
        Message {
            thread: thread(2),
            owner: VIEWER,
            subject: "Quarterly numbers",
            content: "the lunch was great",
            sender: BO,
            recipients: vec![ANA],
            cc: vec![CY],
            bcc: Vec::new(),
            labels: vec!["INBOX"],
            sent_at_millis: Some(JUNE_2024),
            tagged: false,
        },
        Message {
            thread: thread(3),
            owner: VIEWER,
            subject: "lunch menu",
            content: "weekly",
            sender: CY,
            recipients: vec![DI],
            cc: Vec::new(),
            bcc: vec![ANA],
            labels: vec!["newsletters"],
            sent_at_millis: Some(NOVEMBER_2025),
            tagged: false,
        },
        Message {
            thread: thread(4),
            owner: VIEWER,
            subject: "Hiring plan",
            content: "team plans later",
            sender: DI,
            recipients: vec![ANA],
            cc: Vec::new(),
            bcc: Vec::new(),
            labels: Vec::new(),
            sent_at_millis: None,
            tagged: true,
        },
        Message {
            thread: thread(5),
            owner: OTHER,
            subject: "lunch",
            content: "lunch",
            sender: ANA,
            recipients: vec![ANA],
            cc: Vec::new(),
            bcc: Vec::new(),
            labels: vec!["travel"],
            sent_at_millis: Some(MARCH_2025),
            tagged: true,
        },
    ]
}

fn upsert_args(message: &Message) -> anyhow::Result<UpsertEmailArgs> {
    let addresses = |people: &[(&str, &str)]| people.iter().map(|(_, a)| a.to_string()).collect();
    let names = |people: &[(&str, &str)]| people.iter().map(|(n, _)| n.to_string()).collect();
    Ok(UpsertEmailArgs {
        thread_id: message.thread.to_string(),
        message_id: message.thread.to_string(),
        sender: message.sender.1.to_string(),
        sender_name: Some(message.sender.0.to_string()),
        reply_to: None,
        recipients: addresses(&message.recipients),
        recipient_names: names(&message.recipients),
        cc: addresses(&message.cc),
        cc_names: names(&message.cc),
        bcc: addresses(&message.bcc),
        bcc_names: names(&message.bcc),
        labels: message.labels.iter().map(|l| l.to_string()).collect(),
        link_id: if message.owner == VIEWER {
            LINK
        } else {
            OTHER_LINK
        }
        .to_string(),
        user_id: message.owner.to_string(),
        updated_at_millis: EpochMillis::new(message.sent_at_millis.unwrap_or(JUNE_2024))?,
        subject: Some(message.subject.to_string()),
        sent_at_millis: message.sent_at_millis.map(EpochMillis::new).transpose()?,
        content: message.content.to_string(),
        properties: if message.tagged {
            vec![IndexedProperty {
                definition_id: TAG_DEFINITION.to_string(),
                values: vec![TAG_OPTION.to_string()],
                number_value: None,
                date_value: None,
            }]
        } else {
            Vec::new()
        },
    })
}

fn text(fields: EmailTextFields, text: &str, exclude: bool) -> EmailTextCondition {
    EmailTextCondition {
        fields,
        text: text.to_string(),
        exclude,
    }
}

fn label(labels: &[&str], tagged: bool, exclude: bool) -> EmailLabelCondition {
    EmailLabelCondition {
        labels: labels.iter().map(|l| l.to_string()).collect(),
        tag_option_ids: if tagged {
            vec![TAG_OPTION.to_string()]
        } else {
            Vec::new()
        },
        exclude,
    }
}

struct Case {
    name: String,
    args: UnifiedEmailSearchArgs,
    match_type: &'static str,
    expected: &'static [u128],
    /// The labels each named hit must come back with, when the case checks
    /// them.
    labels: &'static [(u128, &'static [&'static str])],
}

fn case(name: &str, terms: &[&str], expected: &'static [u128]) -> Case {
    Case {
        name: name.to_string(),
        args: UnifiedEmailSearchArgs {
            terms: terms.iter().map(|t| t.to_string()).collect(),
            user_ids: vec![VIEWER.to_string()],
            label_link_ids: vec![LINK.to_string()],
            ..Default::default()
        },
        match_type: "partial",
        expected,
        labels: &[],
    }
}

fn cases() -> Vec<Case> {
    let mut cases = Vec::new();
    let mut with = |mut case: Case, set: &dyn Fn(&mut UnifiedEmailSearchArgs)| {
        set(&mut case.args);
        cases.push(case);
    };
    with(case("subject:lunch", &[], &[1, 3]), &|args| {
        args.text_conditions = vec![text(EmailTextFields::Subject, "lunch", false)];
    });
    with(case("subject:\"team lunch\"", &[], &[1]), &|args| {
        args.text_conditions = vec![text(EmailTextFields::Subject, "team lunch", false)];
    });
    with(case("from:ana", &[], &[1]), &|args| {
        args.text_conditions = vec![text(EmailTextFields::From, "ana", false)];
    });
    with(
        case("to:ana covers To, Cc and Bcc", &[], &[2, 3, 4]),
        &|args| {
            args.text_conditions = vec![text(EmailTextFields::To, "ana", false)];
        },
    );
    with(case("cc:cy", &[], &[2]), &|args| {
        args.text_conditions = vec![text(EmailTextFields::Cc, "cy", false)];
    });
    with(case("lunch -subject:lunch", &["lunch"], &[2]), &|args| {
        args.text_conditions = vec![text(EmailTextFields::Subject, "lunch", true)];
    });
    with(case("-lunch alone", &[], &[4]), &|args| {
        args.text_conditions = vec![text(EmailTextFields::Any, "lunch", true)];
    });
    with(case("after:2025/01/01", &[], &[1, 3]), &|args| {
        args.sent_after_millis = Some(JANUARY_2025);
    });
    with(case("before:2025/01/01", &[], &[2]), &|args| {
        args.sent_before_millis = Some(JANUARY_2025);
    });
    with(case("lunch between two days", &["lunch"], &[1]), &|args| {
        args.sent_after_millis = Some(JANUARY_2025);
        args.sent_before_millis = Some(NOVEMBER_2025);
    });
    with(case("label:travel", &[], &[1]), &|args| {
        args.label_conditions = vec![label(&["travel"], false, false)];
    });
    with(case("a tag or a label", &[], &[1, 4]), &|args| {
        args.label_conditions = vec![label(&["travel"], true, false)];
    });
    with(
        case("lunch -label:newsletters", &["lunch"], &[1, 2]),
        &|args| {
            args.label_conditions = vec![label(&["newsletters"], false, true)];
        },
    );
    // Thread 5 is the other person's, shared with the viewer. It carries a
    // label of the same name in its owner's inbox, which is not the viewer's.
    let shared = || vec![thread(5).to_string()];
    with(
        case("a shared thread is searched", &["lunch"], &[1, 2, 3, 5]),
        &|args| {
            args.thread_ids = shared();
        },
    );
    with(
        case(
            "label:travel leaves out a shared thread's own label",
            &[],
            &[1],
        ),
        &|args| {
            args.thread_ids = shared();
            args.label_conditions = vec![label(&["travel"], false, false)];
        },
    );
    with(
        case(
            "lunch -label:travel keeps a shared thread",
            &["lunch"],
            &[2, 3, 5],
        ),
        &|args| {
            args.thread_ids = shared();
            args.label_conditions = vec![label(&["travel"], false, true)];
        },
    );
    with(
        case(
            "include_labels leaves out a shared thread's own label",
            &[],
            &[1],
        ),
        &|args| {
            args.thread_ids = shared();
            args.include_labels = vec!["travel".to_string()];
        },
    );
    with(
        case(
            "exclude_labels keeps a shared thread",
            &["lunch"],
            &[2, 3, 5],
        ),
        &|args| {
            args.thread_ids = shared();
            args.exclude_labels = vec!["travel".to_string()];
        },
    );
    with(
        Case {
            labels: &[(1, &["INBOX", "travel"]), (5, &[])],
            ..case(
                "a shared thread's hit carries no labels",
                &["lunch"],
                &[1, 2, 3, 5],
            )
        },
        &|args| {
            args.thread_ids = shared();
        },
    );
    with(
        case("lunch without a thread", &["lunch"], &[2, 3]),
        &|args| {
            args.exclude_thread_ids = vec![thread(1).to_string()];
        },
    );
    with(case("combined", &[], &[3]), &|args| {
        args.text_conditions = vec![
            text(EmailTextFields::Subject, "lunch", false),
            text(EmailTextFields::From, "cy", false),
        ];
        args.sent_after_millis = Some(JANUARY_2025);
        args.label_conditions = vec![label(&["travel"], false, true)];
    });
    cases
}

#[tokio::test]
async fn typed_email_conditions_keep_exactly_the_messages_they_name() -> anyhow::Result<()> {
    search_seeded(messages(), cases()).await
}

const MARY_JANE: (&str, &str) = ("Mary-Jane Watts", "mj@probe.example");

/// Mail holding words the analyzer splits at a hyphen, and mail holding the
/// same words apart, in one field and across two.
fn hyphenated_messages() -> Vec<Message> {
    let message = |n, subject, content, sender| Message {
        thread: thread(n),
        owner: VIEWER,
        subject,
        content,
        sender,
        recipients: vec![ANA],
        cc: Vec::new(),
        bcc: Vec::new(),
        labels: vec!["INBOX"],
        sent_at_millis: Some(MARCH_2025),
        tagged: false,
    };
    vec![
        message(
            11,
            "Re: Follow-up on the re-org",
            "see the e-mail below",
            BO,
        ),
        message(12, "follow the plan", "we follow it up next: mail", CY),
        message(13, "Quarterly numbers", "attached", MARY_JANE),
    ]
}

fn hyphenated_cases() -> Vec<Case> {
    let mut cases = vec![
        case("follow-up", &["follow-up"], &[11]),
        case(
            "follow-u, the last word still being typed",
            &["follow-u"],
            &[11],
        ),
        case("re-org", &["re-org"], &[11]),
        case("e-mail in the body", &["e-mail"], &[11]),
        case("Mary-Jane, a sender name", &["Mary-Jane"], &[13]),
        case("follow-up beside a word", &["below", "follow-up"], &[11]),
        case("two hyphenated words", &["follow-up", "re-org"], &[11]),
        case("a pasted reply subject", &["Re:", "Follow-up"], &[11]),
        case("follow-, on the way to follow-up", &["follow-"], &[11, 12]),
        case("follow, one word", &["follow"], &[11, 12]),
    ];
    let mut with = |mut case: Case, set: &dyn Fn(&mut UnifiedEmailSearchArgs)| {
        set(&mut case.args);
        cases.push(case);
    };
    with(case("subject:follow-up", &[], &[11]), &|args| {
        args.text_conditions = vec![text(EmailTextFields::Subject, "follow-up", false)];
    });
    with(case("from:mary-jane", &[], &[13]), &|args| {
        args.text_conditions = vec![text(EmailTextFields::From, "mary-jane", false)];
    });
    with(case("follow -follow-up", &["follow"], &[12]), &|args| {
        args.text_conditions = vec![text(EmailTextFields::Any, "follow-up", true)];
    });
    cases
}

#[tokio::test]
async fn a_hyphenated_word_finds_the_mail_that_holds_it() -> anyhow::Result<()> {
    search_seeded(hyphenated_messages(), hyphenated_cases()).await
}

/// Mail holding a word in its text, in an address, and nowhere.
fn punctuated_messages() -> Vec<Message> {
    let message = |n, subject, content, sender| Message {
        thread: thread(n),
        owner: VIEWER,
        subject,
        content,
        sender,
        recipients: vec![ANA],
        cc: Vec::new(),
        bcc: Vec::new(),
        labels: vec!["INBOX"],
        sent_at_millis: Some(MARCH_2025),
        tagged: false,
    };
    vec![
        message(21, "Team lunch", "menu attached", BO),
        message(22, "Weekly plan", "agenda", LUNCH_DESK),
        message(23, "Quarterly numbers", "two figures", CY),
        message(24, "Sonata in C♯", "for piano", DI),
        message(25, "Grade C", "for effort", DI),
    ]
}

const LUNCH_DESK: (&str, &str) = ("Canteen", "lunch@probe.example");

/// A term's punctuation is never query syntax: a term matches by its words,
/// as it matches documents.
fn punctuated_cases() -> Vec<Case> {
    let words = || {
        [
            case("lunch", &["lunch"], &[21, 22]),
            case("-lunch", &["-lunch"], &[21, 22]),
            case("--lunch", &["--lunch"], &[21, 22]),
            case("-lunch -menu", &["-lunch", "-menu"], &[21]),
            case("numbers -lunch", &["numbers", "-lunch"], &[]),
            case("a minus before a word no mail holds", &["-zebra"], &[]),
            case("a minus before a phrase", &["-team lunch"], &[21]),
            case("a minus before a hyphenated word", &["-team-lunch"], &[21]),
            case("(lunch", &["(lunch"], &[21, 22]),
            case("+lunch)", &["+lunch)"], &[21, 22]),
            case("lunch~2", &["lunch~2"], &[]),
            case("lunch|numbers", &["lunch|numbers"], &[]),
            case("a symbol the index keeps", &["C♯"], &[24]),
            case("a phrase ending in a backslash", &["team lunch\\"], &[21]),
            case("words a backslash joins", &["lunch\\|numbers"], &[]),
            case("a minus alone", &["-"], &[]),
        ]
    };
    let mut cases = Vec::new();
    for match_type in ["partial", "exact"] {
        cases.extend(words().map(|case| Case { match_type, ..case }));
    }
    let mut with = |mut case: Case, set: &dyn Fn(&mut UnifiedEmailSearchArgs)| {
        set(&mut case.args);
        cases.push(case);
    };
    with(case("subject:-lunch", &[], &[21]), &|args| {
        args.text_conditions = vec![text(EmailTextFields::Subject, "-lunch", false)];
    });
    with(case("from:-lunch", &[], &[22]), &|args| {
        args.text_conditions = vec![text(EmailTextFields::From, "-lunch", false)];
    });
    cases
}

#[tokio::test]
async fn a_term_matches_by_its_words_whatever_punctuation_it_carries() -> anyhow::Result<()> {
    search_seeded(punctuated_messages(), punctuated_cases()).await
}

/// Mail that holds an address in its address fields and words in its text.
fn address_and_text_messages() -> Vec<Message> {
    let message = |n, subject, content, sender, recipient| Message {
        thread: thread(n),
        owner: VIEWER,
        subject,
        content,
        sender,
        recipients: vec![recipient],
        cc: Vec::new(),
        bcc: Vec::new(),
        labels: vec!["INBOX"],
        sent_at_millis: Some(MARCH_2025),
        tagged: false,
    };
    vec![
        message(51, "Quarterly numbers", "two figures", ANA, BO),
        message(52, "Quarterly plan", "one figure", BO, CY),
        message(53, "Hiring plan", "attached", ANA, BO),
        message(54, "Quarterly numbers", "one figure", CY, DI),
        message(55, "A follow-up", "half a cup", BO, DI),
    ]
}

/// An address matches apart from the words, which match together.
fn address_and_text_cases() -> Vec<Case> {
    let words = || {
        [
            case("an address", &["ana@probe.example"], &[51, 53]),
            case("a word", &["numbers"], &[51, 54]),
            case(
                "an address and a word",
                &["ana@probe.example", "numbers"],
                &[51],
            ),
            case(
                "a word and an address",
                &["numbers", "ana@probe.example"],
                &[51],
            ),
            case(
                "an address and a phrase",
                &["ana@probe.example", "quarterly numbers"],
                &[51],
            ),
            case(
                "an address and a hyphenated word it does not hold",
                &["ana@probe.example", "follow-up"],
                &[],
            ),
            case("a domain and a word", &["probe.example", "hiring"], &[53]),
            case(
                "a sender and a recipient and a word",
                &["ana@probe.example", "bo@probe.example", "plan"],
                &[53],
            ),
            case(
                "a name in an address and a word",
                &["bo", "plan"],
                &[52, 53],
            ),
            case(
                "a word and one the analyzer drops",
                &["plan", "½"],
                &[52, 53],
            ),
            case(
                "words around one the analyzer drops",
                &["quarterly", "½", "plan"],
                &[52],
            ),
            case(
                "an address and a word the analyzer drops",
                &["ana@probe.example", "½"],
                &[51, 53],
            ),
            case(
                "an address, a word and one the analyzer drops",
                &["ana@probe.example", "½", "numbers"],
                &[51],
            ),
            case(
                "an address, a hyphenated word and one the analyzer drops",
                &["bo@probe.example", "½", "follow-up"],
                &[55],
            ),
            case(
                "a domain typed with a comma and a word",
                &["probe.example,", "hiring"],
                &[53],
            ),
            case(
                "a domain typed with a full stop and a word",
                &["probe.example。", "hiring"],
                &[53],
            ),
            case("a handle and a word", &["@ana", "hiring"], &[53]),
            case(
                "a word of every address and a word of the text",
                &["probe", "plan"],
                &[],
            ),
            case("two words in the text", &["quarterly", "plan"], &[52]),
            case(
                "a word and an address no mail holds",
                &["plan", "zed@probe.example"],
                &[],
            ),
        ]
    };
    let mut cases = Vec::new();
    for match_type in ["partial", "exact"] {
        cases.extend(words().map(|case| Case { match_type, ..case }));
    }
    let mut left_out = case("a word and an address, left out", &["plan"], &[52]);
    left_out.args.text_conditions = vec![text(EmailTextFields::Any, "ana@probe.example", true)];
    cases.push(left_out);
    let mut from = case("a word and from:", &["numbers"], &[51]);
    from.args.text_conditions = vec![text(EmailTextFields::From, "ana@probe.example", false)];
    cases.push(from);
    cases
}

#[tokio::test]
async fn an_address_beside_a_word_finds_the_mail_that_holds_both() -> anyhow::Result<()> {
    search_seeded(address_and_text_messages(), address_and_text_cases()).await
}

/// A message whose subject, body and every name field hold `text`.
fn message_holding(n: u128, text: &'static str) -> Message {
    Message {
        thread: thread(n),
        owner: VIEWER,
        subject: text,
        content: text,
        sender: (text, BO.1),
        recipients: vec![(text, ANA.1)],
        cc: vec![(text, CY.1)],
        bcc: vec![(text, DI.1)],
        labels: vec!["INBOX"],
        sent_at_millis: Some(MARCH_2025),
        tagged: false,
    }
}

/// Three hundred words that start with `pa`, three hundred Thai runs that
/// start with `กาน`, and `pa²`, which the tokenizer reads as `pa`.
static SHARED_PREFIXES: LazyLock<String> = LazyLock::new(|| {
    let consonant = |n: usize| ('ก'..='ฮ').nth(n).unwrap_or('ก');
    let words: String = (0..300)
        .map(|n| format!("pa{n} กาน{}{} ", consonant(n / 46), consonant(n % 46)))
        .collect();
    format!("{words} pa²")
});

/// A term the app reads as several words, or as a word and a symbol, and the
/// tokenizer as one token. A phrase prefix of one token costs a clause for each
/// word that shares its prefix.
#[tokio::test]
async fn a_term_of_one_token_finds_its_mail_whatever_shares_its_prefix() -> anyhow::Result<()> {
    let messages = vec![
        message_holding(41, SHARED_PREFIXES.as_str()),
        message_holding(42, "pa1 and pa2"),
        message_holding(43, "กานกก๒๕๖๗"),
        message_holding(44, "第１２３回 lunch🎉"),
        // The same tokens, apart.
        message_holding(45, "１２３ then 第, and ๒๕๖๗ then กานกก"),
    ];
    let mut cases = vec![
        case("a word and a superscript", &["pa²"], &[41]),
        case("a word before a currency sign", &["pa៛"], &[41]),
        case("a word after a currency sign", &["฿pa"], &[41, 42]),
        case("a Thai run still being typed", &["กาน"], &[41, 43, 45]),
        case("a Thai run and digits", &["กานกก๒๕"], &[43]),
        case("an ideograph and full-width digits", &["第１２"], &[44]),
        case("a word and an emoji", &["lunch🎉"], &[44]),
    ];
    let mut left_out = case("a word and a superscript, left out", &[], &[42, 43, 44, 45]);
    left_out.args.text_conditions = vec![text(EmailTextFields::Any, "pa²", true)];
    cases.push(left_out);
    search_seeded(messages, cases).await
}

/// The most terms the search service accepts (`MAX_SEARCH_TERMS`).
const TERM_CAP: usize = 50;

/// [`TERM_CAP`] terms of each shape, by name. Those of several words end in a
/// word that starts several others, so a phrase prefix expands it.
static TERMS_AT_THE_CAP: LazyLock<Vec<(&'static str, Vec<String>)>> = LazyLock::new(|| {
    let letter = |n: usize| ('a'..='z').cycle().nth(n).unwrap_or('a');
    let ideograph = |n: usize| ('一'..='龥').nth(n).unwrap_or('一');
    let emoji = |n: usize| ('😀'..='🙏').cycle().nth(n).unwrap_or('😀');
    let consonant = |n: usize| ('ก'..='ฮ').cycle().nth(n).unwrap_or('ก');
    let shapes: [(&'static str, &dyn Fn(usize) -> String); 19] = [
        ("words", &|n| format!("word{n}")),
        ("minus words", &|n| format!("-word{n}")),
        ("hyphenated words", &|n| format!("word{n}-{}", letter(n))),
        ("words and hyphenated words", &|n| match n % 4 {
            3 => format!("word{n}-{}", letter(n)),
            _ => format!("word{n}"),
        }),
        ("dates", &|n| {
            format!("2025-{:02}-{:02}", n % 12 + 1, n % 28 + 1)
        }),
        ("forty segments", &|n| {
            let segments: Vec<String> = (n..n + 40).map(|s| letter(s).to_string()).collect();
            segments.join("-")
        }),
        ("two ideographs", &|n| {
            [ideograph(2 * n), ideograph(2 * n + 1)].iter().collect()
        }),
        ("three ideographs", &|n| {
            (3 * n..3 * n + 3).map(ideograph).collect()
        }),
        ("Thai runs", &|n| format!("กาน{}", consonant(n))),
        ("Thai runs and digits", &|n| {
            format!("กาน{}๒๕", consonant(n))
        }),
        ("prices in baht", &|n| format!("฿{n}00")),
        ("words with a superscript", &|n| format!("word{n}²")),
        ("forty emoji", &|n| (n..n + 40).map(emoji).collect()),
        ("a word and an emoji", &|n| format!("word{n}{}", emoji(n))),
        ("emoji and a hyphenated word", &|n| {
            let before: String = (n..n + 4).map(emoji).collect();
            format!("{before}word{n}-{}", letter(n))
        }),
        ("urls", &|n| {
            format!("https://probe{n}.example/a/word{n}-b/c?d=e{n}")
        }),
        ("addresses", &|n| format!("word{n}@probe{n}.example")),
        ("phrases", &|n| format!("word{n} probe{n} word{n}")),
        ("phrases over a tab and a line", &|n| {
            format!("word{n}\tprobe{n}\nword{n}\tprobe{n}")
        }),
    ];
    shapes
        .into_iter()
        .map(|(name, term)| (name, (0..TERM_CAP).map(term).collect()))
        .collect()
});

/// Holds every term of [`TERMS_AT_THE_CAP`], and every term's last word again
/// as the start of another.
static HOLDS_EVERY_TERM: LazyLock<String> = LazyLock::new(|| {
    TERMS_AT_THE_CAP
        .iter()
        .flat_map(|(_, terms)| terms)
        .map(|term| format!("{term} {term}x\n"))
        .collect()
});

/// Term counts up to the cap. How many terms reach OpenSearch's clause limit
/// depends on their shape, so the form that fits each changes between these.
const TERM_COUNTS: [usize; 4] = [14, 30, 45, TERM_CAP];

/// Every shape at each of [`TERM_COUNTS`], with every filter a search can
/// carry beside the terms, beside an address, and as that many left-out words.
fn cap_cases() -> Vec<Case> {
    let mut cases = Vec::new();
    for (shape, terms) in TERMS_AT_THE_CAP.iter() {
        let terms: Vec<&str> = terms.iter().map(String::as_str).collect();
        // Regexp input with no syntax in it runs up to the cap too.
        let match_types: &[&'static str] = match *shape {
            "words" | "two ideographs" => &["partial", "exact", "regexp"],
            _ => &["partial", "exact"],
        };
        let holds_word_1 = matches!(
            *shape,
            "words" | "minus words" | "words and hyphenated words" | "words with a superscript"
        );
        for count in TERM_COUNTS {
            let terms = &terms[..count];
            let name = format!("{count} {shape}");
            for match_type in match_types {
                let mut found = case(&name, terms, &[31]);
                found.args.link_ids = vec![LINK.to_string()];
                found.args.exclude_link_ids = vec![thread(2).to_string()];
                found.args.exclude_thread_ids = vec![thread(34).to_string()];
                found.args.include_labels = vec!["INBOX".to_string()];
                found.args.exclude_labels = vec!["TRASH".to_string(), "SPAM".to_string()];
                found.args.label_conditions = vec![label(&["travel"], true, true)];
                found.args.sender = vec![BO.1.to_string()];
                found.args.recipients = vec![ANA.1.to_string()];
                found.args.importance = Some(true);
                found.args.sent_after_millis = Some(JANUARY_2025);
                found.args.sent_before_millis = Some(NOVEMBER_2025);
                cases.push(Case {
                    match_type,
                    ..found
                });

                // An emoji is left out beside an address.
                let holds_the_rest: &[u128] = match *shape {
                    "forty emoji" => &[31, 32, 33],
                    _ => &[31],
                };
                let beside_an_address = [&[BO.1], &terms[1..]].concat();
                cases.push(Case {
                    match_type,
                    ..case(
                        &format!("an address and {name}"),
                        &beside_an_address,
                        holds_the_rest,
                    )
                });

                let left_out: &[u128] = if holds_word_1 { &[33] } else { &[32, 33] };
                let mut without = case(&name, &[], left_out);
                without.args.text_conditions = terms
                    .iter()
                    .map(|term| text(EmailTextFields::Any, term, true))
                    .collect();
                cases.push(Case {
                    match_type,
                    ..without
                });
            }
        }
    }
    cases
}

#[tokio::test]
async fn a_search_at_the_term_cap_finds_the_mail_that_holds_every_term() -> anyhow::Result<()> {
    let messages = vec![
        message_holding(31, HOLDS_EVERY_TERM.as_str()),
        message_holding(32, "word1 and nothing else"),
        message_holding(33, "none of them"),
    ];
    search_seeded(messages, cap_cases()).await
}

/// Seeds `messages` into an `emails` index holding nothing else, runs each
/// case, removes what it seeded, and fails on any case that kept other
/// messages than it names.
async fn search_seeded(messages: Vec<Message>, cases: Vec<Case>) -> anyhow::Result<()> {
    let _one_at_a_time = SEARCH_INDICES.lock().await;
    let (client, raw, url) = test_clients()?;
    let seeded: Vec<String> = messages.iter().map(|m| m.thread.to_string()).collect();

    let others = count_documents(
        &raw,
        EMAILS,
        serde_json::json!({ "bool": { "must_not": [{ "terms": { "entity_id": seeded } }] } }),
    )
    .await?;
    if others != 0 {
        bail!("`{EMAILS}` at {url} holds {others} documents this test did not write");
    }

    let result = seed_and_search(&client, &raw, &messages, cases).await;
    let removed = remove(&raw, &seeded).await;
    let failures = match (result, removed) {
        (Err(error), Err(cleanup)) => {
            bail!("{error:#}; removing what it seeded also failed: {cleanup:#}")
        }
        (result, removed) => {
            removed?;
            result?
        }
    };
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    Ok(())
}

async fn seed_and_search(
    client: &OpensearchClient,
    raw: &OpenSearch,
    messages: &[Message],
    cases: Vec<Case>,
) -> anyhow::Result<Vec<String>> {
    for message in messages {
        client.upsert_email_message(&upsert_args(message)?).await?;
    }
    refresh(raw, EMAILS).await?;

    let mut failures = Vec::new();
    for case in cases {
        let args = UnifiedSearchArgs {
            user_id: VIEWER.to_string(),
            page_size: 50,
            match_type: case.match_type.to_string(),
            cursor: SearchCursorOption::default(),
            search_indices: [models_opensearch::OpenSearchEntityType::Emails].into(),
            email_search_args: case.args,
            ..Default::default()
        };
        let (hits, _) = client.search_unified(args).await?;
        for (n, expected) in case.labels {
            let carried: Vec<Vec<String>> = hits
                .iter()
                .filter(|hit| hit.entity_id == thread(*n))
                .filter_map(|hit| match &hit.goto {
                    Some(SearchGotoContent::Emails(goto)) => Some(goto.labels.clone()),
                    _ => None,
                })
                .collect();
            if carried.is_empty() || carried.iter().any(|labels| labels != expected) {
                failures.push(format!(
                    "{} ({}): thread {n} expected labels {expected:?}, found {carried:?}",
                    case.name, case.match_type
                ));
            }
        }
        let found: BTreeSet<Uuid> = hits.iter().map(|hit| hit.entity_id).collect();
        let expected: BTreeSet<Uuid> = case.expected.iter().map(|n| thread(*n)).collect();
        if found != expected {
            failures.push(format!(
                "{} ({}): expected {expected:?}, found {found:?}",
                case.name, case.match_type
            ));
        }
    }
    Ok(failures)
}

async fn remove(raw: &OpenSearch, seeded: &[String]) -> anyhow::Result<()> {
    refresh(raw, EMAILS).await?;
    raw.delete_by_query(DeleteByQueryParts::Index(&[EMAILS]))
        .refresh(true)
        .body(serde_json::json!({ "query": { "terms": { "entity_id": seeded } } }))
        .send()
        .await?
        .error_for_status_code()?;
    Ok(())
}
