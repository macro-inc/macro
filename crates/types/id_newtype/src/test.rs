use uuid::Uuid;

crate::uuid_id!(
    /// A test id.
    pub ThingId
);

#[test]
fn an_id_is_its_uuid_string_on_the_wire() {
    let uuid = Uuid::from_u128(0x7ab1);
    let id = ThingId::from_uuid(uuid);

    assert_eq!(
        serde_json::to_value(id).unwrap(),
        serde_json::json!("00000000-0000-0000-0000-000000007ab1")
    );
    assert_eq!(
        serde_json::from_value::<ThingId>(serde_json::json!(
            "00000000-0000-0000-0000-000000007ab1"
        ))
        .unwrap(),
        id
    );
    assert_eq!(id.to_string(), "00000000-0000-0000-0000-000000007ab1");
    assert_eq!(
        "00000000-0000-0000-0000-000000007ab1"
            .parse::<ThingId>()
            .unwrap(),
        id
    );
    assert!("not-a-uuid".parse::<ThingId>().is_err());
}

#[test]
fn conversions_round_trip_the_uuid() {
    let uuid = Uuid::from_u128(0x7ab2);
    let id = ThingId::from(uuid);
    assert_eq!(*id.as_uuid(), uuid);
    assert_eq!(Uuid::from(id), uuid);
    assert_eq!(id.into_uuid(), uuid);
    assert_eq!(ThingId::new(uuid), id);
}

#[test]
fn generated_and_default_ids_are_fresh_uuid_v7s() {
    let generated = ThingId::generate();
    assert_eq!(generated.as_uuid().get_version_num(), 7);
    assert_eq!(ThingId::default().as_uuid().get_version_num(), 7);
    assert_ne!(ThingId::generate(), generated);
}

const CONSTANT: ThingId = ThingId::from_uuid(Uuid::from_u128(1));

#[test]
fn ids_can_be_constants() {
    assert_eq!(CONSTANT.into_uuid(), Uuid::from_u128(1));
}
