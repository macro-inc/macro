#[cfg(feature = "ports")]
use super::resolve::*;
use super::*;
use crate::domain::slack::{mrkdwn::MrkdwnConverter, users::UserDirectory};
#[cfg(feature = "ports")]
use crate::domain::{
    models::*,
    ports::{PortResult, ReferenceLookup},
};
use std::collections::BTreeMap;
#[cfg(feature = "ports")]
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
};

#[cfg(feature = "ports")]
#[derive(Default)]
struct Lookup {
    channels: HashMap<ConversationId, ChannelMapping>,
    messages: HashMap<SlackTimestamp, MessageMapping>,
    pending: Vec<ConversationId>,
    access: DisclosureAccess,
    calls: Mutex<Vec<usize>>,
}

#[cfg(feature = "ports")]
impl ReferenceLookup for Lookup {
    async fn channels(
        &self,
        _: &ReferenceContext,
        ids: &[ConversationId],
    ) -> PortResult<Vec<ChannelMapping>> {
        self.calls.lock().unwrap().push(ids.len());
        assert_eq!(ids.iter().collect::<HashSet<_>>().len(), ids.len());
        Ok(ids
            .iter()
            .map(|id| {
                self.channels
                    .get(id)
                    .cloned()
                    .unwrap_or(ChannelMapping::Missing)
            })
            .collect())
    }
    async fn pending_channels(
        &self,
        _: &ReferenceContext,
        _: &[ConversationId],
    ) -> PortResult<Vec<ConversationId>> {
        Ok(self.pending.clone())
    }
    async fn messages(
        &self,
        context: &ReferenceContext,
        sources: &[SourceMessageId],
    ) -> PortResult<Vec<MessageMapping>> {
        self.calls.lock().unwrap().push(sources.len());
        assert_eq!(sources.iter().collect::<HashSet<_>>().len(), sources.len());
        assert!(sources.iter().all(|s| s.team_id == context.team));
        Ok(sources
            .iter()
            .map(|s| {
                self.messages
                    .get(&s.ts)
                    .cloned()
                    .unwrap_or(MessageMapping::Missing)
            })
            .collect())
    }
    async fn disclosure_access(
        &self,
        _: &ReferenceContext,
        _: &[Uuid],
    ) -> PortResult<DisclosureAccess> {
        Ok(self.access.clone())
    }
}

#[cfg(feature = "ports")]
fn context() -> ReferenceContext {
    ReferenceContext {
        team: Uuid::now_v7().try_into().unwrap(),
        job: Uuid::now_v7().try_into().unwrap(),
        requester: MacroUserIdStr::parse_from_str("macro|admin@example.com").unwrap(),
        source: SourceIdentity::Known {
            source_id: "T1".parse().unwrap(),
        },
        binding: SourceBinding::Known {
            source_id: "T1".parse().unwrap(),
        },
        domains: vec![WorkspaceDomain {
            source: "T1".parse().unwrap(),
            hostname: "example.slack.com".into(),
        }],
    }
}

#[cfg(feature = "ports")]
#[tokio::test]
async fn source_proof_precedes_all_identity_lookups() {
    let lookup = Lookup::default();
    let records = vec![conversion(
        "https://example.slack.com/archives/C1/p1700000000000001",
        false,
    )];
    let mut context = context();
    context.domains.clear();
    assert_eq!(
        resolve_batch(&lookup, &context, &records, &ImportLimits::default())
            .await
            .unwrap(),
        vec![vec![ReferenceOutcome::Fallback]]
    );
    assert!(lookup.calls.lock().unwrap().is_empty());
    context.domains.push(WorkspaceDomain {
        source: "T2".parse().unwrap(),
        hostname: "example.slack.com".into(),
    });
    resolve_batch(&lookup, &context, &records, &ImportLimits::default())
        .await
        .unwrap();
    context.domains[0].source = "T1".parse().unwrap();
    context.domains[0].hostname = "alias.slack.com".into();
    resolve_batch(&lookup, &context, &records, &ImportLimits::default())
        .await
        .unwrap();
    context.binding = SourceBinding::ConfirmedUnknown;
    context.source = SourceIdentity::ConfirmedUnknown;
    resolve_batch(&lookup, &context, &records, &ImportLimits::default())
        .await
        .unwrap();
    assert!(lookup.calls.lock().unwrap().is_empty());
    context.binding = SourceBinding::Known {
        source_id: "T2".parse().unwrap(),
    };
    context.source = SourceIdentity::Known {
        source_id: "T1".parse().unwrap(),
    };
    resolve_batch(
        &lookup,
        &context,
        &[conversion("<#C1>", false)],
        &ImportLimits::default(),
    )
    .await
    .unwrap();
    assert!(lookup.calls.lock().unwrap().is_empty());
    assert!(records[0].body.contains("<m-link>"));
}

#[cfg(feature = "ports")]
#[tokio::test]
async fn canonical_ids_exact_micros_and_disclosure_access_control_outcomes() {
    let channel = Uuid::now_v7();
    let other = Uuid::now_v7();
    let root = Uuid::now_v7();
    let reply = Uuid::now_v7();
    let records = vec![conversion(
        "<#C1|same> <#C2|same> <#C3> <#C4> <#C5> https://example.slack.com/archives/C1/p1000001 https://example.slack.com/archives/C1/p1000002 https://example.slack.com/archives/C1/p1000003 https://example.slack.com/archives/C1/p1000004 https://example.slack.com/archives/C1/p1000005",
        false,
    )];
    let mut lookup = Lookup {
        channels: HashMap::from([
            (
                "C1".parse().unwrap(),
                ChannelMapping::Ready {
                    id: channel,
                    name: "authorized".into(),
                    team_visible: false,
                },
            ),
            (
                "C2".parse().unwrap(),
                ChannelMapping::Ready {
                    id: other,
                    name: "authorized".into(),
                    team_visible: true,
                },
            ),
            ("C3".parse().unwrap(), ChannelMapping::Pending),
        ]),
        messages: HashMap::from([
            (
                "1.000001".parse().unwrap(),
                MessageMapping::Ready {
                    channel,
                    message: root,
                    root,
                },
            ),
            (
                "1.000002".parse().unwrap(),
                MessageMapping::Ready {
                    channel,
                    message: reply,
                    root,
                },
            ),
            (
                "1.000003".parse().unwrap(),
                MessageMapping::Ready {
                    channel: other,
                    message: reply,
                    root,
                },
            ),
            ("1.000004".parse().unwrap(), MessageMapping::Invalid),
        ]),
        pending: vec!["C1".parse().unwrap(), "C4".parse().unwrap()],
        access: DisclosureAccess {
            team_member: true,
            participant_channels: HashSet::from([channel]),
        },
        ..Default::default()
    };
    let result = resolve_batch(&lookup, &context(), &records, &ImportLimits::default())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(
        result[0],
        ReferenceOutcome::Resolved(ResolvedTarget::Channel {
            channel_id: channel,
            name: "authorized".into()
        })
    );
    assert_eq!(
        result[1],
        ReferenceOutcome::Resolved(ResolvedTarget::Channel {
            channel_id: other,
            name: "authorized".into()
        })
    );
    assert_eq!(
        &result[2..5],
        &[
            ReferenceOutcome::Pending,
            ReferenceOutcome::Pending,
            ReferenceOutcome::Fallback
        ]
    );
    assert_eq!(
        result[5],
        ReferenceOutcome::Resolved(ResolvedTarget::Message {
            channel_id: channel,
            name: "authorized".into(),
            message_id: root,
            thread_id: Some(root)
        })
    );
    assert_eq!(
        result[6],
        ReferenceOutcome::Resolved(ResolvedTarget::Message {
            channel_id: channel,
            name: "authorized".into(),
            message_id: reply,
            thread_id: Some(root)
        })
    );
    assert_eq!(
        &result[7..],
        &[
            ReferenceOutcome::Fallback,
            ReferenceOutcome::Fallback,
            ReferenceOutcome::Pending
        ]
    );
    lookup.access.participant_channels.clear();
    let revoked = resolve_batch(&lookup, &context(), &records, &ImportLimits::default())
        .await
        .unwrap()
        .remove(0);
    assert_eq!(revoked[0], ReferenceOutcome::Fallback);
    assert!(
        revoked[5..]
            .iter()
            .all(|r| *r == ReferenceOutcome::Fallback)
    );
}

#[cfg(feature = "ports")]
#[tokio::test]
async fn reference_reads_are_deduplicated_chunked_and_byte_bounded() {
    let lookup = Lookup::default();
    let record = conversion(&"<#C1> ".repeat(MAX_REFERENCES), false);
    let records = vec![record; 3];
    resolve_batch(&lookup, &context(), &records, &ImportLimits::default())
        .await
        .unwrap();
    assert_eq!(*lookup.calls.lock().unwrap(), vec![1]);
    lookup.calls.lock().unwrap().clear();
    let records = (0..3)
        .map(|r| {
            conversion(
                &(0..MAX_REFERENCES)
                    .map(|i| format!("<#C{}> ", r * MAX_REFERENCES + i))
                    .collect::<String>(),
                false,
            )
        })
        .collect::<Vec<_>>();
    resolve_batch(&lookup, &context(), &records, &ImportLimits::default())
        .await
        .unwrap();
    assert_eq!(*lookup.calls.lock().unwrap(), vec![500, 268]);
    let limits = ImportLimits {
        database_batch_bytes: 1,
        ..Default::default()
    };
    assert!(
        resolve_batch(&lookup, &context(), &records, &limits)
            .await
            .is_err()
    );
}

fn conversion(text: &str, italic: bool) -> ConvertedText {
    MrkdwnConverter {
        users: &UserDirectory::new(vec![]).unwrap(),
        channels: &BTreeMap::new(),
    }
    .convert_with_references(text, italic)
    .unwrap()
}

#[test]
fn permalinks_keep_exact_message_and_thread_identities() {
    for timestamp in ["1700000000.000001", "1700000000.000002"] {
        let input = format!(
            "https://example.slack.com/archives/C1/p{}?thread_ts=1699999999.999999&cid=C1",
            timestamp.replace('.', "")
        );
        let Some(SourceReference::Message {
            hostname,
            channel,
            timestamp: parsed,
            thread_timestamp,
        }) = parse_permalink(&input)
        else {
            panic!("expected permalink");
        };
        assert_eq!(hostname, "example.slack.com");
        assert_eq!(channel.as_str(), "C1");
        assert_eq!(parsed.to_string(), timestamp);
        assert_eq!(thread_timestamp.unwrap().to_string(), "1699999999.999999");
    }
}

#[test]
fn unsupported_permalinks_are_not_resolution_evidence() {
    for input in [
        "http://example.slack.com/archives/C1/p1700000000000001",
        "https://slack.com/archives/C1/p1700000000000001",
        "https://a.b.slack.com/archives/C1/p1700000000000001",
        "https://example.slack.com.evil.com/archives/C1/p1700000000000001",
        "https://evil@example.slack.com/archives/C1/p1700000000000001",
        "https://@example.slack.com/archives/C1/p1700000000000001",
        "https://example.slack.com/archives/C1/p1700000000000001?thread_ts=1700000000.000002",
        "https://example.slack.com/archives/C1/p1700000000000001?cid=C1&cid=C2",
        "https://example.slack.com:8443/archives/C1/p1700000000000001",
        "https://example.slack.com/archives/C1/p1700000000000001/extra",
        "https://example.slack.com/archives/C1/p1700000000000001#fragment",
        "https://example.slack.com/archives/C1/p1700000000000001?cid=C2",
        "https://example.slack.com/archives/C1/p1700000000000001?thread_ts=1.1",
        "https://example.slack.com/archives/C1/p1700000000000001?thread_ts=1.000001&thread_ts=1.000002",
        "https://example.slack.com/archives/C1/p1700000000000001?unknown=1",
        "https://example.slack.com/archives/C1/p170000000000000x",
        "https://example.slack.com/archives/C1/p999999999999999999",
        "https://app.slack.com/client/T1/C1",
        "https://example.slack.com/other/../archives/C1/p1700000000000001",
        "https://example.slack.com/archives/C1/./p1700000000000001",
        "https://example.slack.com/archives/C1/p1700000000000001\n",
    ] {
        assert!(parse_permalink(input).is_none(), "{input}");
    }
}

#[test]
fn templates_render_by_occurrence_without_searching_serialized_bodies() {
    for italic in [false, true] {
        let result = conversion(
            "  *<#C1|源>* <https://example.slack.com/archives/C1/p1700000000000001|reply>\n> <#C1|other>  ",
            italic,
        );
        assert_eq!(result.references.len(), 3);
        assert_eq!(result.render(&[]).unwrap(), result.body);
        for intent in &result.references {
            assert_eq!(result.body[intent.range.clone()], intent.fallback);
        }
        let channel_id = Uuid::from_u128(1);
        let message_id = Uuid::from_u128(2);
        let thread_id = Uuid::from_u128(3);
        let channel = ResolvedTarget::Channel {
            channel_id,
            name: "general".into(),
        };
        let message = ResolvedTarget::Message {
            channel_id,
            name: "general".into(),
            message_id,
            thread_id: Some(thread_id),
        };
        let rendered = result
            .render(&[Some(channel.clone()), Some(message), None])
            .unwrap();
        assert!(rendered.contains(&format!("\"documentId\":\"{channel_id}\"")));
        assert!(rendered.contains(&format!("\"channel_message_id\":\"{message_id}\"")));
        assert!(rendered.contains(&format!("\"channel_thread_id\":\"{thread_id}\"")));
        assert!(rendered.contains("#other"));
        // Never silently downgrade message intent into a channel mention.
        assert_eq!(result.render(&[None, Some(channel)]).unwrap(), result.body);
        let decoded: ConvertedText =
            serde_json::from_str(&serde_json::to_string(&result).unwrap()).unwrap();
        assert_eq!(decoded, result);
    }
}

#[test]
fn invalid_templates_and_excessive_intents_are_rejected() {
    let mut result = conversion("<#C1>", false);
    result.references[0].range.start = 100;
    assert_eq!(result.render(&[]), Err(ReferenceError::InvalidTemplate));
    let users = UserDirectory::new(vec![]).unwrap();
    let channels = BTreeMap::new();
    let converter = MrkdwnConverter {
        users: &users,
        channels: &channels,
    };
    assert!(
        converter
            .convert_with_references(&"<#C1> ".repeat(MAX_REFERENCES), false)
            .is_ok()
    );
    assert_eq!(
        converter.convert_with_references(&"<#C1> ".repeat(MAX_REFERENCES + 1), false),
        Err(ReferenceError::LimitExceeded)
    );
    assert_eq!(
        converter.convert_with_references(&"x".repeat(MAX_SOURCE_BYTES + 1), false),
        Err(ReferenceError::LimitExceeded)
    );
}

#[test]
fn repeated_archive_metadata_has_an_independent_expansion_budget() {
    let channels = BTreeMap::from([("C1".parse().unwrap(), "x".repeat(64 * 1024))]);
    let users = UserDirectory::new(vec![]).unwrap();
    let converter = MrkdwnConverter {
        users: &users,
        channels: &channels,
    };
    assert_eq!(
        converter.convert_with_references(&"<#C1> ".repeat(MAX_REFERENCES), false),
        Err(ReferenceError::LimitExceeded)
    );
}

#[test]
fn fallbacks_use_only_source_metadata_and_code_has_no_intents() {
    let result = conversion(
        "<#C1> <#C2|source name> ` <#C3> `\n```\nhttps://example.slack.com/archives/C4/p1700000000000001\n```",
        false,
    );
    assert_eq!(result.references.len(), 2);
    assert_eq!(result.references[0].fallback, "#C1");
    assert_eq!(result.references[1].fallback, "#source name");
}
