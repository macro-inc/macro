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
    models: Vec<ModelOption>,
    fails: bool,
}
impl Cloud for AccountCloud {
    async fn models(&self) -> Result<Vec<ModelOption>> {
        if self.fails {
            return Err(Error::Http(403));
        }
        Ok(self.models.clone())
    }
    async fn history(&self, _: &super::super::model::SessionId) -> Result<Vec<Event>> {
        panic!("model discovery must not read any transcript")
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
async fn discovery_returns_account_models_without_any_sessions() {
    let first = AccountCloud {
        models: vec![ModelOption {
            model: Model::parse("claude-fable-5-1").unwrap(),
            name: "Claude Fable 5.1".into(),
            description: None,
        }],
        fails: false,
    };
    let second = AccountCloud {
        models: vec![ModelOption {
            model: Model::parse("another-account-model").unwrap(),
            name: "Another account model".into(),
            description: None,
        }],
        fails: false,
    };
    let fable = Model::parse("claude-fable-5-1").unwrap();
    let catalog = discover(&first).await.unwrap();
    assert!(catalog.contains(&Model::default()));
    assert!(catalog.contains(&fable));
    assert_eq!(catalog.options()[1].name, "Claude Fable 5.1");
    assert!(!discover(&second).await.unwrap().contains(&fable));
}

#[tokio::test]
async fn discovery_surfaces_errors_and_does_not_fall_back_to_history() {
    let mut cloud = AccountCloud {
        models: vec![],
        fails: true,
    };
    assert!(matches!(discover(&cloud).await, Err(Error::Http(403))));
    cloud.fails = false;
    let catalog = discover(&cloud).await.unwrap();
    assert_eq!(catalog.options().len(), 1);
    assert!(catalog.contains(&Model::default()));
}
