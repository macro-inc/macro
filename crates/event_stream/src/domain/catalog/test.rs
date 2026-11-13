use super::*;
use crate::domain::models::{PrincipalKind, StreamPrincipal};
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashSet;

fn principal(kind: PrincipalKind) -> StreamPrincipal {
    StreamPrincipal {
        kind,
        credential_id: "test".to_owned(),
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|reader@example.com")
        .unwrap()
        .into_owned()
}

#[test]
fn every_name_is_registered_once_under_its_family() {
    let mut seen = HashSet::new();
    for entry in CATALOG {
        assert!(seen.insert(entry.name), "{} registered twice", entry.name);
        assert!(
            entry.name.split_once('.').is_some(),
            "{} has no family",
            entry.name
        );
        assert!(!entry.entity_types.is_empty());
        assert!(!entry.audience.is_empty());
    }
}

#[test]
fn an_account_manager_sees_no_webhook_lifecycle() {
    let visible = visible_to(
        &principal(PrincipalKind::AccountManager { user: user() }),
        true,
    );

    assert!(
        visible
            .iter()
            .all(|entry| !entry.name.starts_with("webhook."))
    );
    assert!(visible.iter().any(|entry| entry.name == "document.updated"));
}

#[test]
fn a_bot_its_user_does_not_own_sees_no_purely_personal_events() {
    let bot = principal(PrincipalKind::Bot {
        bot_id: uuid::Uuid::from_u128(1),
        user: user(),
        owned_by_user: false,
    });

    let visible = visible_to(&bot, true);

    assert!(visible.iter().all(|entry| entry.name != "call.ringing"));
    assert!(
        visible
            .iter()
            .any(|entry| entry.name == "agent_session.deleted"),
        "owner or entity"
    );
}

/// Decodes broker events with the topic enum of one union family.
pub(super) trait TopicVisitor {
    type Output;

    fn visit<T: macro_event_broker::TopicEvent>(self) -> Self::Output;
}

/// What a sample event's `exposure()` declares, in registry terms.
#[derive(Debug)]
struct Declared {
    name: &'static str,
    stage: Stage,
    entity_type: &'static str,
    classes: Vec<AudienceClass>,
    payload_event_type: Option<String>,
}

/// Decodes one sample (`{event_type, metadata}`) and reads its exposure:
/// `None` when it is internal.
struct Expose(serde_json::Value);

impl TopicVisitor for Expose {
    type Output = Result<Option<Declared>, String>;

    fn visit<T: macro_event_broker::TopicEvent>(self) -> Self::Output {
        let event: T = serde_json::from_value(self.0).map_err(|error| error.to_string())?;
        let public = match event.exposure().map_err(|error| error.to_string())? {
            event_exposure::Exposure::Internal(_) => return Ok(None),
            event_exposure::Exposure::Public(public) => public,
        };

        let mut classes = Vec::new();
        audience_classes(&public.audience, &mut classes);
        let payload = serde_json::to_value(public.payload.as_ref()).map_err(|e| e.to_string())?;

        Ok(Some(Declared {
            name: public.name,
            stage: public.stage,
            entity_type: public.entity.entity_type.as_str(),
            classes,
            payload_event_type: payload["event_type"].as_str().map(str::to_owned),
        }))
    }
}

/// Every `event_type` the family's topic enum decodes, read from serde's
/// "unknown variant `…`, expected one of `…`" error.
struct Variants;

impl TopicVisitor for Variants {
    type Output = Vec<String>;

    fn visit<T: macro_event_broker::TopicEvent>(self) -> Self::Output {
        let sample = serde_json::json!({ "event_type": "\u{1}unknown", "metadata": {} });
        let error = match serde_json::from_value::<T>(sample) {
            Ok(_) => panic!("an unknown event_type decoded"),
            Err(error) => error.to_string(),
        };
        let (_, expected) = error
            .split_once("expected")
            .unwrap_or_else(|| panic!("no variant list in `{error}`"));

        // Names sit between backticks: odd-numbered pieces of the split.
        expected
            .split('`')
            .skip(1)
            .step_by(2)
            .map(str::to_owned)
            .collect()
    }
}

/// The registry classes an audience rule can admit through.
fn audience_classes(audience: &event_exposure::Audience, classes: &mut Vec<AudienceClass>) {
    use event_exposure::Audience;

    let class = match audience {
        Audience::Any(audiences) => {
            for audience in audiences {
                audience_classes(audience, classes);
            }
            return;
        }
        Audience::Entity { .. } => AudienceClass::Entity,
        Audience::EntityAtLeast { .. } => AudienceClass::EntityAtLeast,
        Audience::Recipient { .. } => AudienceClass::Recipient,
        Audience::Owner { .. } => AudienceClass::Owner,
        Audience::Team { min_role, .. } => match min_role {
            event_exposure::MinTeamRole::Member => AudienceClass::Team,
            event_exposure::MinTeamRole::Admin => AudienceClass::TeamAdmins,
        },
        Audience::TeamsOf { .. } => AudienceClass::TeamsOf,
        Audience::ContactsOf { .. } => AudienceClass::ContactsOf,
        Audience::GithubInstallation { .. } => AudienceClass::GithubInstallation,
        Audience::Workspace { .. } => AudienceClass::Workspace,
        Audience::Snapshot { .. } => AudienceClass::Snapshot,
    };
    if !classes.contains(&class) {
        classes.push(class);
    }
}

/// Sample broker events per union family, one or more per event type, each
/// in its topic's wire shape: `{event_type, metadata}`, or `{name: metadata}`
/// for an externally tagged topic (calendar).
const SAMPLES: &str = include_str!("exposure_samples.json");

/// Event types of each union family that are internal on every input, so
/// they need no sample. Each must stay unregistered under its family.
const ALWAYS_INTERNAL: &[(&str, &[&str])] = &[
    ("Document", &["document.purged"]),
    (
        "CallRecord",
        &[
            "call.started",
            "call.record_archived",
            "call.record_summarized",
            "call.recording_ready",
        ],
    ),
    ("Chat", &["chat.permanently_deleted"]),
    ("Database", &["database.purged"]),
    ("Form", &["form.purged"]),
    ("Property", &["entity_property.deleted"]),
];

/// A sample's event type: its `event_type` tag, or its only key.
fn sample_event_type(sample: &serde_json::Value) -> &str {
    if let Some(event_type) = sample["event_type"].as_str() {
        return event_type;
    }
    let object = sample.as_object().expect("sample is an object");
    assert_eq!(object.len(), 1, "untagged sample {sample}");
    object.keys().next().expect("one key")
}

/// The registry agrees with every producer's `exposure()`: each public name
/// a sample declares is registered under its family with the same stage,
/// entity type and audience classes, and its payload carries that name;
/// every registered name is declared by some sample with exactly its
/// classes; and every event type of the family's topic has a sample or is
/// listed as always internal.
#[test]
fn the_registry_matches_every_producers_exposure() {
    let samples: std::collections::BTreeMap<String, Vec<serde_json::Value>> =
        serde_json::from_str(SAMPLES).expect("samples parse");
    let families: Vec<&str> = UNION_FAMILIES.iter().map(|(family, _)| *family).collect();
    assert_eq!(
        samples.keys().map(String::as_str).collect::<HashSet<_>>(),
        families.iter().copied().collect::<HashSet<_>>(),
        "every union family has samples, and only those"
    );

    for (family, registered) in UNION_FAMILIES {
        let always_internal: &[&str] = ALWAYS_INTERNAL
            .iter()
            .find(|(name, _)| name == family)
            .map_or(&[], |(_, names)| names);
        let mut sampled = HashSet::new();
        let mut observed: Vec<(&str, Vec<AudienceClass>)> = Vec::new();

        for sample in &samples[*family] {
            let event_type = sample_event_type(sample);
            sampled.insert(event_type.to_owned());
            let declared = visit_union_family(family, Expose(sample.clone()))
                .expect("union family")
                .unwrap_or_else(|error| panic!("{family} sample {event_type}: {error}"));
            let Some(declared) = declared else {
                continue;
            };

            assert!(
                !always_internal.contains(&event_type),
                "{family}: {event_type} is listed always internal but declares {} public",
                declared.name
            );
            assert!(
                registered.contains(&declared.name),
                "{family}: {event_type} declares public `{}`, which the {family} block of \
                 public_event_registry! does not register",
                declared.name
            );
            let entry = entry(declared.name).expect("registered");
            assert_eq!(declared.stage, entry.stage, "{}: stage", declared.name);
            assert!(
                entry.entity_types.contains(&declared.entity_type),
                "{}: entity type {} not registered",
                declared.name,
                declared.entity_type
            );
            for class in &declared.classes {
                assert!(
                    entry.audience.contains(class),
                    "{}: audience class {class:?} not registered",
                    declared.name
                );
            }
            assert_eq!(
                declared.payload_event_type.as_deref(),
                Some(declared.name),
                "{}: payload event_type",
                declared.name
            );

            match observed.iter_mut().find(|(name, _)| *name == declared.name) {
                Some((_, classes)) => {
                    for class in declared.classes {
                        if !classes.contains(&class) {
                            classes.push(class);
                        }
                    }
                }
                None => observed.push((declared.name, declared.classes)),
            }
        }

        for name in *registered {
            let classes = observed
                .iter()
                .find(|(observed, _)| observed == name)
                .map(|(_, classes)| classes)
                .unwrap_or_else(|| panic!("{family}: no sample declares registered {name}"));
            let entry = entry(name).expect("registered");
            assert!(
                entry.audience.iter().all(|class| classes.contains(class)),
                "{name}: registered classes {:?}, samples declare only {classes:?}",
                entry.audience
            );
        }

        let variants = visit_union_family(family, Variants).expect("union family");
        for variant in &variants {
            assert!(
                sampled.contains(variant) || always_internal.contains(&variant.as_str()),
                "{family}: {variant} has no sample and is not listed always internal"
            );
        }
        for name in always_internal {
            assert!(
                variants.iter().any(|variant| variant == name),
                "{family}: always-internal {name} is not an event type of its topic"
            );
            assert!(
                !registered.contains(name),
                "{family}: always-internal {name} is registered"
            );
        }
    }
}

/// A message's entity is its parent: every parent kind is a registered
/// entity type of every message event, so `entity_types` filters match.
#[test]
fn message_events_register_every_parent_entity_type() {
    use messages::domain::models::MessageParent;

    const ID: &str = "0193b3a0-0000-7000-8000-000000000001";
    let parents = [
        "channel",
        "document",
        "initiative",
        "crm_company",
        "crm_contact",
        "call",
    ]
    .map(|kind| MessageParent::parse(kind, ID).unwrap());
    for parent in &parents {
        // Exhaustive: a new parent kind fails here until it is registered.
        match parent {
            MessageParent::Channel(_)
            | MessageParent::Document(_)
            | MessageParent::Initiative(_)
            | MessageParent::CrmCompany(_)
            | MessageParent::CrmContact(_)
            | MessageParent::Call(_) => {}
        }
        let wire = event_exposure::PublicEntityType::from(parent.access_entity_type()).as_str();
        for entry in CATALOG
            .iter()
            .filter(|entry| entry.name.starts_with("message."))
        {
            assert!(
                entry.entity_types.contains(&wire),
                "{} does not register {wire}",
                entry.name
            );
        }
    }
}
