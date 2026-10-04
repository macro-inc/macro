use super::*;
use crate::test_support::{deck, text_box};

fn two_slides() -> Presentation {
    let shape = text_box(2, 0, 0, 1_000_000, 500_000, "<a:p/>");
    Presentation::open(deck(&[&shape, &shape])).unwrap()
}

#[test]
fn master_pages_list_each_master_then_its_layouts() {
    let mut pres = two_slides();
    let pages = pres.master_pages().unwrap();
    assert_eq!(
        pages,
        [
            MasterPage {
                id: MASTER_ID_BASE,
                part: "/ppt/slideMasters/slideMaster1.xml".into(),
                master: MASTER_ID_BASE,
                master_part: "/ppt/slideMasters/slideMaster1.xml".into(),
                is_layout: false,
            },
            MasterPage {
                id: MASTER_ID_BASE + 1,
                part: "/ppt/slideLayouts/slideLayout1.xml".into(),
                master: MASTER_ID_BASE,
                master_part: "/ppt/slideMasters/slideMaster1.xml".into(),
                is_layout: true,
            },
        ]
    );
}

#[test]
fn an_index_addresses_a_slide_or_a_master_page() {
    let mut pres = two_slides();
    let slide = pres.page(1).unwrap();
    assert_eq!((slide.id, slide.slide, slide.number), (257, Some(1), 2));
    let layout = pres.page(MASTER_ID_BASE as usize + 1).unwrap();
    assert_eq!(layout.part, "/ppt/slideLayouts/slideLayout1.xml");
    assert_eq!(layout.slide, None);
    assert!(pres.page(2).is_err());
    assert!(pres.page(MASTER_ID_BASE as usize + 7).is_err());
    let ctx = pres.page_context(MASTER_ID_BASE as usize).unwrap();
    assert!(ctx.is_master_page());
    assert!(ctx.master.is_none() && ctx.layout.is_none());
    let ctx = pres.page_context(MASTER_ID_BASE as usize + 1).unwrap();
    assert!(ctx.is_master_page());
    assert!(ctx.master.is_some());
    assert!(!pres.page_context(0).unwrap().is_master_page());
}

#[test]
fn ids_resolve_slides_first_then_masters_and_layouts() {
    let mut pres = two_slides();
    assert_eq!(pres.page_part(256).unwrap(), "/ppt/slides/slide1.xml");
    assert_eq!(
        pres.page_part(MASTER_ID_BASE + 1).unwrap(),
        "/ppt/slideLayouts/slideLayout1.xml"
    );
    assert!(pres.page_part(MASTER_ID_BASE + 2).is_err());
}
