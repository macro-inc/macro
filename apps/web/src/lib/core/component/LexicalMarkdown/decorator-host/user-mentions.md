# Native user mention binding

The runtime slice is UserMention.tsx plus user-mention-host.ts,
native-user-mention-host.ts and native-user-mention-views.ts. The component
requests only published selection and display-name updates. Without a provider
it keeps the actual Lexical wrapper host; a supplied incomplete host fails.
Public lexical-core node props remain unchanged. The actual UI input preserves
Source-admitted missing/null identity fields and nullable mention UUIDs.

Create createNativeUserMentionContext(theme) once for the mounted native view,
then register createNativeUserMentionViews(context) through
registerMacroDecoratorViews. Call context.dispose() before retiring that view.
The context rejects another view/generation; recreate it for a new generation.
The adapter obtains the actual initialized UserMentionNode registry component.
The normal application initializeLexical() call already supplies that registry;
do not clear/reinitialize it during a mount. No JavaScript model node is created.

This slice depends on native-adapter.ts with the uncached closure correction,
native-selection-host.ts, and the actual current-authority
SessionPort.inputIfSessionEdit/application command helper. Its native action is
group-b.user-display-names from the existing decorator action producer, and its
permission fact is actual EditorSession.effectiveAccess() in the serialized
admission. Keep the integration's newer executor/Port/namespace changes; do not
copy old whole files. Integrations with ordered native callbacks must retain
the before-queue module admission guard on inputIfSessionEdit as well as input;
this helper does not grant scoped callback authority. Local UI editability does
not grant session authority.

The UI uses committed selection through the existing onCommit subscription.
Display-name updates use the shared native traversal, tags and validation.
Current SessionRead/Comment authority emits no derived document update; Edit
can normalize a name while the local UI lock is on. Disposal and a retired
key generation suppress later host updates. The shared adapter recreates the
uncached Source component on actual view-node publication while retaining its
provider and Portal; native render revision retention remains authoritative.

## Evidence and limits

mention-browser-test owns a real Source wrapper/renderer/providers plus a real
production local SessionExecutor, SessionPort and EditorView. It imports the
identical saved Source JSON on fresh Source/native surfaces. The separate fresh
Source before/after cohort remains byte-compared to its original captures.
The initial fresh-creation versus native-import metadata mismatch is retained;
it is not normalized into equality.

Each Source execution verifies both actual app Vite cache maps against pristine
Lexical/code-core sources and binds their real HTTP script responses. The114
package files are additionally verified against the restoration receipt; the
per-execution cache and HTTP proof establishes the loaded runtime. The fixture refuses
all five artifact files unless they match the sealed private Root-order0da pair.
That artifact is component evidence only, not the next application candidate.

The controls cover actual hover-card opening/closing, native selection/clearing,
name updates under UI lock, real authorization downgrade/regrant, disposed host
updates, literal model/DOM and actual component replacement/Portal retention.
Missing/null IDs and emails and a null UUID use actual Source parse/import.
The component lifetime failure is retained alongside the corrected result.

These checks do not establish user-search insertion, tracking/provider service
success, navigation, physical touch behavior, image/media IO, Contact Enter,
full30 registration or installation. The supplied HTTP boundary denies backend
requests consistently; no editor, model, component or host capability is faked.
Root owns the next coherent application artifact/build and its install gates.
