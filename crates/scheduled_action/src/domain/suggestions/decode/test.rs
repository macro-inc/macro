use serde_json::{Map, json};

use super::*;

fn reason_problems(reason: &str) -> Vec<String> {
    catalog_pick(
        "inbox",
        Map::new(),
        reason,
        vec![Surface::Email],
        0.5,
        &[Surface::Email],
    )
    .err()
    .unwrap_or_default()
}

#[test]
fn a_reason_is_one_plain_line_that_names_no_address() {
    assert!(reason_problems("Most of your mail is supplier updates").is_empty());
    assert!(!reason_problems("orders@supplier.example writes daily").is_empty());
    assert!(!reason_problems("From <orders@supplier.example>").is_empty());
    assert!(!reason_problems("line one\nline two").is_empty());
    assert!(!reason_problems("hidden\u{202E}text").is_empty());
    assert!(!reason_problems(&"long ".repeat(40)).is_empty());
    assert!(!reason_problems("  ").is_empty());
    // An @ that isn't an address is fine.
    assert!(reason_problems("You get @mentions all day").is_empty());
    // Other personal details, by their shape.
    // Synthetic details, built so the source holds none.
    for leaked in [
        format!("Your supplier at {} Baker Street writes daily", 221),
        format!("Deliveries go to {} Rue Saint Honore Ave", 4),
        format!("Call ({}) {}-{} about late orders", 415, 555, "0134"),
        format!("Ring +{} {} {} {} for invoices", 44, 20, 7946, "0958"),
    ] {
        let problems = reason_problems(&leaked);
        assert!(
            problems
                .iter()
                .any(|problem| problem.contains("without anyone's details")),
            "{leaked}: {problems:?}"
        );
    }
    // Numbers and dates that aren't details stay.
    for fine in [
        "You get about 40 supplier emails a week",
        "Invoices arrive on the 1st and 15th, due in 30 days",
        "Your 3 weekly reports land on 2026-11-09",
    ] {
        assert!(reason_problems(fine).is_empty(), "{fine}");
    }
}

#[test]
fn knob_values_must_fit_their_knobs() {
    let fits = |knobs: Map<String, Value>| {
        catalog_pick(
            "email_tags",
            knobs,
            "fits",
            vec![Surface::Email],
            0.5,
            &[Surface::Email],
        )
    };
    let mut name = Map::new();
    name.insert("fyiTag".to_owned(), json!("Suppliers"));
    let kept = fits(name).unwrap();
    assert_eq!(
        kept.pick,
        StoredPick::Catalog {
            key: "email_tags".to_owned(),
            knobs: [("fyiTag".to_owned(), json!("Suppliers"))]
                .into_iter()
                .collect()
        }
    );
    let mut long = Map::new();
    long.insert(
        "fyiTag".to_owned(),
        json!("x".repeat(MAX_TEXT_KNOB_CHARS + 1)),
    );
    assert!(fits(long).is_err());
    let mut unknown = Map::new();
    unknown.insert("forward_to".to_owned(), json!("outside@example.com"));
    assert!(fits(unknown).is_err());
    let mut wrong_type = Map::new();
    wrong_type.insert("fyiTag".to_owned(), json!({"nested": "object"}));
    assert!(fits(wrong_type).is_err());
}

#[test]
fn surfaces_are_the_sessions_and_estimates_are_probabilities() {
    let pick = |surfaces: Vec<Surface>, keep: f32| {
        catalog_pick(
            "inbox",
            Map::new(),
            "fits",
            surfaces,
            keep,
            &[Surface::Email],
        )
    };
    assert!(pick(vec![Surface::Email, Surface::Email], 0.5).is_ok());
    assert!(pick(vec![], 0.5).is_err());
    assert!(pick(vec![Surface::Chat], 0.5).is_err());
    assert!(pick(vec![Surface::Email], 1.5).is_err());
    assert!(pick(vec![Surface::Email], f32::NAN).is_err());
}
