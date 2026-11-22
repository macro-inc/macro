# Cached decorator rows

`createNativeFastCachedDecoratorViews` supplies MagicChip and AgentActivity
rows to the shared adapter. It obtains the initialized application components,
projects actual props, and does not construct model nodes. AgentActivity spreads
the original ordered props, retaining extra fields. Magic preserves an omitted
channel, null channel, missing prompted message, and the array messages admitted by Source import; its
actual UI input type includes those cases without changing public node props.
Missing prompted messages remain an own undefined property in projected props
and are omitted by JSON serialization; explicit null stays null. The regression
parses real Source nodes and projects their exported data, without a fabricated
view node, editor host or native acknowledgement.

The optional Magic host supplies document kind, editability and node selection.
Without it the component uses its existing Lexical wrapper. The native context
requires explicit surface document kind, binds one acknowledged view generation,
and uses the real root editability and `selectionFromView` port. It rejects
missing, stale or disposed node targets and releases its selection subscription
on disposal. It supplies no unrelated decorator capabilities.

The Source-only Magic fixture compares both ordinary and array/null-channel
captures across Chromium, Firefox and WebKit in the same denied-session
scenario. These OFF DOM and JSON bytes must remain identical when the optional
host is absent. Native selection, ordered-signature observation and remount
acceptance require the separate real native consumer proof. The leaf does not
install the rows in the application registry.
