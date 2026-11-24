use super::*;

#[test]
fn a_storage_urn_names_its_bucket_and_object() {
    let storage = StorageObject::parse(
        "urn:adsk.objects:os.object:wip.dm.prod/9f8bdc3f-e29c-4ada-ab7b-bb8dfa821163.pdf",
    )
    .unwrap();

    assert_eq!(storage.bucket_key, "wip.dm.prod");
    assert_eq!(
        storage.object_key,
        "9f8bdc3f-e29c-4ada-ab7b-bb8dfa821163.pdf"
    );
}

#[test]
fn an_object_key_keeps_its_own_slashes() {
    let storage =
        StorageObject::parse("urn:adsk.objects:os.object:wip.dm.prod/folder/part.step").unwrap();

    assert_eq!(storage.bucket_key, "wip.dm.prod");
    assert_eq!(storage.object_key, "folder/part.step");
}

#[test]
fn anything_else_is_not_storage() {
    for urn in [
        "",
        "urn:adsk.objects:os.object:",
        "urn:adsk.objects:os.object:wip.dm.prod",
        "urn:adsk.objects:os.object:wip.dm.prod/",
        "urn:adsk.objects:os.object:/key.f3d",
        "urn:adsk.wipprod:fs.file:vf.b909RzMKR4mhc3O7UBY_8g?version=2",
    ] {
        assert_eq!(StorageObject::parse(urn), None, "{urn}");
    }
}

#[test]
fn aps_ids_are_printable_and_bounded() {
    assert!(ItemId::parse("urn:adsk.wipprod:dm.lineage:hC6k4hndRWaeIVhIjvHu8w").is_ok());
    assert!(ItemId::parse("").is_err());
    assert!(ItemId::parse("urn:adsk wipprod").is_err());
    assert!(ItemId::parse("urn:adsk.wipprod\n").is_err());
    assert!(ItemId::parse(&"a".repeat(513)).is_err());
}
