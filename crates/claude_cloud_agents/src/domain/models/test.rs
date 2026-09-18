use super::*;
use serde_json::json;

fn event(models: serde_json::Value) -> Event {
    Event {
        kind: "client_event".into(),
        sequence: Some(1),
        data: json!({"payload":{"type":"control_response","response":{"subtype":"success","response":{"models":models}}}}),
    }
}

#[test]
fn new_provider_ids_labels_descriptions_and_order_need_no_code_change() {
    let catalog = Catalog::from_event(&event(json!([
        {"value":"brand-new-model[1m]","displayName":"New model","description":"Provider description"},
        {"value":"default","displayName":"Default (recommended)"}
    ]))).unwrap();
    let options = catalog.options();
    assert_eq!(options[0].model.id(), "brand-new-model[1m]");
    assert_eq!(options[0].name, "New model");
    assert_eq!(
        options[0].description.as_deref(),
        Some("Provider description")
    );
    assert_eq!(options[1].model.id(), "claude-default");
    assert!(options[1].model.provider_value().is_none());
    assert!(!catalog.contains(&Model::parse("opus").unwrap()));
}

#[test]
fn newest_valid_catalog_replaces_instead_of_merging_and_empty_is_authoritative() {
    let old = event(json!([{"value":"old","displayName":"Old"}]));
    let new = event(json!([{"value":"new","displayName":"New"}]));
    let invalid = event(json!([{"value":"bad/id","displayName":"Bad"}]));
    let catalog = Catalog::from_history(&[old, new, invalid]);
    assert_eq!(catalog.options().len(), 1);
    assert_eq!(catalog.options()[0].model.id(), "new");
    assert!(
        Catalog::from_event(&event(json!([])))
            .unwrap()
            .options()
            .is_empty()
    );
    assert_eq!(Catalog::Unknown.options().len(), 1);
    assert!(Catalog::Unknown.contains(&Model::default()));
}

#[test]
fn rejects_duplicate_aliases_malformed_catalogs_and_unsuccessful_responses() {
    for models in [
        json!({}),
        json!([{"value":"x"}]),
        json!([
            {"value":"default","displayName":"Default"},{"value":"claude-default","displayName":"Duplicate"}
        ]),
    ] {
        assert!(Catalog::from_event(&event(models)).is_none());
    }
    let mut rejected = event(json!([{"value":"x","displayName":"X"}]));
    rejected.data["payload"]["response"]["subtype"] = json!("error");
    assert!(Catalog::from_event(&rejected).is_none());
    for id in ["", "../other", "model\nheader", "model with spaces"] {
        assert!(Model::parse(id).is_err());
    }
}

#[derive(Clone)]
struct AccountCloud {
    histories: Vec<Vec<Event>>,
    models: Vec<Option<Model>>,
    reads: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}
impl Cloud for AccountCloud {
    async fn recent_sessions(&self) -> Result<Vec<RecentSession>> {
        (0..self.histories.len())
            .map(|i| {
                Ok(RecentSession {
                    id: SessionId::parse(&format!("cse_{i}"))?,
                    model: self.models.get(i).cloned().flatten(),
                })
            })
            .collect()
    }
    async fn history(&self, session: &super::super::model::SessionId) -> Result<Vec<Event>> {
        self.reads.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let i: usize = session.as_str().trim_start_matches("cse_").parse().unwrap();
        Ok(self.histories[i].clone())
    }
    async fn send(&self, _: &super::super::model::SessionId, _: serde_json::Value) -> Result<()> {
        panic!("discovery is read-only")
    }
    async fn send_batch(
        &self,
        _: &super::super::model::SessionId,
        _: Vec<serde_json::Value>,
    ) -> Result<()> {
        panic!("discovery is read-only")
    }
    async fn stream(
        &self,
        _: &super::super::model::SessionId,
        _: Option<u64>,
    ) -> Result<super::super::ports::Events> {
        panic!("discovery must not wake a worker")
    }
}

#[tokio::test]
async fn discovery_is_bounded_account_scoped_and_skips_uninitialized_sessions() {
    let first = AccountCloud {
        histories: vec![
            vec![],
            vec![event(json!([{"value":"account-a","displayName":"A"}]))],
        ],
        models: vec![],
        reads: Default::default(),
    };
    let second = AccountCloud {
        histories: vec![vec![event(
            json!([{"value":"account-b","displayName":"B"}]),
        )]],
        models: vec![],
        reads: Default::default(),
    };
    assert_eq!(
        discover(&first).await.unwrap().options()[0].model.id(),
        "account-a"
    );
    assert_eq!(
        discover(&second).await.unwrap().options()[0].model.id(),
        "account-b"
    );
    let empty = AccountCloud {
        histories: vec![vec![]; CATALOG_SESSION_LIMIT + 1],
        models: vec![],
        reads: Default::default(),
    };
    assert_eq!(discover(&empty).await.unwrap(), Catalog::Unknown);
    assert_eq!(
        empty.reads.load(std::sync::atomic::Ordering::SeqCst),
        CATALOG_SESSION_LIMIT
    );
}

#[tokio::test]
async fn discovery_finds_fable_beyond_five_recent_opus_sessions() {
    let opus = event(json!([
        {"value":"default","displayName":"Default"},
        {"value":"opus[1m]","displayName":"Latest Opus name","resolvedModel":"claude-opus-5[1m]"}
    ]));
    let fable = event(json!([
        {"value":"opus[1m]","displayName":"Older Opus name"},
        {"value":"claude-fable-5-1","displayName":"Fable 5.1"}
    ]));
    let mut cloud = AccountCloud {
        histories: vec![vec![opus]; 12],
        models: vec![Some(Model::parse("claude-opus-5").unwrap()); 12],
        reads: Default::default(),
    };
    cloud.models[0] = Some(Model::parse("claude-fable-5-1").unwrap());
    cloud.histories[11] = vec![fable];
    cloud.models[11] = Some(Model::parse("claude-fable-5-1").unwrap());
    let options = discover(&cloud).await.unwrap().options();
    assert_eq!(options.len(), 3);
    assert_eq!(options[1].name, "Latest Opus name");
    assert_eq!(options[2].model.id(), "claude-fable-5-1");
    assert_eq!(options[2].name, "Fable 5.1");
    assert_eq!(cloud.reads.load(std::sync::atomic::Ordering::SeqCst), 2);

    // A configured model is only a sampling hint, not an advertised choice.
    cloud.histories[11] = vec![];
    assert!(
        !discover(&cloud)
            .await
            .unwrap()
            .contains(&Model::parse("claude-fable-5-1").unwrap())
    );
}

#[tokio::test]
async fn discovery_excludes_the_current_session_and_bounds_metadata() {
    let cloud = AccountCloud {
        histories: (0..=RECENT_SESSION_LIMIT)
            .map(|i| {
                vec![event(json!([
                    {"value":format!("model-{i}"),"displayName":format!("Model {i}")}
                ]))]
            })
            .collect(),
        // A distinct model beyond the metadata bound must not be sampled.
        models: (0..=RECENT_SESSION_LIMIT)
            .map(|i| {
                Some(
                    Model::parse(if i == RECENT_SESSION_LIMIT {
                        "out-of-bounds"
                    } else {
                        "opus"
                    })
                    .unwrap(),
                )
            })
            .collect(),
        reads: Default::default(),
    };
    let catalog = discover_excluding(&cloud, Some(&SessionId::parse("cse_0").unwrap()))
        .await
        .unwrap();
    assert!(!catalog.contains(&Model::parse("model-0").unwrap()));
    assert!(!catalog.contains(&Model::parse(&format!("model-{RECENT_SESSION_LIMIT}")).unwrap()));
    assert_eq!(catalog.options().len(), CATALOG_SESSION_LIMIT);
}
