# Agent dashboards

A dashboard is a saved, versioned dynamic-UI `View` (`crates/dynamic_ui`) that
an agent account composes for itself. People only view dashboards; agents
create and change them through the SDK. The `enable-agent-dashboards` flag
gates the web routes and entry points, and the storage service's
`/dashboards` routes answer 404 without it.

## How a dashboard gets there

An agent account, with its SDK token:

```ts
const dashboard = await macro.dashboards.create(view);
await macro.me.setHomeDashboard(dashboard);
```

`view` is the same schema `execution.views.present` takes. Give top-level
widgets a stable `id` to patch one pane later. The server validates every save
with `decode_view` and keeps each version.

## Routes

| Route | Path | Shows |
| --- | --- | --- |
| `agent-dashboard` | `/app/agent-accounts/:userId` | The agent's profile: its picture, name and Agent tag, the Dashboard tab (first, and the default), and its home dashboard (`GET /dashboards/home/{userId}`) |
| `dashboard` | `/app/dashboard/:dashboardId` | Any dashboard by id (`GET /dashboards/{id}`) |

`:userId` is the account's Macro id (`macro|agent@example.com`, URL-encoded).
Both routes are open to agents (`macro.ui.open`): viewing changes nothing.
With the flag off they redirect to Home.

The dashboard renders full width with the dynamic-ui renderer, read-only. Each
widget fetches as the viewer, so a pane shows only what the viewer can read.
The panes sit in an `AgentScope` (`dynamic-ui/widgets/panes/agent-scope.tsx`)
holding the dashboard's owner, the agent an agent pane shows when it names none.
States: a loading skeleton; **No dashboard yet** when the account has none
(the home route also answers 404 when the viewer can't see it, so that reads
the same); **No access** for a dashboard opened by id that the viewer can't
read; an error with **Try again**. A pane that fails to render says so in place
and leaves the others.

On touch devices the page uses the mobile header (Back and the agent's name)
and one column: the renderer stacks rows below its container breakpoint.

## Entry points

An agent teammate's profile opens wherever you click the agent, with the flag
on. Each opens it in a new pane (in front, on phones):

- its picture anywhere it shows (channel messages, Settings → Team): on press,
  where a person's opens the DM, so a row the picture sits in still acts; on
  touch, the tap that opens a person's card;
- its name beside its channel messages, which for a person stays plain text;
- an `@mention` of it in a message, which for a person only shows the user card
  on hover (an editable editor keeps the click for placing the caret);
- its row in a channel's member list, which for a person opens the DM;
- **Open profile**, the first action of its hover card (and of the touch sheet
  where one still opens);
- the **Dashboard** action in the header of a direct message with it.

People, and every surface with the flag off, keep their usual behavior.
`useAgentProfile` (`features/agent-dashboards/agent-profile.ts`) decides
(`profileOf`) and opens; `UserCardTrigger` takes a `profileSurface` to route a
click on an agent. The Agents view lists agent personas (bots), not agent
accounts, so it has no entry yet.

## Traces

A click that opens a profile starts the `agent_profile.open` interaction
(`agent_profile.surface`: `avatar`, `sender-name`, `mention`, `member-list`,
`user-card` or `dm-header`), which the routed view joins. The page load is the
routed `view.agent-dashboard` (or `view.dashboard`) flow,
with a `dashboard.load` phase for the dashboard request and one
`dashboard.pane` child flow per top-level pane (`dashboard.pane.index`,
`dashboard.pane.type`, and `dashboard.pane.id` when set; never content).
