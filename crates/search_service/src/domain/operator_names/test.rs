use std::sync::Mutex;

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use rootcause::Report;
use uuid::Uuid;

use super::{
    InboxAddress, MAX_CHANNELS_NAMED, OperatorNameSource, OperatorNamesService, TypedNames,
};
use crate::domain::email_search::TagOption;

#[derive(Default)]
struct FakeNames {
    tags: Vec<TagOption>,
    inboxes: Vec<InboxAddress>,
    channels: Vec<(String, Uuid)>,
    reads: Mutex<Vec<String>>,
}

impl FakeNames {
    fn read(&self, what: String) {
        self.reads.lock().unwrap().push(what);
    }

    fn reads(&self) -> Vec<String> {
        self.reads.lock().unwrap().clone()
    }
}

impl OperatorNameSource for FakeNames {
    async fn tag_options(&self, _: &MacroUserId<Lowercase<'_>>) -> Result<Vec<TagOption>, Report> {
        self.read("tags".to_string());
        Ok(self.tags.clone())
    }

    async fn inboxes(&self, _: &MacroUserId<Lowercase<'_>>) -> Result<Vec<InboxAddress>, Report> {
        self.read("inboxes".to_string());
        Ok(self.inboxes.clone())
    }

    async fn channels_named(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
        name: &str,
        limit: usize,
    ) -> Result<Vec<Uuid>, Report> {
        self.read(format!("channels {name} {limit}"));
        Ok(self
            .channels
            .iter()
            .filter(|(channel, _)| channel.to_lowercase() == name)
            .map(|(_, id)| *id)
            .take(limit)
            .collect())
    }
}

fn viewer() -> MacroUserId<Lowercase<'static>> {
    MacroUserId::parse_from_str("macro|viewer@example.com")
        .unwrap()
        .lowercase()
}

fn tag(label: &str, id: u128) -> TagOption {
    TagOption {
        label: label.to_string(),
        option_id: Uuid::from_u128(id),
    }
}

#[tokio::test]
async fn names_resolve_ignoring_case() {
    let service = OperatorNamesService(FakeNames {
        tags: vec![tag("Finance", 1), tag("finance", 2), tag("Travel", 3)],
        inboxes: vec![InboxAddress {
            link_id: Uuid::from_u128(10),
            address: "Ana@Example.com".to_string(),
        }],
        channels: vec![("Launch".to_string(), Uuid::from_u128(20))],
        ..FakeNames::default()
    });
    let names = TypedNames {
        tags: vec!["FINANCE".to_string()],
        inboxes: vec!["ana@example.com".to_string()],
        channels: vec!["launch".to_string()],
    };

    let named = service.resolve(&viewer(), &names).await.unwrap();

    assert_eq!(
        named.tag("finance"),
        [Uuid::from_u128(1), Uuid::from_u128(2)]
    );
    assert_eq!(named.inbox("ANA@example.com"), [Uuid::from_u128(10)]);
    assert_eq!(named.channel("Launch"), [Uuid::from_u128(20)]);
}

#[tokio::test]
async fn a_tag_is_named_as_typed_quotes_left_out_and_by_an_emoji_alone() {
    let service = OperatorNamesService(FakeNames {
        tags: vec![tag("Q3 \"Plan\"", 1), tag("🔥", 2)],
        ..FakeNames::default()
    });
    let names = TypedNames {
        tags: vec!["q3 plan".to_string(), "🔥".to_string()],
        ..TypedNames::default()
    };

    let named = service.resolve(&viewer(), &names).await.unwrap();

    assert_eq!(named.tag("q3 plan"), [Uuid::from_u128(1)]);
    assert_eq!(named.tag("🔥"), [Uuid::from_u128(2)]);
}

#[tokio::test]
async fn a_name_that_reaches_nothing_has_no_ids() {
    let service = OperatorNamesService(FakeNames {
        tags: vec![tag("Travel", 3)],
        ..FakeNames::default()
    });
    let names = TypedNames {
        tags: vec!["finance".to_string()],
        inboxes: vec!["bo@example.com".to_string()],
        channels: vec!["ops".to_string()],
    };

    let named = service.resolve(&viewer(), &names).await.unwrap();

    assert!(named.tag("finance").is_empty());
    assert!(named.inbox("bo@example.com").is_empty());
    assert!(named.channel("ops").is_empty());
}

#[tokio::test]
async fn reads_only_what_the_search_typed_and_each_name_once() {
    let service = OperatorNamesService(FakeNames::default());
    let names = TypedNames {
        channels: vec!["Launch".to_string(), "launch".to_string()],
        ..TypedNames::default()
    };

    service.resolve(&viewer(), &names).await.unwrap();

    assert_eq!(
        service.0.reads(),
        [format!("channels launch {MAX_CHANNELS_NAMED}")]
    );
}
