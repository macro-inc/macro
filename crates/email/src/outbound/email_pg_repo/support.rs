use super::EmailPgRepo;
use crate::domain::{models::EmailErr, support::SupportMail};
use chrono::{DateTime, Utc};
use uuid::Uuid;
impl EmailPgRepo {
    /// Bounded, stable intake restricted to a connected inbox and exact recipient.
    /// The caller must verify access to `link` using the email service first.
    pub async fn support_mail(
        &self,
        link: Uuid,
        address: &str,
        at: DateTime<Utc>,
        id: Uuid,
    ) -> Result<Vec<SupportMail>, EmailErr> {
        sqlx::query_as!(SupportMail,r#"SELECT m.id,m.thread_id,c.email_address AS "email!",COALESCE(c.name,c.email_address,'Customer') AS "name!",COALESCE(NULLIF(m.subject,''),'Support request') AS "subject!",COALESCE(NULLIF(m.body_text,''),NULLIF(m.body_macro,''),NULLIF(m.snippet,''),'(No message text)') AS "content!",m.created_at
   FROM email_messages m JOIN email_contacts c ON c.id=m.from_contact_id
   WHERE m.link_id=$1 AND NOT m.is_sent AND NOT m.is_draft AND c.email_address IS NOT NULL
   AND (m.created_at,m.id)>($3,$4)
   AND EXISTS(SELECT 1 FROM email_message_recipients r JOIN email_contacts rc ON rc.id=r.contact_id WHERE r.message_id=m.id AND lower(rc.email_address)=lower($2))
   ORDER BY m.created_at,m.id LIMIT 100"#,link,address,at,id).fetch_all(&self.pool).await.map_err(|e|EmailErr::RepoErr(e.into()))
    }
}
