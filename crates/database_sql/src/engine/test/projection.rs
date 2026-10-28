use super::*;

#[test]
fn a_column_selected_twice_keeps_both_values_and_aliases() {
    let (outcome, requests) = drive(
        &catalog(),
        "SELECT name AS original, name AS copy, owner AS first_owner, owner AS second_owner \
         FROM crm.deals ORDER BY name",
        |_| {
            let mut rows = deals();
            rows[0]
                .cells
                .insert(OWNER, Cell::Entities(vec![SAM.into()]));
            rows
        },
    );

    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].needs, vec![NAME, OWNER]);
    assert_eq!(
        outcome
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["original", "copy", "first_owner", "second_owner"]
    );
    assert_eq!(
        outcome.rows,
        vec![
            vec![
                Some(Cell::Text("Acme".into())),
                Some(Cell::Text("Acme".into())),
                Some(Cell::Entities(vec![SAM.into()])),
                Some(Cell::Entities(vec![SAM.into()])),
            ],
            vec![
                Some(Cell::Text("Globex".into())),
                Some(Cell::Text("Globex".into())),
                None,
                None,
            ],
        ]
    );
    assert_eq!(outcome.row_ids, vec![ACME, GLOBEX]);
}
