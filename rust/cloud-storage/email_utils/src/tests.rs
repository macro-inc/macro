use crate::is_generic_email;

#[test]
fn test_is_generic_email() {
    // Test original "reply" pattern
    assert!(is_generic_email("reply@example.com"));
    assert!(is_generic_email("noreply@company.org"));
    assert!(is_generic_email("no-reply@service.com"));
    assert!(is_generic_email("do-not-reply@example.net"));
    assert!(is_generic_email(
        "32.mrtvirzriftueqkpj53gqqkinfzdiukcifng4s3bfvlvo4krnfpxqzdpinjxo2keonat2pi=@unsubscribe2.customer.io"
    ));
    assert!(is_generic_email(
        "reply-107199600-1441644_html-1962870046-524000040-59174@e.atlassian.com"
    ));

    // Test additional common system email prefixes
    assert!(is_generic_email("support@company.com"));
    assert!(is_generic_email("info@business.org"));
    assert!(is_generic_email("admin@system.net"));
    assert!(is_generic_email("help@service.io"));
    assert!(is_generic_email("notifications@app.com"));
    assert!(is_generic_email("billing@saas.co"));
    assert!(is_generic_email("system@platform.io"));
    assert!(is_generic_email("webmaster@website.com"));
    assert!(is_generic_email("customercare@retailer.com"));
    assert!(is_generic_email("service@product.net"));
    assert!(is_generic_email("feedback@startup.io"));
    assert!(is_generic_email("hello@company.org"));
    assert!(is_generic_email("orders@shop.com"));
    assert!(is_generic_email("contact@business.net"));
    assert!(is_generic_email("team@project.org"));
    assert!(is_generic_email("newsletter@news.com"));
    assert!(is_generic_email("confirmation@booking.com"));
    assert!(is_generic_email("verification@account.net"));
    assert!(is_generic_email("tracking@shipping.com"));
    assert!(is_generic_email("receipt@store.com"));

    // Test with dot and hyphen variants
    assert!(is_generic_email("no.reply@service.com"));
    assert!(is_generic_email("no_reply@service.com"));
    assert!(is_generic_email("customer.service@company.org"));
    assert!(is_generic_email("customer-service@company.org"));

    // Test with service provider domains
    assert!(is_generic_email("updates@mg.mailgun.org"));
    assert!(is_generic_email("notification@sendgrid.net"));
    assert!(is_generic_email("marketing@mailchimp.com"));
    assert!(is_generic_email("alert@amazonses.com"));

    // Test with numeric and code patterns
    assert!(is_generic_email("12345@notifications.com"));
    assert!(is_generic_email("id12345@system.net"));

    // Test non-automated emails (should return false)
    assert!(!is_generic_email("john.smith@example.com"));
    assert!(!is_generic_email("jane.doe@company.org"));
    assert!(!is_generic_email("user@personal.net"));
    assert!(!is_generic_email("employee@business.com"));
    assert!(!is_generic_email("replicate@example.com")); // Contains "reply" but not as a prefix/pattern
    assert!(!is_generic_email("maryinformation@gmail.com")); // Contains "information" but not as a pattern
}
