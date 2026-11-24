use serde_json::json;

use super::*;

fn args(value: serde_json::Value) -> ImportFromFusion {
    serde_json::from_value(value).unwrap()
}

const HUB: &str = "a.ZXhhbXBsZTp3aXAxZnFhYXV0b2Rlc2sxNjE";
const PROJECT: &str = "b.c2960674-2d1e-4cc8-a5f0-4b9026fd3f5d";
const FOLDER: &str = "urn:adsk.wipprod:fs.folder:co.0J4paz_FQgWPX2QRsaBkiw";
const ITEM: &str = "urn:adsk.wipprod:dm.lineage:hC6k4hndRWaeIVhIjvHu8w";

#[test]
fn browse_walks_down_from_hubs_to_a_folder_page() {
    assert_eq!(
        args(json!({"action": "browse"})).request().unwrap(),
        FusionRequest::Browse(BrowseAt::Hubs)
    );
    assert_eq!(
        args(json!({"action": "browse", "hubId": HUB}))
            .request()
            .unwrap(),
        FusionRequest::Browse(BrowseAt::Projects {
            hub: HubId::parse(HUB).unwrap()
        })
    );
    assert_eq!(
        args(json!({"action": "browse", "hubId": HUB, "projectId": PROJECT}))
            .request()
            .unwrap(),
        FusionRequest::Browse(BrowseAt::TopFolders {
            hub: HubId::parse(HUB).unwrap(),
            project: ApsProjectId::parse(PROJECT).unwrap(),
        })
    );
    assert_eq!(
        args(json!({"action": "browse", "projectId": PROJECT, "folderId": FOLDER, "cursor": "2"}))
            .request()
            .unwrap(),
        FusionRequest::Browse(BrowseAt::Folder {
            project: ApsProjectId::parse(PROJECT).unwrap(),
            folder: ApsFolderId::parse(FOLDER).unwrap(),
            page: 2,
        })
    );
}

#[test]
fn browse_refuses_shapes_that_name_no_place() {
    for value in [
        json!({"action": "browse", "projectId": PROJECT}),
        json!({"action": "browse", "folderId": FOLDER}),
        json!({"action": "browse", "hubId": HUB, "folderId": FOLDER}),
        json!({"action": "browse", "hubId": HUB, "cursor": "1"}),
        json!({"action": "browse", "projectId": PROJECT, "folderId": FOLDER, "cursor": "next"}),
        json!({"action": "browse", "itemIds": [ITEM]}),
        json!({"action": "browse", "hubId": "not an id"}),
    ] {
        assert!(args(value.clone()).request().is_err(), "{value}");
    }
}

#[test]
fn import_takes_a_project_and_one_to_twenty_items() {
    let twenty: Vec<String> = (0..20).map(|n| format!("{ITEM}{n}")).collect();
    let twenty_one: Vec<String> = (0..21).map(|n| format!("{ITEM}{n}")).collect();

    let request = args(json!({"action": "import", "projectId": PROJECT, "itemIds": [ITEM]}))
        .request()
        .unwrap();
    let most = args(json!({"action": "import", "projectId": PROJECT, "itemIds": twenty})).request();

    assert_eq!(
        request,
        FusionRequest::Import {
            project: ApsProjectId::parse(PROJECT).unwrap(),
            items: vec![ItemId::parse(ITEM).unwrap()],
        }
    );
    assert!(most.is_ok());
    for value in [
        json!({"action": "import", "projectId": PROJECT}),
        json!({"action": "import", "projectId": PROJECT, "itemIds": twenty_one}),
        json!({"action": "import", "itemIds": [ITEM]}),
        json!({"action": "import", "projectId": PROJECT, "itemIds": ["two words"]}),
    ] {
        assert!(args(value.clone()).request().is_err(), "{value}");
    }
}

#[test]
fn sync_takes_no_items_for_all_or_up_to_fifty() {
    let fifty_one: Vec<String> = (0..51).map(|n| format!("{ITEM}{n}")).collect();

    assert_eq!(
        args(json!({"action": "sync"})).request().unwrap(),
        FusionRequest::Sync(SyncScope::All { from: None })
    );
    assert_eq!(
        args(json!({"action": "sync", "itemIds": [ITEM]}))
            .request()
            .unwrap(),
        FusionRequest::Sync(SyncScope::Items(vec![ItemId::parse(ITEM).unwrap()]))
    );
    assert_eq!(
        args(json!({"action": "sync", "cursor": ITEM}))
            .request()
            .unwrap(),
        FusionRequest::Sync(SyncScope::All {
            from: Some(ItemId::parse(ITEM).unwrap())
        })
    );
    assert!(
        args(json!({"action": "sync", "itemIds": [ITEM], "cursor": ITEM}))
            .request()
            .is_err()
    );
    assert!(
        args(json!({"action": "sync", "itemIds": fifty_one}))
            .request()
            .is_err()
    );
}
