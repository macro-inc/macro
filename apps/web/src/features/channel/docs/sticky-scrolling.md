# Sticky Scrolling

"Sticky Scrolling" in channels is a mechanism that should keep the content relating to the bottom-most (no remaining pagination) of a channel in view.

The following are cases where sticky scrolling should be applied.

1. I am at the bottom of a channel (approximately) within some threshold. I receive a new message, either from myself or from another user, that message should be in view. To accomplish this we need to scroll down to the newest message.
2. I am at the bottom of a channel, I or anyone else in the channel react to the latest message, I should be scrolled slightly so that reaction is in view.
3. I am at the bottom of a channel, I hit "reply" on the latest message. The entirety of the reply input box should be visible to me.
