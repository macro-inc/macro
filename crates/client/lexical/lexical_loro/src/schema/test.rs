use std::{cell::Cell, marker::PhantomData, rc::Rc};

thread_local! {
    static JSON_MAPS: Cell<Option<usize>> = const { Cell::new(None) };
}

pub(crate) struct JsonMaps {
    previous: Option<usize>,
    _thread: PhantomData<Rc<()>>,
}
impl JsonMaps {
    pub(crate) fn begin() -> Self {
        Self {
            previous: JSON_MAPS.replace(Some(0)),
            _thread: PhantomData,
        }
    }
    pub(crate) fn count(&self) -> usize {
        JSON_MAPS.get().expect("active counter")
    }
}
impl Drop for JsonMaps {
    fn drop(&mut self) {
        JSON_MAPS.set(self.previous);
    }
}
pub(crate) fn record_json_map() {
    JSON_MAPS.set(JSON_MAPS.get().map(|count| count + 1));
}

#[test]
fn json_map_counter_restores_outer_scope() {
    let outer = JsonMaps::begin();
    record_json_map();
    {
        let inner = JsonMaps::begin();
        record_json_map();
        record_json_map();
        assert_eq!(inner.count(), 2);
    }
    assert_eq!(outer.count(), 1);
}

#[test]
fn validated_id_matches_complete_legacy_conversion() -> super::Result<()> {
    use super::*;
    for value in [
        LoroValue::Null,
        LoroValue::Bool(true),
        LoroValue::I64(7),
        LoroValue::Double(f64::NAN),
        LoroValue::Double(f64::INFINITY),
        LoroValue::String("not a map".into()),
        to_loro(&serde_json::json!([{"id":"nested"}])),
        to_loro(&serde_json::json!({"id":"", "nested":[false,null,1.5]})),
        to_loro(&serde_json::json!({"id":"段落😀"})),
        to_loro(&serde_json::json!({"id":["not a string"]})),
        to_loro(&serde_json::json!({"other":{"id":"not top level"}})),
    ] {
        let expected = from_loro(&value)?;
        let expected = expected
            .as_object()
            .and_then(|map| map.get("id"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        assert_eq!(
            validated_state_id(&ValueOrContainer::Value(value))?,
            expected
        );
    }
    for invalid in [
        LoroValue::Binary(vec![1, 2].into()),
        LoroValue::Container(loro::ContainerID::new_root(
            "invalid",
            loro::ContainerType::Map,
        )),
    ] {
        let nested = LoroValue::Map(
            vec![
                ("id".into(), LoroValue::String("valid id first".into())),
                ("nested".into(), LoroValue::List(vec![invalid].into())),
            ]
            .into(),
        );
        assert!(
            matches!(from_loro(&nested), Err(ProjectionError::Schema { path }) if path == "non-JSON value")
        );
        assert!(
            matches!(validated_state_id(&ValueOrContainer::Value(nested)), Err(ProjectionError::Schema { path }) if path == "non-JSON value")
        );
    }
    Ok(())
}
