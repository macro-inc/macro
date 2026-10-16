//! The page tree: order, inheritance, and damage.

use super::*;

fn numbers(pages: &[PageRef]) -> Vec<u32> {
    pages.iter().map(|p| p.obj.num).collect()
}

/// A file of `objects` (numbered from 1, the first the catalog).
fn file(objects: &[&str]) -> Pdf {
    let mut b = Builder::new("1.4");
    for (i, o) in objects.iter().enumerate() {
        b.obj(i as u32 + 1, o);
    }
    let nums: Vec<u32> = (0..=objects.len() as u32).collect();
    b.table(&nums, &format!("/Size {} /Root 1 0 R", objects.len() + 1));
    b.open()
}

#[test]
fn order_and_inheritance() {
    let pdf = file(&[
        "<</Type /Catalog /Pages 2 0 R>>",
        "<</Type /Pages /Kids [3 0 R 6 0 R] /Count 3 /MediaBox [0 0 612 792] \
         /Resources <</ProcSet [/PDF]>> /Rotate 90>>",
        "<</Type /Pages /Parent 2 0 R /Kids [4 0 R 5 0 R] /Count 2 /CropBox [10 10 600 780] /Rotate 0>>",
        "<</Type /Page /Parent 3 0 R /MediaBox [0 0 100 100]>>",
        "<</Type /Page /Parent 3 0 R /Resources 7 0 R>>",
        "<</Type /Page /Parent 2 0 R>>",
        "<</Font <<>>>>",
    ]);
    let pages = pdf.pages();
    assert_eq!(numbers(&pages), [4, 5, 6]);
    let boxes = |p: &PageRef, k: &str| p.dict.get(k).and_then(Object::as_numbers);
    assert_eq!(
        boxes(&pages[0], "MediaBox"),
        Some(vec![0.0, 0.0, 100.0, 100.0])
    );
    assert_eq!(
        boxes(&pages[0], "CropBox"),
        Some(vec![10.0, 10.0, 600.0, 780.0])
    );
    assert_eq!(pages[0].dict.i64("Rotate"), Some(0));
    assert!(
        pages[0]
            .dict
            .get("Resources")
            .and_then(Object::as_dict)
            .is_some()
    );
    assert_eq!(
        pages[1].dict.get("Resources"),
        Some(&Object::Ref(ObjRef::new(7, 0)))
    );
    assert_eq!(
        boxes(&pages[1], "MediaBox"),
        Some(vec![0.0, 0.0, 612.0, 792.0])
    );
    assert_eq!(pages[2].dict.i64("Rotate"), Some(90));
    assert_eq!(pages[2].dict.get("CropBox"), None);
    assert!(pages[2].dict.is("Type", "Page"));
}

#[test]
fn cycles_and_broken_kids() {
    // A cycle back to the root, missing and wrong kids, a direct page
    // (pages must be indirect), a wrong `Count`, and `Kids` behind a
    // reference.
    let pdf = file(&[
        "<</Type /Catalog /Pages 2 0 R>>",
        "<</Type /Pages /Kids [3 0 R 2 0 R 99 0 R 4 0 R (junk) <</Type /Page>> 5 0 R 6 0 R] /Count 42>>",
        "<</Type /Page /Parent 2 0 R>>",
        "<</Type /Pages /Kids [2 0 R 7 0 R]>>",
        "17",
        "<</Type /Pages /Kids 8 0 R>>",
        "<</Type /Page>>",
        "[9 0 R]",
        "<</Type /Page /Contents 10 0 R>>",
    ]);
    assert_eq!(numbers(&pdf.pages()), [3, 7, 9]);
}

#[test]
fn untyped_nodes() {
    // No `Type`: nodes with `Kids` are tree nodes, others pages.
    let pdf = file(&[
        "<</Type /Catalog /Pages 2 0 R>>",
        "<</Kids [3 0 R 4 0 R]>>",
        "<</Parent 2 0 R /MediaBox [0 0 1 1]>>",
        "<</Kids [5 0 R]>>",
        "<</Contents 6 0 R>>",
    ]);
    assert_eq!(numbers(&pdf.pages()), [3, 5]);
}

#[test]
fn a_page_as_the_root() {
    let pdf = file(&[
        "<</Type /Catalog /Pages 2 0 R>>",
        "<</Type /Page /MediaBox [0 0 5 5]>>",
    ]);
    assert_eq!(numbers(&pdf.pages()), [2]);
}

#[test]
fn loose_pages_when_the_tree_is_gone() {
    // The catalog's tree is missing: pages are found by type, in number
    // order, inheriting through their `Parent`s.
    let pdf = file(&[
        "<</Type /Catalog /Pages 9 0 R>>",
        "<</Type /Page /Parent 4 0 R>>",
        "<</Type /Font>>",
        "<</Type /Pages /Parent 5 0 R /Rotate 180>>",
        "<</Type /Pages /Parent 4 0 R /MediaBox [0 0 50 50] /Rotate 270>>",
        "<</Type /Page /Rotate 0>>",
    ]);
    let pages = pdf.pages();
    assert_eq!(numbers(&pages), [2, 6]);
    assert_eq!(pages[0].dict.i64("Rotate"), Some(180));
    assert_eq!(
        pages[0].dict.get("MediaBox").and_then(Object::as_numbers),
        Some(vec![0.0, 0.0, 50.0, 50.0])
    );
    assert_eq!(pages[1].dict.i64("Rotate"), Some(0));
}

#[test]
fn shared_subtrees_are_bounded() {
    // Each level lists the next twice: 2^40 paths to the leaf.
    let mut objects = vec!["<</Type /Catalog /Pages 2 0 R>>".to_string()];
    for level in 0..40 {
        let next = level + 3;
        objects.push(format!("<</Type /Pages /Kids [{next} 0 R {next} 0 R]>>"));
    }
    objects.push("<</Type /Page>>".to_string());
    let refs: Vec<&str> = objects.iter().map(String::as_str).collect();
    let pdf = file(&refs);
    let pages = pdf.pages();
    assert!(!pages.is_empty() && pages.len() <= 1 << 18);
    assert!(pages.iter().all(|p| p.obj.num == 42));
}
