//! The conditions typed Mail search operators become, against a real
//! OpenSearch: each runs inside the unified request, with its sort and
//! highlighter, and keeps exactly the messages it names.

use std::collections::BTreeSet;

use anyhow::bail;
use models_search_cursor::SearchCursorOption;
use opensearch::{DeleteByQueryParts, OpenSearch};
use opensearch_client::{
    OpensearchClient,
    date_format::EpochMillis,
    search::{
        emails::{EmailLabelCondition, EmailTextCondition, EmailTextFields},
        unified::{UnifiedEmailSearchArgs, UnifiedSearchArgs},
    },
    upsert::{email::UpsertEmailArgs, properties::IndexedProperty},
};
use uuid::Uuid;

use crate::{OTHER, SEARCH_INDICES, VIEWER, count_documents, refresh, test_clients};

const EMAILS: &str = "emails";
const LINK: &str = "5ea4c400-0000-4000-8000-00000000e000";
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
        link_id: LINK.to_string(),
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
    name: &'static str,
    args: UnifiedEmailSearchArgs,
    expected: &'static [u128],
}

fn case(name: &'static str, terms: &[&str], expected: &'static [u128]) -> Case {
    Case {
        name,
        args: UnifiedEmailSearchArgs {
            terms: terms.iter().map(|t| t.to_string()).collect(),
            user_ids: vec![VIEWER.to_string()],
            ..Default::default()
        },
        expected,
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
    let _one_at_a_time = SEARCH_INDICES.lock().await;
    let (client, raw, url) = test_clients()?;
    let messages = messages();
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

    let result = seed_and_search(&client, &raw, &messages).await;
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
) -> anyhow::Result<Vec<String>> {
    for message in messages {
        client.upsert_email_message(&upsert_args(message)?).await?;
    }
    refresh(raw, EMAILS).await?;

    let mut failures = Vec::new();
    for case in cases() {
        let args = UnifiedSearchArgs {
            user_id: VIEWER.to_string(),
            page_size: 50,
            match_type: "partial".to_string(),
            cursor: SearchCursorOption::default(),
            search_indices: [models_opensearch::OpenSearchEntityType::Emails].into(),
            email_search_args: case.args,
            ..Default::default()
        };
        let (hits, _) = client.search_unified(args).await?;
        let found: BTreeSet<Uuid> = hits.iter().map(|hit| hit.entity_id).collect();
        let expected: BTreeSet<Uuid> = case.expected.iter().map(|n| thread(*n)).collect();
        if found != expected {
            failures.push(format!(
                "{}: expected {expected:?}, found {found:?}",
                case.name
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
