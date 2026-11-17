# Artifacts

An artifact is an HTML page (plus its CSS, scripts, images and fonts) that an
agent published as a Macro item, with versions and optional named scenes. It is
a document with file type `artifact`, so Drive, Recent, search, sharing,
mentions and discussions treat it like any other document. There is no create
button in the app: agents create and republish artifacts through the SDK
(`macro.artifacts.create`, `artifact.publish`) or macrod's `PublishArtifact`
tool.

## Opening one

- Route: `/app/artifact/<id>`. Add `?scene=<scene id>` to open a scene; on
  entry it moves into the pane's search (`s<pane>.artifact.scene=`). An
  unknown scene falls back to the artifact's own page (`index.html`).
- The page renders in a sandboxed iframe (`[data-artifact-frame]`) on the
  artifact's own origin (`https://<id>.artifacts.<domain>`), never on the app
  origin. Its content is not part of the app's DOM: read it through the
  frame's own target (chrome-devtools `list_pages` / `select_page` lists the
  frame), not through the app page's snapshot.
- Opening a link straight on the artifact origin in a tab returns 403: pages
  only load inside Macro. The frame URL carries a short-lived token; never
  copy it into reports.
- Opening an existing artifact never depends on the `enable-artifacts` flag.
- An artifact created without a version yet shows **Nothing published yet**
  (in the block and in canvas embeds) until its first publish arrives.

## The view

- **Header:** the name, **Published by <name>** (**Published by <agent> for
  <name>** when an agent published it), and for a viewer outside
  the owner's team a **User-generated content** chip (its tooltip warns
  against entering private information). Share and the title menu (Rename,
  Move, Delete) work as for documents; artifacts can't be duplicated.
- **Scenes:** tabs under the header (Overview plus one per scene), or a menu
  when there are more than six. Choosing one updates
  `s<pane>.artifact.scene=`; copying the link from Share gives the plain
  `?scene=` form. On phones and tablets the tabs move into the title menu's
  **Scenes** group.
- **Versions:** the **Version N** button in the header (on touch,
  **Versions** in the title menu) lists every version with its message,
  author and time. Choosing an older one shows a banner, *You're viewing version N*, with **Back to
  latest** and, for editors, **Restore**, which publishes that version again
  as a new current version.
- The view follows the current version: when an agent republishes, open
  views and canvas embeds reload with the new version. Theme changes are
  posted to the page (`{type: 'macro-artifact:theme', theme}`); pages read
  `?theme=` on load.

## On a canvas

With `enable-artifacts` on, artifacts appear in the canvas **Reference**
picker (press `I`, then Reference). Choosing one with scenes asks for a scene
(or Overview); one without scenes is placed right away. It lands as a live
embed, 960 × 600, inert until **Interact** (or a double-click); **Done** or
Escape returns input to the canvas. The inspector's scene menu switches the
node's scene, **Use preview card** turns it into a card that names the scene
(**Show page** turns it back into an embed), and **Open document** opens the artifact at that scene. Pasting an
`/app/artifact/<id>?scene=<scene>` link or dropping the artifact from Drive
places it too. Viewers of a canvas see artifact embeds live and can Interact
with them.

## Verifying

Publish a two-scene artifact with the SDK against your local stack, open it,
switch scenes and check `s0.artifact.scene=` changes, republish from the SDK and watch
the open view reload, then restore version 1 as an editor and confirm a new
version 3 appears in the menu.
