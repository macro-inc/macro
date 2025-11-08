/// (max_attempts, expiry_seconds)
pub struct RateLimitConfig {
    pub passwordless: (u64, i64),
    pub passwordless_daily: (u64, i64),
    pub login_code: (u64, i64),
    pub login_code_daily: (u64, i64),
    #[allow(dead_code)]
    pub verify_email_minute: (u64, i64),
    #[allow(dead_code)]
    pub verify_email_daily: (u64, i64),
    #[allow(dead_code)]
    pub merge_email_minute: (u64, i64),
    #[allow(dead_code)]
    pub merge_email_daily: (u64, i64),
    // pub sso: (u64, i64),
}

pub static RATE_LIMIT_CONFIG: RateLimitConfig = RateLimitConfig {
    passwordless: (1, 30),           // 1 attempt per 30 seconds
    passwordless_daily: (20, 86400), // 20 attempts per day
    login_code: (5, 60),
    login_code_daily: (100, 86400),
    // sso: (5, 300),
    verify_email_minute: (5, 60),
    verify_email_daily: (5, 86400),

    merge_email_minute: (5, 60),
    merge_email_daily: (5, 86400),
};
