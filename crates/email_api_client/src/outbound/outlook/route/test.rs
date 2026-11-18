use super::url_template;

#[test]
fn ids_and_odata_keys_collapse_to_one_template_per_route() {
    assert_eq!(
        url_template(
            "/v1.0/",
            "/v1.0/me/mailFolders/AQMkADAwATM3ZmYAZS1iNjYAYi05/messages/delta"
        ),
        "/me/mailFolders/{id}/messages/delta"
    );
    assert_eq!(
        url_template(
            "/v1.0/",
            "/v1.0/me/mailFolders('AQMkADAwATM3ZmYAZS1iNjYAYi05NDc0LTAwAi0wMAoALgAAA73oe0jpHIRF')/messages/delta"
        ),
        "/me/mailFolders/{id}/messages/delta"
    );
    assert_eq!(
        url_template("/v1.0/", "/v1.0/me/messages/AAMkAGI2TG93AAA=/attachments"),
        "/me/messages/{id}/attachments"
    );
    assert_eq!(
        url_template("/v1.0/", "/v1.0/me/messages/AAMk%3D/$value"),
        "/me/messages/{id}/$value"
    );
}

#[test]
fn user_chosen_names_never_reach_the_template() {
    assert_eq!(
        url_template(
            "/v1.0/",
            "/v1.0/me/outlook/masterCategories/Quarterly%20review"
        ),
        "/me/outlook/masterCategories/{id}"
    );
    assert_eq!(
        url_template("/v1.0/", "/v1.0/users/someone@example.com/messages"),
        "/users/{id}/messages"
    );
}
