use anyhow::Context;
use aws_sdk_sesv2::{
    self as ses,
    types::{Body, Content, Destination, EmailContent, Message},
};

static INVITE_USER_SUBJECT: &str = "Invitation to Macro";

/// Builds the user invite message
fn build_user_invite_message(org_name: &str, environment: &str) -> String {
    let prefix = match environment {
        "prod" => "".to_string(),
        _ => format!("{}.", environment),
    };

    let result = r#"<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
   <head>
      <meta charset="utf-8">
      <meta name="x-apple-disable-message-reformatting">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
      <meta name="color-scheme" content="light dark">
      <meta name="supported-color-schemes" content="light dark">
      <!--[if mso]>
      <noscript>
         <xml>
            <o:OfficeDocumentSettings
               xmlns:o="urn:schemas-microsoft-com:office:office"
               >
               <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
         </xml>
      </noscript>
      <style>
         td,
         th,
         div,
         p,
         a,
         h1,
         h2,
         h3,
         h4,
         h5,
         h6 {
         font-family: "Segoe UI", sans-serif;
         mso-line-height-rule: exactly;
         }
      </style>
      <![endif]-->      
      <title>Macro Access Code</title>
      <style>.hover-text-gray-600:hover {
         color: #4b5563 !important
         }
         @media (max-width: 425px) {
         .xs-my-10 {
         margin-top: 40px !important;
         margin-bottom: 40px !important
         }
         .xs-py-8 {
         padding-top: 32px !important;
         padding-bottom: 32px !important
         }
         .xs-px-6 {
         padding-left: 24px !important;
         padding-right: 24px !important
         }
         .xs-py-12 {
         padding-top: 48px !important;
         padding-bottom: 48px !important
         }
         .xs-py-10 {
         padding-top: 40px !important;
         padding-bottom: 40px !important
         }
         .xs-py-6 {
         padding-top: 24px !important;
         padding-bottom: 24px !important
         }
         .xs-text-3xl {
         font-size: 30px !important
         }
         .xs-text-4xl {
         font-size: 36px !important
         }
         .xs-tracking-0_3em {
         letter-spacing: 0.3em !important
         }
         }
         .CTA {
             text-decoration: none;
             padding: 10px 16px;
             border-radius: 8px;
             color: white !important;
             background-color: rgba(14, 165, 233);
             font-weight: 500;
         }
      </style>
   </head>
   <body style="word-break: break-word; -webkit-font-smoothing: antialiased; margin: 0; width: 100%; background-color: #f9fafb; padding: 0">
      <div style="display: none">
         To verify your email address, enter this code in the Macro app.
         &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847; &#847;
      </div>
      <div role="article" aria-roledescription="email" aria-label="Macro Access Code" lang="en">
         <table style="width: 100%; font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" cellpadding="0" cellspacing="0" role="presentation">
            <tr>
               <td align="center" style="background-color: #f9fafb">
                  <table style="width: 100%; max-width: 640px; padding-left: 16px; padding-right: 16px" cellpadding="0" cellspacing="0" role="presentation">
                     <tr>
                        <td class="xs-py-8 xs-px-6" style="padding: 56px; text-align: center">
                           <a href="https://macro.com">
                           <img src="https://coparse-release-artifact-storage-bucket.s3.amazonaws.com/logos/logo.png" width="200" alt="Macro" style="border: 0; max-width: 100%; vertical-align: middle">
                           </a>
                        </td>
                     </tr>
                     <tr>
                        <td align="center">
                           <table style="width: 100%" cellpadding="0" cellspacing="0" role="presentation">
                              <tr>
                                 <td class="xs-py-12 xs-px-6" style="border-radius: 8px; background-color: #fff; padding-top: 56px; padding-bottom: 56px; padding-left: 40px; padding-right: 40px; outline-style: solid; outline-width: 1px; outline-color: #f3f4f6">
                                    <h1 class="xs-text-3xl" style="margin-top: 0; margin-bottom: 16px; text-align: center; font-size: 36px; font-weight: 600; color: #374151">
                                       Welcome Aboard!
                                    </h1>
                                    <h2 class="xs-text-2xl" style="margin-top: 0; margin-bottom: 64px; text-align: center; font-size: 20px; font-weight: 300; color: #374151">
                                        You've been invited to join {ORG_NAME} on Macro.
                                    </h2>
                                    <p style="text-align: center;">
                                        <a class="CTA" href="https://{PREFIX}macro.com/app/?login=true">Accept Your Invitation</a>
                                    </p>
                                 </td>
                              </tr>
                           </table>
                        </td>
                     </tr>
                     <tr>
                        <td class="xs-py-10" style="padding-top: 48px; padding-bottom: 48px; text-align: center; font-size: 14px; color: #9ca3af">
                           <p style="margin: 0">
                              Questions? Email us at
                              <a href="mailto:support@macro.com" class="hover-text-gray-600" style="font-weight: 500; color: #6b7280">support@macro.com</a>
                           </p>
                        </td>
                     </tr>
                  </table>
               </td>
            </tr>
         </table>
      </div>
   </body>
</html>"#;

    let result = result.replace("{PREFIX}", prefix.as_str());
    result.replace("{ORG_NAME}", org_name)
}

/// Sends an invitation email to the user
#[tracing::instrument(skip(client))]
pub async fn invite_user(
    client: &ses::Client,
    org_name: &str,
    environment: &str,
    from_email: &str,
    to_email: &str,
) -> anyhow::Result<()> {
    let mut dest: Destination = Destination::builder().build();
    dest.to_addresses = Some(vec![to_email.to_string()]);

    let subject_content = Content::builder()
        .data(INVITE_USER_SUBJECT)
        .charset("UTF-8")
        .build()
        .context("building Content")?;

    let body_content = Content::builder()
        .data(build_user_invite_message(org_name, environment))
        .charset("UTF-8")
        .build()
        .context("building Content")?;

    let body = Body::builder().html(body_content).build();

    let msg = Message::builder()
        .subject(subject_content)
        .body(body)
        .build();

    let email_content = EmailContent::builder().simple(msg).build();

    client
        .send_email()
        .from_email_address(from_email)
        .destination(dest)
        .content(email_content)
        .send()
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {

    #[test]
    fn test_build_user_invite_message() {
        // let result = build_user_invite_message("prod");
        // let expected = "Visit <a href=\"https://macro.com/app?login=true\">Macro</a> to login";
        // assert!(result.contains(expected));
        //
        // let result = build_user_invite_message("staging");
        // let expected =
        //     "Visit <a href=\"https://staging.macro.com/app?login=true\">Macro</a> to login";
        // assert!(result.contains(expected));
        //
        // let result = build_user_invite_message("dev");
        // let expected = "Visit <a href=\"https://dev.macro.com/app?login=true\">Macro</a> to login";
        // assert!(result.contains(expected));
    }
}
