use macro_user_id::cowlike::CowLike;

use super::super::values::Person;
use super::*;

fn id(hex: char) -> NotionId {
    NotionId::parse(&hex.to_string().repeat(32)).unwrap()
}

fn item(import: u128, parent: Option<u128>, title: &str) -> WriteItem {
    WriteItem {
        import_id: Uuid::from_u128(import),
        parent: parent.map(Uuid::from_u128),
        notion_id: id('a'),
        kind: ImportKind::Page,
        title: title.to_string(),
        decision: NotionDecision::Copy,
        task_fields: NotionTaskFields::default(),
        shared: false,
        shareable: true,
        already_imported: false,
    }
}

#[test]
fn every_page_above_a_written_object_becomes_a_folder_parents_first() {
    // Engineering > Q3 plan > Launch checklist, and a lone page.
    let items = vec![
        item(3, Some(2), "Launch checklist"),
        item(1, None, "Engineering"),
        item(2, Some(1), "Q3 plan"),
        item(4, None, "Scratchpad"),
    ];

    let layout = folder_layout(&items);

    assert_eq!(layout.folders, [Uuid::from_u128(1), Uuid::from_u128(2)]);

    let root = Uuid::from_u128(100);
    let folders: HashMap<Uuid, Uuid> = [
        (Uuid::from_u128(1), Uuid::from_u128(101)),
        (Uuid::from_u128(2), Uuid::from_u128(102)),
    ]
    .into_iter()
    .collect();
    let parents: HashMap<Uuid, Option<Uuid>> = items
        .iter()
        .map(|item| (item.import_id, item.parent))
        .collect();
    // A page with children goes in its own folder.
    assert_eq!(
        folder_for(&items[1], true, &folders, &parents, root),
        Uuid::from_u128(101)
    );
    // The folder itself sits in its parent's folder.
    assert_eq!(
        folder_for(&items[2], false, &folders, &parents, root),
        Uuid::from_u128(101)
    );
    assert_eq!(
        folder_for(&items[0], true, &folders, &parents, root),
        Uuid::from_u128(102)
    );
    assert_eq!(folder_for(&items[3], true, &folders, &parents, root), root);
}

#[test]
fn every_planned_page_gets_a_document_id_before_anything_is_written() {
    let mut fresh = item(1, None, "Roadmap");
    fresh.notion_id = id('1');
    let mut teammates = item(2, None, "Spec");
    teammates.notion_id = id('2');
    let mut source = item(3, None, "Bugs");
    source.kind = ImportKind::DataSource;
    source.notion_id = id('3');
    let imported: HashMap<NotionId, Uuid> = [(id('2'), Uuid::from_u128(77))].into();
    let people: PeopleMap = [
        (
            id('4'),
            Person {
                email: Some("teo@acme.test".to_string()),
                macro_user: Some(
                    MacroUserIdStr::parse_from_str("macro|teo@acme.test")
                        .unwrap()
                        .into_owned(),
                ),
            },
        ),
        (
            id('5'),
            Person {
                email: Some("outsider@else.test".to_string()),
                macro_user: None,
            },
        ),
    ]
    .into();

    let links = notion_links(&[fresh, teammates, source], &imported, &people);

    assert_eq!(
        links.pages.len(),
        2,
        "data sources become databases, not documents"
    );
    assert_eq!(links.pages[&id('1')].name, "Roadmap");
    assert_eq!(
        links.pages[&id('1')].document_id,
        document_id(Uuid::from_u128(1)),
        "a resumed write names the same document"
    );
    assert_eq!(
        links.pages[&id('2')],
        NotionPageLink {
            document_id: Uuid::from_u128(77),
            name: "Spec".to_string(),
        }
    );
    assert_eq!(
        links.users.keys().collect::<Vec<_>>(),
        [&id('4')],
        "only people matched to a teammate become mentions"
    );
}
