use super::*;

#[test]
fn soup_page_outcome_names_how_the_page_ended_without_its_error_text() {
    let refused: async_graphql::Result<()> =
        Err(async_graphql::Error::new(PRIMARY_CHANNEL_READS_REFUSED));
    let missing: async_graphql::Result<()> =
        Err(async_graphql::Error::new(PRIMARY_CHANNEL_SOUP_MISSING));
    let invalid_input: async_graphql::Result<()> = Err(async_graphql::Error::new(
        "invalid sender: someone@example.com",
    ));

    assert_eq!(soup_page_outcome(&Ok(())), "ok");
    assert_eq!(soup_page_outcome(&refused), "primary_refused");
    assert_eq!(soup_page_outcome(&missing), "primary_missing");
    assert_eq!(soup_page_outcome(&invalid_input), "error");
}
