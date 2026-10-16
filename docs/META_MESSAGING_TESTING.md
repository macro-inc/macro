# Your first real WhatsApp and Instagram test

Use Meta’s WhatsApp test number and accounts you control. Synthetic fixture
conversations are not evidence of real delivery.

## 1. Get the Meta accounts ready

Open [Meta’s app dashboard](https://developers.facebook.com/apps/), create or use
the business app for this integration, and add the WhatsApp and Instagram use
cases. Dashboard labels vary: WhatsApp testing may appear under **API Setup**,
**Getting Started**, or **Use cases → Test**.

For **WhatsApp**, use the provided test phone number. Add your own WhatsApp number
as a recipient and complete its verification. Generate a fresh testing access
token and record the app ID, WhatsApp Business Account ID and Phone Number ID.
First use Meta’s sample test message and confirm it arrives on your phone.
The dashboard token is short-lived; refresh it if a later test loses access.
Meta’s [Cloud API reference](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api)
and [official quickstart](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/) describe
these test resources and sending the sample message. We use the existing Rust
adapter; you do not need to install the archived Node SDK.

For **Instagram**, choose **API setup with Instagram Login** and use a Business
or Creator account you control. This flow does not require a linked Facebook
Page. The scopes Macro requests are `instagram_business_basic` and
`instagram_business_manage_messages`. The customer must message the professional
account before Macro can reply. Use another account you control as that customer.
See [Meta’s Instagram Login and Send API reference](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00).

Add the applicable accounts under **App Roles → Instagram Testers**, accept the
invitations, and grant the requested messaging access. Confirm message access for
connected tools is enabled in the professional account’s Instagram settings.
[AWS’s working setup guide](https://github.com/aws-samples/sample-amazon-connect-social-integration/blob/main/instagram_setup.md#62-testing-in-development-mode)
also walks through tester invitations; use Meta’s reference above for the current
account types and scopes.

## 2. Wire those accounts to this Macro instance

Keep tokens and app secrets in a local private file, not chat. The implementation
and exact variable names are in [the server setup guide](META_MESSAGING.md#server-configuration).
The identifiers alone are not sufficient: we also need the matching app secrets,
the WhatsApp test token and the verified recipient number.

Before live testing, the local instance needs:

| Item | Exact value or requirement |
| --- | --- |
| WhatsApp webhook | `<public-origin>/dss/meta/webhooks/whatsapp` |
| Instagram webhook | `<public-origin>/dss/meta/webhooks/instagram` |
| Instagram OAuth redirect | `<Macro-web-origin>/app/instagram-callback.html` — same origin as Settings, identical in Meta and `META_INSTAGRAM_REDIRECT_URI` |
| Verification tokens | Separate secrets chosen for each webhook, matching Macro’s configuration |
| Credential encryption | Local KMS alias provisioned and `META_CREDENTIAL_KMS_KEY` set; instructions in the server guide |
| WhatsApp recipient | The verified test number also listed in `META_WHATSAPP_TEST_RECIPIENTS` |

Meta cannot call `localhost`. Provide a public HTTPS callback gateway forwarding
only the webhook paths to this local instance. Instagram OAuth returns in the
user’s browser to the trusted HTTPS Macro web origin, not the webhook gateway. Do not expose
the passwordless local app or its databases. Keep callback origins in local configuration. Instagram attachment testing additionally needs publicly reachable,
short-lived attachment URLs; prove the text flow first.

After server configuration, open **Macro → Settings → Integrations → Accounts**:

- WhatsApp: open **Connect** or **Manage**, then **Connect test number**. The regular
  WhatsApp connection uses production Embedded Signup and checks coexistence
  eligibility; the test button is the intended local developer path.
- Instagram: open **Connect** or **Manage**, choose **Connect account** or
  **Add account**, and authorize the professional account in the Instagram window.
  Return to Settings and wait for **Connected**.

Meta’s webhook verification and the account’s messaging subscription must both
be active. Macro subscribes the connected account as part of connection. The
dashboard verification check or a synthetic webhook test alone does not prove
that real customer messages will be forwarded.

Before the phone test, check the published/unpublished notice on each product’s
Webhooks page. If it requires publication for real inbound events, complete those
requirements using the app’s actual privacy/data-deletion information. Meta app
publication, Advanced Access review, and deploying Macro are separate operations.

## What appears after connection

Connecting does not populate the entire existing inbox. The next live customer
message or business phone-app echo creates/reuses that customer's native channel.
Without explicit import consent, onboarding-history webhooks are ignored, including
after reconnect/restart. In **Settings → Integrations → Accounts → Manage**, each
account has an **Import history** action. Open it to inspect limits and availability;
only **Import available history** starts the job. This imports all API-visible
conversations into native channels; there is no individual picker or export upload.

For WhatsApp, use an eligible coexistence Business-app number, enable history
sharing on the phone during setup, subscribe `history` and `smb_app_state_sync`,
and start within 24 hours. Keep WhatsApp Business open. Expect up to six months of
text but only 14 days of media; the developer test number cannot prove this flow.
An uncertain one-time request must not be blindly repeated. Meta may require the
business to disconnect Business Platform on the phone and complete setup again.

For Instagram, approve the two existing messaging scopes and ensure the app has
API access. Only the most recent 20 messages per conversation are retrievable;
Requests inactive over 30 days are absent. A working OAuth login alone does not
establish Conversations API access. If the API reports access blocked, resolve
any developer-account confirmation in Meta’s dashboard, then retry the import.
Check Spam if a required confirmation email does not arrive.

Meta's current WhatsApp setup navigation is **Use cases → WhatsApp → Basic setup →
Step 1. Try it out** (older dashboards label this **API Setup**). Generate a fresh
short-lived test token there when it expires, update the ignored local environment,
recreate DSS, then use Reconnect on the configured test account in Macro. This
keeps the same channel and customer mapping. Production uses the approved business
onboarding flow rather than this developer-only token path.

Verify: without clicking import, old messages create no channels; after clicking,
history appears in the same private channels with original authors/times. Rename a
channel and receive a new live message: it reuses that channel and retains the name.
History alone must not enable free-form sending. Replay history, restart a worker,
and revoke account/admin access. No duplicate chats, external sends, or unauthorized
attachment access should result. Progress must settle or expose a recovery message.

## 3. Do this on your phone and in Macro

Keep the local stack, frontend and callback gateway running. In Settings, confirm
both accounts are Connected and credentials have not expired. Use a fresh customer
message to establish a reply window. Start with text; Instagram outbound media
also requires the signed public attachment URLs described above.

1. From your verified personal WhatsApp number, send “Hi Macro” to Meta’s test
   number. From your second Instagram account, DM the connected professional
   account. Accept a message request in Instagram if needed.
2. In Macro, open the new customer channel. Check the customer and account label.
3. Verify that the customer conversation has one reply box and no internal-note
   switch. The provider logo opens the customer and connected-account details.
4. Write a reply and click the send arrow. Confirm the text actually arrives in
   the original app. Pending or failed sends show feedback beside their message.
5. Confirm successful replies have no visible read/delivery badges. Delivery
   events are retained on the server for recovery and verification, and provider
   acceptance alone is not proof of customer delivery.
6. Test a small PNG/PDF after text works. Check that an invited teammate can use
   the channel and an uninvited teammate cannot access the channel or its files.
7. Disconnect/reconnect the test account and repeat. A failed message should show
   an explanation beside it. **Edit and retry** restores the customer draft; it never sends
   automatically. For **Delivery not confirmed**, check the phone before resending.

## Troubleshooting

- **WhatsApp accepts a reply but nothing arrives:** inspect its status webhook
  and confirm receipt on the phone; an API message ID is not a delivery receipt.
- **Test number missing or recipient error 131030:** verify the app/WABA, token
  and verified recipient list before debugging Macro’s send path.
- **Synthetic Instagram events arrive but real DMs do not:** check tester roles,
  permissions, account subscriptions, message requests and the Webhooks page’s
  publication notice. App publication and Advanced Access review are separate.
- **Events stop arriving:** keep the local stack and callback gateway running.
  If the public hostname changes, update Meta’s callbacks and local configuration.

Do not mix Instagram Login with older Facebook Login / Page-token instructions.
Test WhatsApp coexistence separately with an eligible Business-app number through
Embedded Signup; test-number delivery does not prove phone-app synchronization.
For other businesses, complete the [production rollout requirements](META_MESSAGING.md#production-rollout-gates).

## Account lifecycle regressions

The `native_messaging::native::test::http::lifecycle` tests cover two phone
connections sharing a WABA across separate Macro teams. Disconnecting one must
retain the other; disconnecting the last removes the provider subscription. A new
connection must not subscribe before an in-flight removal finishes. Late cleanup
after a subscription request must retain a sibling's subscription. Instagram
subscriptions remain scoped to the individual professional account.

Health tests exercise the real service and API response for authorization expiry,
Meta access denial, Macro administrator removal, temporary errors, setup errors
and successful recovery. In the browser, check the message both in Settings and
above the customer composer, with the draft preserved and sending disabled.

## Verify Instagram login isolation

1. Keep the initiating Settings window open, allow its popup, and connect through
   the real Meta test app. Confirm the expected team’s account ID and actual
   connection state. The callback URL must lose its query/fragment immediately.
2. In a separate controlled browser session, open the authorization URL initiated
   in session A. Session B must not complete A’s connection. Inspect the isolated
   DB/provider counters as well as the UI: no credential, subscription, import or
   conversation may be created for A. Repeat with a different authenticated Macro
   user/team when one is available; record unavailable branches explicitly.
3. Reconnect the same account and verify the connection ID and conversations stay
   unchanged. Selecting another Instagram account must fail. Cancel once; let an
   attempt expire or expire only a disposable local transaction; replay a handled
   callback. Settings must offer a clear retry, with no second connection.
4. Distinguish HTTP/database fixture tests from live Meta authorization and from
   actual customer message delivery. Never describe simulated transport as live.

The old public DSS OAuth completion path must return 404 on the fixed backend.
Do not test live login against an older running DSS binary. Update only the
existing test app’s redirect allowlist after confirming the new callback is
served; preserve working webhook callbacks and unrelated applications.
