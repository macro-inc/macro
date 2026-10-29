use super::*;
#[derive(Serialize, Deserialize)]
struct Foo {
    #[serde(with = "super")]
    set: BTreeSet<u64>,
}
#[test]
fn serde_u64_btree_set() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let data = BTreeSet::from([1_u64, u64::MAX, u64::MIN, 0, 42]);
    let obj = Foo { set: data.clone() };
    let json = serde_json::to_string(&obj)?;
    let result: Foo = serde_json::from_str(&json)?;
    assert_eq!(result.set, data);
    Ok(())
}
