use super::*;

#[derive(Clone, Copy)]
enum Case {
    CacheMiss,
    WrongCacheType,
    Reauth,
    Unavailable,
    Quota,
    Cooldown,
    BadGateType,
}

async fn admission(pool: PgPool, name: &'static str, shard: u32, retry: bool, case: (Op, Case)) {
    let (op, case) = case;
    let mut lab = start(pool, name, shard).await;
    seed_history(&lab, "100").await;
    provider_message(&lab, "m1a", "t1", &["INBOX", "UNREAD"]);
    let link = email_db_client::links::get::fetch_link_by_id(&lab.db, lab.fixture.links[0])
        .await
        .expect("link")
        .expect("fixture");
    let token = models_email::email::service::cache::TokenCacheKey::new(
        &link.fusionauth_user_id,
        link.email_address.0.as_ref(),
        link.provider.as_str(),
    )
    .to_redis_key();
    let mut conn = lab.redis_connection();
    lab.stub.reply(
        "GET",
        "/internal/google_access_token",
        200,
        json!({"access_token":"fake-access-token"}),
    );
    match case {
        Case::CacheMiss | Case::WrongCacheType | Case::Reauth | Case::Unavailable => {
            let _: usize = redis::cmd("DEL")
                .arg(&token)
                .query_async(&mut conn)
                .await
                .expect("clear token");
            if matches!(case, Case::WrongCacheType) {
                let _: usize = redis::cmd("LPUSH")
                    .arg(&token)
                    .arg("wrong-type")
                    .query_async(&mut conn)
                    .await
                    .expect("wrong cache type");
            }
            if matches!(case, Case::Reauth) {
                lab.stub.reply(
                    "GET",
                    "/internal/google_access_token",
                    404,
                    json!({"error":"grant missing"}),
                );
            }
            if matches!(case, Case::Unavailable) {
                lab.stub.reply(
                    "GET",
                    "/internal/google_access_token",
                    503,
                    json!({"error":"temporarily unavailable"}),
                );
            }
        }
        Case::Quota => {
            let _: usize = redis::cmd("HSET")
                .arg(format!("gmail:{{{}}}:window", link.id))
                .arg(chrono::Utc::now().timestamp())
                .arg(2300)
                .query_async(&mut conn)
                .await
                .expect("full window");
        }
        Case::Cooldown => {
            let _: () = redis::cmd("SET")
                .arg(format!("gmail:{{{}}}:cooldown", link.id))
                .arg("1")
                .arg("PX")
                .arg(3_600_000)
                .query_async(&mut conn)
                .await
                .expect("cooldown");
        }
        Case::BadGateType => {
            let _: () = redis::cmd("SET")
                .arg(format!("gmail:{{{}}}:window", link.id))
                .arg("wrong-type")
                .query_async(&mut conn)
                .await
                .expect("gate type");
        }
    }
    let message = delivery(&lab, op, "m1a");
    lab.worker_step("admission and token", queue(retry), &message)
        .await
        .result
        .expect("classified");
    if matches!(
        case,
        Case::Reauth | Case::CacheMiss | Case::WrongCacheType | Case::Unavailable
    ) {
        duplicate(&mut lab, retry, &message).await;
    }
    lab.transcript.finish();
}

cases! { admission;
    admission_history_cache_miss_primary, 84000, false, (Op::History,Case::CacheMiss);
    admission_history_cache_miss_retry, 84003, true, (Op::History,Case::CacheMiss);
    admission_history_wrong_cache_type_primary, 84006, false, (Op::History,Case::WrongCacheType);
    admission_history_wrong_cache_type_retry, 84009, true, (Op::History,Case::WrongCacheType);
    admission_history_reauth_primary, 84012, false, (Op::History,Case::Reauth);
    admission_history_reauth_retry, 84015, true, (Op::History,Case::Reauth);
    admission_history_unavailable_primary, 84018, false, (Op::History,Case::Unavailable);
    admission_history_unavailable_retry, 84021, true, (Op::History,Case::Unavailable);
    admission_history_quota_primary, 84024, false, (Op::History,Case::Quota);
    admission_history_quota_retry, 84027, true, (Op::History,Case::Quota);
    admission_history_cooldown_primary, 84030, false, (Op::History,Case::Cooldown);
    admission_history_cooldown_retry, 84033, true, (Op::History,Case::Cooldown);
    admission_history_bad_gate_type_primary, 84036, false, (Op::History,Case::BadGateType);
    admission_history_bad_gate_type_retry, 84039, true, (Op::History,Case::BadGateType);
    admission_upsert_cache_miss_primary, 84042, false, (Op::Upsert,Case::CacheMiss);
    admission_upsert_cache_miss_retry, 84045, true, (Op::Upsert,Case::CacheMiss);
    admission_upsert_wrong_cache_type_primary, 84048, false, (Op::Upsert,Case::WrongCacheType);
    admission_upsert_wrong_cache_type_retry, 84051, true, (Op::Upsert,Case::WrongCacheType);
    admission_upsert_reauth_primary, 84054, false, (Op::Upsert,Case::Reauth);
    admission_upsert_reauth_retry, 84057, true, (Op::Upsert,Case::Reauth);
    admission_upsert_unavailable_primary, 84060, false, (Op::Upsert,Case::Unavailable);
    admission_upsert_unavailable_retry, 84063, true, (Op::Upsert,Case::Unavailable);
    admission_upsert_quota_primary, 84066, false, (Op::Upsert,Case::Quota);
    admission_upsert_quota_retry, 84069, true, (Op::Upsert,Case::Quota);
    admission_upsert_cooldown_primary, 84072, false, (Op::Upsert,Case::Cooldown);
    admission_upsert_cooldown_retry, 84075, true, (Op::Upsert,Case::Cooldown);
    admission_upsert_bad_gate_type_primary, 84078, false, (Op::Upsert,Case::BadGateType);
    admission_upsert_bad_gate_type_retry, 84081, true, (Op::Upsert,Case::BadGateType);
    admission_labels_cache_miss_primary, 84084, false, (Op::Labels,Case::CacheMiss);
    admission_labels_cache_miss_retry, 84087, true, (Op::Labels,Case::CacheMiss);
    admission_labels_wrong_cache_type_primary, 84090, false, (Op::Labels,Case::WrongCacheType);
    admission_labels_wrong_cache_type_retry, 84093, true, (Op::Labels,Case::WrongCacheType);
    admission_labels_reauth_primary, 84096, false, (Op::Labels,Case::Reauth);
    admission_labels_reauth_retry, 84099, true, (Op::Labels,Case::Reauth);
    admission_labels_unavailable_primary, 84102, false, (Op::Labels,Case::Unavailable);
    admission_labels_unavailable_retry, 84105, true, (Op::Labels,Case::Unavailable);
    admission_labels_quota_primary, 84108, false, (Op::Labels,Case::Quota);
    admission_labels_quota_retry, 84111, true, (Op::Labels,Case::Quota);
    admission_labels_cooldown_primary, 84114, false, (Op::Labels,Case::Cooldown);
    admission_labels_cooldown_retry, 84117, true, (Op::Labels,Case::Cooldown);
    admission_labels_bad_gate_type_primary, 84120, false, (Op::Labels,Case::BadGateType);
    admission_labels_bad_gate_type_retry, 84123, true, (Op::Labels,Case::BadGateType);
}
