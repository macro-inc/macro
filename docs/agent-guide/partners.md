# Partners

## Partners — `/app/partners`

Macro staff (an email ending in `@macro.com`) and accepted partners open Partners
from **More → Partners** when `enable-partner-portal` is on. The flag is on in
local development and off in production until the remote flag exists. Partners
starts in More, including for people who already customized the sidebar.

Staff open Partners on a table of every partner: name, company, email,
status, referral count, and teammate. Opening a row shows that partner.
Staff can add a partner, accept or suspend them, mark a tax form
(W-9 or W-8), payment details, and directory listing, and accept or reject a
submitted referral. Recording a first-year revenue shows an estimated fee of 30%.
A referral whose email matches the partner is stored as ineligible. Each
accepted partner has one free second seat, and that person has to be on the
partner’s team. The list and the overview show who is on that seat, or that it
is open. **Add teammate** records that person in this browser only.

An accepted partner sees Partners only after staff has added them or accepted
them. The built-in sample does not open the page for those emails. Signed in
with that email, they see only their own page, not the list of other partners.
**View as partner** shows that same page: a pipeline of the
people they referred. Each card shows that person’s pricing tier (Free, Pro, or
Max) and, when they joined a team, the team name and how many members that team
has. **New** in the header adds a referral. **Edit** changes the stage, the team, and the tier, and can add a team.
**By team** groups the same people under those teams. Staff see a table on the
partner’s Referrals tab: name, company, email, pricing tier, stage, team, and
member count. **By team** breaks that table with a header for each team. Adding a referral does not reserve the account.
The partner can fill their second seat and can read payout rows. Payout amounts are a preview stored in
this browser under
`macro:partner-portal:v1`. They are not Stripe charges. **Restore sample partners**
replaces that browser copy with the built-in sample. Staff can choose
**View as partner** and return with **Back to partner list**.

Someone who is neither staff nor an accepted partner is sent Home. With the
flag off, `/app/partners` also goes Home.

On a phone the list and the detail stack. Open a partner to fill the page, then
**Back** returns to the list.
