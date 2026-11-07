use super::*;
use crate::domain::slack::{mrkdwn::MrkdwnConverter, references::resolve::*, users::UserDirectory};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::{BTreeMap, HashMap};
use uuid::Uuid;

struct Lookup {
    channel: Uuid,
    messages: HashMap<SlackTimestamp, Uuid>,
    allowed: bool,
    pending: bool,
}
impl ReferenceLookup for Lookup {
    async fn channels(
        &self,
        _: &ReferenceContext,
        channels: &[ConversationId],
    ) -> PortResult<Vec<ChannelMapping>> {
        Ok(channels
            .iter()
            .map(|_| ChannelMapping::Ready {
                id: self.channel,
                name: "canonical".into(),
                team_visible: true,
            })
            .collect())
    }
    async fn pending_channels(
        &self,
        _: &ReferenceContext,
        channels: &[ConversationId],
    ) -> PortResult<Vec<ConversationId>> {
        Ok(if self.pending {
            channels.to_vec()
        } else {
            vec![]
        })
    }
    async fn messages(
        &self,
        _: &ReferenceContext,
        sources: &[SourceMessageId],
    ) -> PortResult<Vec<MessageMapping>> {
        Ok(sources
            .iter()
            .map(|source| match self.messages.get(&source.ts) {
                Some(id) => MessageMapping::Ready {
                    channel: self.channel,
                    message: *id,
                    root: *id,
                },
                None => MessageMapping::Missing,
            })
            .collect())
    }
    async fn disclosure_access(
        &self,
        _: &ReferenceContext,
        _: &[Uuid],
    ) -> PortResult<DisclosureAccess> {
        Ok(DisclosureAccess {
            team_member: self.allowed,
            ..Default::default()
        })
    }
}
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
fn template(source: &str) -> ConvertedText {
    MrkdwnConverter {
        users: &UserDirectory::default(),
        channels: &BTreeMap::new(),
    }
    .convert_with_references(source, false)
    .unwrap()
}

#[tokio::test]
async fn self_cycles_prior_imports_and_reverse_order_use_only_final_canonical_ids() {
    let ids = [Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7()];
    let context = context();
    let mut lookup = Lookup {
        channel: Uuid::now_v7(),
        messages: HashMap::new(),
        allowed: true,
        pending: false,
    };
    let records: Vec<_> = (1..=3).map(|index| template(&format!(
        "https://example.slack.com/archives/C{index}/p{index}000001 https://example.slack.com/archives/C{}/p{}000001",
        index % 3 + 1, index % 3 + 1,
    ))).collect();
    let mut expected = Vec::new();
    for order in [[0, 1, 2], [2, 1, 0], [1, 2, 0]] {
        lookup.messages.clear();
        // Models independently committed parts/conversations, including prior-job maps.
        for index in order {
            lookup
                .messages
                .insert(format!("{}.000001", index + 1).parse().unwrap(), ids[index]);
        }
        let mut bodies = Vec::new();
        for (index, record) in records.iter().enumerate() {
            assert!(!record.body.contains("m-document-mention"));
            let body = final_body(
                &lookup,
                &context,
                record,
                IMPORTER_BODY_VERSION,
                &ImportLimits::default(),
            )
            .await
            .unwrap()
            .unwrap();
            assert!(body.contains(&ids[index].to_string()));
            assert!(body.contains(&ids[(index + 1) % 3].to_string()));
            assert!(body.contains(&lookup.channel.to_string()));
            bodies.push(body);
        }
        if expected.is_empty() {
            expected = bodies;
        } else {
            assert_eq!(bodies, expected);
        }
    }
}

#[tokio::test]
async fn missing_skipped_shape_only_pending_revoked_and_unproven_targets_close_to_fallback() {
    let mut lookup = Lookup {
        channel: Uuid::now_v7(),
        messages: HashMap::new(),
        allowed: true,
        pending: true,
    };
    let record = template("https://example.slack.com/archives/C1/p1000001");
    let mut context = context();
    let limits = ImportLimits::default();
    assert!(
        final_body(&lookup, &context, &record, 1, &limits)
            .await
            .unwrap()
            .is_none()
    );
    lookup.pending = false;
    assert!(
        final_body(&lookup, &context, &record, 1, &limits)
            .await
            .unwrap()
            .is_none()
    );
    lookup
        .messages
        .insert("1.000001".parse().unwrap(), Uuid::now_v7());
    lookup.allowed = false;
    assert!(
        final_body(&lookup, &context, &record, 1, &limits)
            .await
            .unwrap()
            .is_none()
    );
    lookup.allowed = true;
    assert!(
        final_body(&lookup, &context, &record, 2, &limits)
            .await
            .unwrap()
            .is_none()
    );
    context.domains.clear();
    assert!(
        final_body(&lookup, &context, &record, 1, &limits)
            .await
            .unwrap()
            .is_none()
    );
    let mut invalid = record;
    invalid.references[0].range.start = usize::MAX;
    assert!(
        final_body(&lookup, &context, &invalid, 1, &limits)
            .await
            .unwrap()
            .is_none()
    );
}
