use super::{dedupe_emails, is_generic_email};

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

#[test]
fn test_is_generic_email_new_prefixes() {
    // Authentication/Security patterns
    assert!(is_generic_email("otp@company.com"));
    assert!(is_generic_email("password-reset@service.com"));
    assert!(is_generic_email("auth@platform.io"));
    assert!(is_generic_email("login@account.com"));
    assert!(is_generic_email("2fa@security.net"));
    assert!(is_generic_email("mfa@auth.com"));
    assert!(is_generic_email("token@api.io"));

    // Transactional patterns
    assert!(is_generic_email("invoice@billing.com"));
    assert!(is_generic_email("payment@shop.com"));
    assert!(is_generic_email("transaction@bank.net"));
    assert!(is_generic_email("refund@store.com"));
    assert!(is_generic_email("subscription@saas.io"));
    assert!(is_generic_email("renewal@service.com"));

    // System/DevOps patterns
    assert!(is_generic_email("bounce@mailer.com"));
    assert!(is_generic_email("daemon@server.net"));
    assert!(is_generic_email("cron@system.io"));
    assert!(is_generic_email("scheduler@jobs.com"));
    assert!(is_generic_email("monitor@infra.net"));
    assert!(is_generic_email("status@ops.io"));
    assert!(is_generic_email("logs@devops.com"));
    assert!(is_generic_email("error@alerts.net"));
    assert!(is_generic_email("sysadmin@server.com"));
    assert!(is_generic_email("root@linux.org"));
    assert!(is_generic_email("ops@infrastructure.io"));

    // Marketing/Communication patterns
    assert!(is_generic_email("promo@deals.com"));
    assert!(is_generic_email("promotions@marketing.net"));
    assert!(is_generic_email("offers@shop.io"));
    assert!(is_generic_email("deals@retail.com"));
    assert!(is_generic_email("digest@news.net"));
    assert!(is_generic_email("weekly@newsletter.com"));
    assert!(is_generic_email("daily@updates.io"));
    assert!(is_generic_email("announcements@company.org"));
    assert!(is_generic_email("survey@feedback.com"));

    // Business department patterns
    assert!(is_generic_email("hr@company.com"));
    assert!(is_generic_email("legal@corp.net"));
    assert!(is_generic_email("finance@business.io"));
    assert!(is_generic_email("press@media.com"));
    assert!(is_generic_email("partnerships@venture.net"));
    assert!(is_generic_email("affiliates@marketing.io"));
    assert!(is_generic_email("events@conference.com"));
    assert!(is_generic_email("reservations@hotel.net"));
    assert!(is_generic_email("booking@travel.io"));
}

#[test]
fn test_is_generic_email_new_domains() {
    // Email service providers
    assert!(is_generic_email("user@mandrillapp.com"));
    assert!(is_generic_email("user@postmarkapp.com"));
    assert!(is_generic_email("user@sendinblue.com"));
    assert!(is_generic_email("user@klaviyo.com"));
    assert!(is_generic_email("user@em.mailgun.org"));

    // CRM/Support platforms
    assert!(is_generic_email("user@intercom.io"));
    assert!(is_generic_email("user@intercom-mail.com"));
    assert!(is_generic_email("user@zendesk.com"));
    assert!(is_generic_email("user@freshdesk.com"));
    assert!(is_generic_email("user@campaign-archive.com"));

    // Subdomains of known providers
    assert!(is_generic_email("user@mail.sendgrid.net"));
    assert!(is_generic_email("user@bounce.amazonses.com"));
    assert!(is_generic_email("notifications@email.klaviyo.com"));
}

#[test]
fn test_is_generic_email_expanded_keywords() {
    // "notification" anywhere in the local part, not just as a prefix
    assert!(is_generic_email("calendar-notification@google.com"));
    assert!(is_generic_email("jira-notification@company.com"));
    assert!(is_generic_email("github-notifications@example.com"));

    // Other strong keywords anywhere in the local part
    assert!(is_generic_email("weekly-newsletter@blog.com"));
    assert!(is_generic_email("invitations@linkedin.com"));
    assert!(is_generic_email("donotrespond@bank.com"));
    assert!(is_generic_email("do-not-respond@service.net"));
    assert!(is_generic_email("do.not.respond@service.net"));
    assert!(is_generic_email("do_not_respond@service.net"));
    assert!(is_generic_email("donation@charity.org"));

    // New automated prefixes
    assert!(is_generic_email("calendar@scheduling.io"));
    assert!(is_generic_email("reminder@tasks.com"));
    assert!(is_generic_email("reminders@app.net"));
    assert!(is_generic_email("invite@team.com"));
    assert!(is_generic_email("meeting-recordings@zoom.us"));
    assert!(is_generic_email("appointments@dentist.com"));
    assert!(is_generic_email("messages@platform.io"));
    assert!(is_generic_email("statement@bank.com"));
    assert!(is_generic_email("statements@creditcard.net"));
    assert!(is_generic_email("payroll@company.com"));
    assert!(is_generic_email("expenses@corp.io"));
    assert!(is_generic_email("rewards@airline.com"));
    assert!(is_generic_email("loyalty@retail.net"));
    assert!(is_generic_email("ticket-12345@helpdesk.com"));
    assert!(is_generic_email("registration@conference.org"));
    assert!(is_generic_email("activation@service.io"));
    assert!(is_generic_email("membership@gym.com"));
    assert!(is_generic_email("fraud-alerts@bank.net"));
    assert!(is_generic_email("update@product.com"));
    assert!(is_generic_email("surveys@research.org"));
    assert!(is_generic_email("webinar@events.io"));
    assert!(is_generic_email("community@forum.net"));
    assert!(is_generic_email("onboarding@saas.com"));
    assert!(is_generic_email("recruiting@company.com"));
    assert!(is_generic_email("concierge@bank.com"));
    assert!(is_generic_email("reports@analytics.io"));
    assert!(is_generic_email("reservation@hotel.com"));
    assert!(is_generic_email("donations@charity.org"));
}

#[test]
fn test_is_generic_email_expanded_domains() {
    // ESP sending/bounce domains
    assert!(is_generic_email("user@mcsv.net"));
    assert!(is_generic_email("user@bounce.mcdlv.net"));
    assert!(is_generic_email("user@customeriomail.com"));
    assert!(is_generic_email("user@sparkpostmail.com"));
    assert!(is_generic_email("user@pm.mtasv.net"));
    assert!(is_generic_email("user@pipedrivemail.com"));
    assert!(is_generic_email("user@mailersend.net"));
    assert!(is_generic_email("user@mailerlite.com"));
    assert!(is_generic_email("user@activehosted.com"));
    assert!(is_generic_email("user@sailthru.com"));
    assert!(is_generic_email("user@reply.exacttarget.com"));
    assert!(is_generic_email("user@smtp2go.com"));
    assert!(is_generic_email("user@elasticemail.com"));
    assert!(is_generic_email("user@sendpulse.com"));
    assert!(is_generic_email("user@getresponse.com"));
    assert!(is_generic_email("user@aweber.com"));

    // Product notification domains
    assert!(is_generic_email("user@facebookmail.com"));
    assert!(is_generic_email("dse@docusign.net"));
    assert!(is_generic_email("jira@mycompany.atlassian.net"));
    assert!(is_generic_email("user@qemailserver.com"));
    assert!(is_generic_email("user@freshservice.com"));
    assert!(is_generic_email("user@calendar-server.bounces.google.com"));
}

#[test]
fn test_is_generic_email_expanded_false_positives_avoided() {
    // Real names that share letters with new prefixes
    assert!(!is_generic_email("joao.sales@gmail.com")); // "sales" not at start
    assert!(!is_generic_email("reporter.jones@news.com")); // "report" followed by a letter
    assert!(!is_generic_email("inviteeglobal@example.com")); // "invite" followed by a letter
    assert!(!is_generic_email("membersonly.fan@example.com")); // "members" followed by a letter
    assert!(!is_generic_email("expensive.taste@example.com"));
    assert!(!is_generic_email("communityle@example.com")); // "community" followed by a letter
    assert!(!is_generic_email("maryinformation@gmail.com")); // no "notification" substring
    // Corporate domains that host real humans stay non-generic
    assert!(!is_generic_email("jane.doe@atlassian.com"));
    assert!(!is_generic_email("jane.doe@docusign.com"));
    assert!(!is_generic_email("jane.doe@google.com"));
}

#[test]
fn test_is_generic_email_autogenerated_patterns() {
    // UUID patterns
    assert!(is_generic_email(
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890@company.com"
    ));
    assert!(is_generic_email(
        "550e8400-e29b-41d4-a716-446655440000@service.net"
    ));

    // Long hex strings
    assert!(is_generic_email("abcdef1234567890abcdef@mailer.com"));
    assert!(is_generic_email(
        "0123456789abcdef0123456789@notifications.net"
    ));

    // Numeric prefix patterns
    assert!(is_generic_email("000000123456@bounce.com"));
    assert!(is_generic_email("123456789abc@tracker.net"));

    // Very long local parts (likely autogenerated)
    assert!(is_generic_email(
        "this-is-a-very-long-autogenerated-email-address-that-exceeds-fifty-chars@company.com"
    ));
}

#[test]
fn test_is_generic_email_false_positives_avoided() {
    // Words containing prefixes but not matching the pattern
    assert!(!is_generic_email("supportive.person@company.com"));
    assert!(!is_generic_email("informative@blog.net"));
    assert!(!is_generic_email("helper.jones@email.com"));
    assert!(!is_generic_email("contacted@domain.org"));
    assert!(!is_generic_email("teams.member@office.com"));

    // Regular names with numbers
    assert!(!is_generic_email("john123@gmail.com"));
    assert!(!is_generic_email("user2024@company.net"));
    assert!(!is_generic_email("alex.smith99@domain.org"));

    // Normal business emails
    assert!(!is_generic_email("ceo@startup.io"));
    assert!(!is_generic_email("founder@company.com"));
}

#[test]
fn test_is_generic_email_case_insensitivity() {
    assert!(is_generic_email("NOREPLY@COMPANY.COM"));
    assert!(is_generic_email("NoReply@Company.Com"));
    assert!(is_generic_email("SUPPORT@SERVICE.NET"));
    assert!(is_generic_email("Newsletter@News.Org"));
    assert!(is_generic_email("USER@SENDGRID.NET"));
}

#[test]
fn test_is_generic_email_invalid_input() {
    // Invalid emails without @ should return false, not panic
    assert!(!is_generic_email("invalid-email-no-at-sign"));
    assert!(!is_generic_email(""));
    assert!(!is_generic_email("just-text"));
}

#[test]
fn test_dedupe_emails() {
    let emails = vec![
        // Basic duplicates
        "user@example.com".to_string(),
        "user@example.com".to_string(),
        // Plus aliases that should normalize to the same email
        "user+shopping@example.com".to_string(),
        "user+newsletter@example.com".to_string(),
        "user@example.com".to_string(),
        // Different emails that should remain separate
        "alice@example.com".to_string(),
        "bob@example.com".to_string(),
        // Plus aliases for different base emails
        "alice+work@example.com".to_string(),
        "alice+personal@example.com".to_string(),
        "bob+shopping@example.com".to_string(),
        // Edge cases
        "user+@example.com".to_string(),         // Empty plus part
        "user++extra@example.com".to_string(),   // Multiple plus signs
        "user+tag+more@example.com".to_string(), // Plus in the tag part
        "no-plus@example.com".to_string(),
        // Plus sign after @ (shouldn't be processed)
        "user@example+tag.com".to_string(),
        "user@example+tag.com".to_string(),
        // Complex cases
        "test.user+tag@domain.co.uk".to_string(),
        "test.user+different@domain.co.uk".to_string(),
        "test.user@domain.co.uk".to_string(),
    ];

    let mut result = dedupe_emails(emails);
    result.sort();

    let expected = vec![
        "alice@example.com".to_string(),
        "bob@example.com".to_string(),
        "no-plus@example.com".to_string(),
        "test.user@domain.co.uk".to_string(),
        "user@example+tag.com".to_string(), // Plus after @ should remain
        "user@example.com".to_string(),
    ];

    assert_eq!(result, expected);
    assert_eq!(result.len(), 6);
}

#[test]
fn test_dedupe_emails_empty() {
    let emails: Vec<String> = vec![];
    let result = dedupe_emails(emails);
    assert_eq!(result, Vec::<String>::new());
}

#[test]
fn test_dedupe_emails_no_duplicates() {
    let emails = vec![
        "user1@example.com".to_string(),
        "user2@example.com".to_string(),
        "user3@example.com".to_string(),
    ];
    let mut result = dedupe_emails(emails);
    result.sort();

    let expected = vec![
        "user1@example.com".to_string(),
        "user2@example.com".to_string(),
        "user3@example.com".to_string(),
    ];

    assert_eq!(result, expected);
}

#[test]
fn test_dedupe_emails_all_same_base() {
    let emails = vec![
        "user+tag1@example.com".to_string(),
        "user+tag2@example.com".to_string(),
        "user+tag3@example.com".to_string(),
        "user@example.com".to_string(),
    ];
    let result = dedupe_emails(emails);

    assert_eq!(result.len(), 1);
    assert_eq!(result[0], "user@example.com");
}
