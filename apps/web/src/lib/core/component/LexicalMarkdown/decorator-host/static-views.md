# Static decorator rows

`createNativeFastStaticDecoratorViews` projects six initialized application
components through the shared adapter: Watermark, Await, AgentContext,
ReplyTarget, AccountManagerRequest and CursorSystemNotification. It uses the
original components and their real providers, without constructing model nodes
or introducing editor capabilities they do not consume. Notification attribute
order and own keys are retained, including keys such as `__proto__`.

The selection-browser-test fixture also owns these six rows. Its static control
compares fresh Source DOM and JSON literally with immutable pre-binding captures,
then imports the same saved Source model before the Source and native first
decorator observation. Both mounted outputs must match without normalization in
Chromium, Firefox and WebKit. The native fixture checks all five files of the
existing sealed c9 component artifact before collection; this batch does not
build, replace or promote that artifact.

Reply button clicks exercise the existing MessageReferenceNavigation surface
callback with the real component props, once per mount, and leave the model and
DOM unchanged. This is dispatch-boundary evidence, not application route
integration. Account-request captures cover the actual denied-request state;
that state exposes no actions. The notification fixture is a static event with
no external link. Await covers the default local class, not a native state-only
local=false transition.

HTML-render is deliberately absent from this table while its Chrome literal
attribute-order comparison remains open. Cached Magic/Agent observation and
Contact's native Normal Enter slot remain separate gates. This table alone is
not a complete application decorator installation.
