use super::*;

#[test]
fn test_add_skip_offboarding_query_param() -> anyhow::Result<()> {
    // URL without query param
    let url = "https://example.com";
    let result = add_skip_offboarding_query_param(url.try_into()?);
    assert_eq!(
        result.to_string(),
        "https://example.com/?skip_offboarding=true"
    );
    // URL with existing query param
    let url = "https://example.com?foo=bar";
    let result = add_skip_offboarding_query_param(url.try_into()?);
    assert_eq!(
        result.to_string(),
        "https://example.com/?foo=bar&skip_offboarding=true"
    );

    Ok(())
}
