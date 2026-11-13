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
| `agent-dashboard` | `/app/agent-accounts/:userId` | The account's picture, name and Agent tag, a Dashboard tab, and its home dashboard (`GET /dashboards/home/{userId}`) |
| `dashboard` | `/app/dashboard/:dashboardId` | Any dashboard by id (`GET /dashboards/{id}`) |

`:userId` is the account's Macro id (`macro|agent@example.com`, URL-encoded).
Both routes are open to agents (`macro.ui.open`): viewing changes nothing.
With the flag off they redirect to Home.

The dashboard renders full width with the dynamic-ui renderer, read-only. Each
widget fetches as the viewer, so a pane shows only what the viewer can read.
States: a loading skeleton; **No dashboard yet** when the account has none
(the home route also answers 404 when the viewer can't see it, so that reads
the same); **No access** for a dashboard opened by id that the viewer can't
read; an error with **Try again**. A pane that fails to render says so in place
and leaves the others.

On touch devices the page uses the mobile header (Back and the agent's name)
and one column: the renderer stacks rows below its container breakpoint.

## Entry points

- A direct message with an agent account has a **Dashboard** action in its
  header. It opens the agent page in a new pane (in front, on phones).
- The Agents view lists agent personas (bots), not agent accounts, so it has
  no dashboard entry yet.

## Traces

The page load is the routed `view.agent-dashboard` (or `view.dashboard`) flow,
with a `dashboard.load` phase for the dashboard request and one
`dashboard.pane` child flow per top-level pane (`dashboard.pane.index`,
`dashboard.pane.type`, and `dashboard.pane.id` when set; never content).
