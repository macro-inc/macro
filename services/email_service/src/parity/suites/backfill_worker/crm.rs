use super::*;
const CONTACT: Uuid = Uuid::from_u128(0x57000000000000000000000000004005);
const COMPANY: Uuid = Uuid::from_u128(0x57000000000000000000000000004006);
const EMAIL: &str = "client@vendor.example.com";
#[derive(Clone, Copy)]
enum Case {
    NoTeam,
    MissingLink,
    TeamFault,
    NoConsent,
    Consent,
    Received,
    BadEmail,
    Depopulate,
    KeepMessage,
    UserPopulate,
    UserDepopulate,
    NoLink,
    Fault(usize),
}
#[expect(
    clippy::disallowed_methods,
    reason = "CRM uses real private database; directory seed prevents any homepage request"
)]
async fn crm(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Case) {
    let mut lab = start(pool, name, shard).await;
    lab.transcript.normalizer.symbol(CONTACT, "<crm-contact>");
    lab.transcript.normalizer.symbol(COMPANY, "<crm-company>");
    if !matches!(
        case,
        Case::NoTeam | Case::MissingLink | Case::TeamFault | Case::NoLink
    ) {
        sqlx::query("INSERT INTO team(id,name,owner_id) VALUES($1,'fixture',$2)")
            .bind(TEAM)
            .bind(&lab.fixture.users[0])
            .execute(&lab.db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO team_user(team_id,user_id,team_role) VALUES($1,$2,'owner')")
            .bind(TEAM)
            .bind(&lab.fixture.users[0])
            .execute(&lab.db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO team_crm_settings(team_id,crm_enabled) VALUES($1,true)")
            .bind(TEAM)
            .execute(&lab.db)
            .await
            .unwrap();
        sqlx::query("INSERT INTO crm_domain_directory(domain,name) VALUES('vendor.example.com','Fixture vendor')").execute(&lab.db).await.unwrap();
    }
    if matches!(
        case,
        Case::Consent | Case::Received | Case::UserPopulate | Case::Fault(_)
    ) {
        sqlx::query("UPDATE email_links SET email_address='parity-a@example.com' WHERE id=$1")
            .bind(lab.fixture.links[0])
            .execute(&lab.db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO crm_email_consent(team_id,user_id,link_id,enabled) VALUES($1,$2,$3,true)",
        )
        .bind(TEAM)
        .bind(&lab.fixture.users[0])
        .bind(lab.fixture.links[0])
        .execute(&lab.db)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO email_contacts(id,link_id,email_address,name) VALUES($1,$2,$3,'Client')",
        )
        .bind(CONTACT)
        .bind(lab.fixture.links[0])
        .bind(EMAIL)
        .execute(&lab.db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO email_message_recipients(message_id,contact_id,recipient_type) VALUES($1,$2,'TO')").bind(lab.fixture.messages["m1a"]).bind(CONTACT).execute(&lab.db).await.unwrap();
        sqlx::query("UPDATE email_messages SET is_sent=true WHERE id=$1")
            .bind(lab.fixture.messages["m1a"])
            .execute(&lab.db)
            .await
            .unwrap();
    }
    if matches!(
        case,
        Case::Depopulate | Case::KeepMessage | Case::UserDepopulate
    ) {
        sqlx::query("INSERT INTO crm_companies(id,team_id,first_interaction,last_interaction) VALUES($1,$2,'2026-01-01','2026-01-01')").bind(COMPANY).bind(TEAM).execute(&lab.db).await.unwrap();
        sqlx::query(
            "INSERT INTO crm_domains(company_id,team_id,domain) VALUES($1,$2,'vendor.example.com')",
        )
        .bind(COMPANY)
        .bind(TEAM)
        .execute(&lab.db)
        .await
        .unwrap();
        sqlx::query("INSERT INTO crm_contacts(id,company_id,email,first_interaction,last_interaction) VALUES($1,$2,$3,'2026-01-01','2026-01-01')").bind(CONTACT).bind(COMPANY).bind(EMAIL).execute(&lab.db).await.unwrap();
        sqlx::query("INSERT INTO crm_contact_sources(contact_id,link_id) VALUES($1,$2)")
            .bind(CONTACT)
            .bind(lab.fixture.links[0])
            .execute(&lab.db)
            .await
            .unwrap();
        if matches!(case, Case::KeepMessage) {
            sqlx::query("INSERT INTO email_contacts(id,link_id,email_address,name) VALUES($1,$2,$3,'Client')").bind(CONTACT).bind(lab.fixture.links[0]).bind(EMAIL).execute(&lab.db).await.unwrap();
            sqlx::query("UPDATE email_messages SET from_contact_id=$2 WHERE id=$1")
                .bind(lab.fixture.messages["m1a"])
                .bind(CONTACT)
                .execute(&lab.db)
                .await
                .unwrap();
        }
    }
    if matches!(case, Case::UserDepopulate) {
        sqlx::query("UPDATE email_links SET email_address=substring(macro_id FROM 7) WHERE id=$1")
            .bind(lab.fixture.links[0])
            .execute(&lab.db)
            .await
            .unwrap();
    }
    if matches!(case, Case::Received) {
        sqlx::query("UPDATE email_messages SET is_sent=false,from_contact_id=$2 WHERE id=$1")
            .bind(lab.fixture.messages["m1a"])
            .bind(CONTACT)
            .execute(&lab.db)
            .await
            .unwrap();
    }
    let (op, payload) = match case {
        Case::UserPopulate | Case::NoLink => (
            "populate_crm_for_user",
            json!({"macro_id":if matches!(case,Case::NoLink){"macro|absent@example.com"}else{&lab.fixture.users[0]}}),
        ),
        Case::UserDepopulate => (
            "depopulate_crm_for_user",
            json!({"macro_id":lab.fixture.users[0],"team_id":TEAM}),
        ),
        Case::Depopulate | Case::KeepMessage => {
            ("depopulate_crm_contact", json!({"contact_email":EMAIL}))
        }
        _ => (
            "populate_crm_contact",
            json!({"contact_email":if matches!(case,Case::BadEmail){"bad"}else{EMAIL},"contact_name":"Client","first_at":"2026-01-01T00:00:00Z","last_at":"2026-01-02T00:00:00Z","is_sent":!matches!(case,Case::Received)}),
        ),
    };
    let mut message = delivery(&lab, op, payload, count);
    if matches!(case, Case::MissingLink) {
        let mut body: Value = serde_json::from_str(message.body.as_ref().unwrap()).unwrap();
        body["backfillOperation"][op]["link_id"] = json!(MISSING);
        message.body = Some(body.to_string());
    }
    if matches!(case, Case::TeamFault) {
        lab.sql_fault.fail_acquisition(2);
    }
    if let Case::Fault(n) = case {
        lab.sql_fault.fail_acquisition(n);
    }
    step(&mut lab, "CRM delivery", &message)
        .await
        .result
        .expect("CRM policy");
    if matches!(
        case,
        Case::Consent
            | Case::Received
            | Case::Depopulate
            | Case::UserPopulate
            | Case::UserDepopulate
    ) {
        step(&mut lab, "CRM redelivery", &message.redelivered())
            .await
            .result
            .expect("duplicate");
    }
    if matches!(case, Case::NoTeam | Case::NoConsent) {
        let next = delivery(
            &lab,
            "populate_crm_for_user",
            json!({"macro_id":lab.fixture.users[0]}),
            count,
        );
        step(&mut lab, "user CRM admission", &next)
            .await
            .result
            .expect("no contribution");
    }
    if matches!(case, Case::NoTeam) {
        let next = delivery(
            &lab,
            "depopulate_crm_contact",
            json!({"contact_email":EMAIL}),
            count,
        );
        step(&mut lab, "depopulate without team", &next)
            .await
            .result
            .expect("no team");
    }
    if matches!(case, Case::NoLink) {
        let next = delivery(
            &lab,
            "depopulate_crm_for_user",
            json!({"macro_id":"macro|absent@example.com","team_id":TEAM}),
            count,
        );
        step(&mut lab, "depopulate absent user", &next)
            .await
            .result
            .expect("no link");
    }
    lab.transcript.finish();
}

async fn seed_contacts(pool: PgPool, name: &'static str, shard: u32, count: u32, fail: bool) {
    let mut lab = start(pool, name, shard).await;
    let mut full = full_message("seed", "t1", &["SENT"]);
    full["payload"]["headers"][1]["value"] = json!(format!(
        "{}, Client <client@example.org>, Client <CLIENT@example.org>, noreply@example.org, invalid@localhost",
        format!("parity-{shard}-a@example.com")
    ));
    persistent(&lab, "messages/seed", 200, full);
    if fail {
        lab.sqs.fail_nth_send(1);
    }
    let message = delivery(
        &lab,
        "seed_sent_contact",
        json!({"message_provider_id":"seed"}),
        count,
    );
    step(&mut lab, "seed filtered contacts", &message)
        .await
        .result
        .expect("seed policy");
    if !fail {
        lab.reset_admission().await;
        step(&mut lab, "seed duplicate", &message.redelivered())
            .await
            .result
            .expect("duplicate");
    }
    lab.transcript.finish();
}
cases! {crm;
    crm_no_team,71900,1,Case::NoTeam;
    crm_no_team_redelivery,74900,20,Case::NoTeam; crm_missing_link,71903,1,Case::MissingLink;
    crm_missing_link_redelivery,74903,20,Case::MissingLink;
    crm_team_failure,71906,1,Case::TeamFault;
    crm_team_failure_redelivery,74906,20,Case::TeamFault; crm_without_consent,71909,1,Case::NoConsent;
    crm_without_consent_redelivery,74909,20,Case::NoConsent;
    crm_consented_sent,71912,1,Case::Consent; crm_consented_sent_redelivery,71915,20,Case::Consent;
    crm_received,71918,1,Case::Received;
    crm_received_redelivery,74918,20,Case::Received; crm_malformed_email,71921,1,Case::BadEmail;
    crm_malformed_email_redelivery,74921,20,Case::BadEmail;
    crm_depopulate,71924,1,Case::Depopulate;
    crm_depopulate_redelivery,74924,20,Case::Depopulate; crm_depopulate_keep_message,71927,1,Case::KeepMessage;
    crm_depopulate_keep_message_redelivery,74927,20,Case::KeepMessage;
    crm_populate_user,71930,1,Case::UserPopulate;
    crm_populate_user_redelivery,74930,20,Case::UserPopulate; crm_depopulate_user,71933,1,Case::UserDepopulate;
    crm_depopulate_user_redelivery,74933,20,Case::UserDepopulate;
    crm_user_missing,71936,1,Case::NoLink;
    crm_user_missing_redelivery,74936,20,Case::NoLink; crm_contribution_failure,71939,1,Case::Fault(3);
    crm_contribution_failure_redelivery,74939,20,Case::Fault(3);
    crm_lookup_failure,71942,1,Case::Fault(4);
    crm_lookup_failure_redelivery,74942,20,Case::Fault(4);
}
cases! {seed_contacts;
    seed_contact_filtering,71945,1,false; seed_contact_filtering_redelivery,71948,20,false;
    seed_contact_send_failure,71951,1,true;
    seed_contact_send_failure_redelivery,74951,20,true;
}
