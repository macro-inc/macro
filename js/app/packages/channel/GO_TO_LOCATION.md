Go to specific location in a channel.

There are frequent use cases for us to jump / scroll to a specific message and thread in a channel.

Channel fetches top level messages in `channel-messages` query, and then each top-level message fetches its corresponding thread replies on mount.


A target message should include both a top level message id, and then the thread message id. We should always scroll to the top level message id, then let the actual thread handle selecting the corresponding reply inside of the thread.

The paginated channel-messages query has an optional `load_around_message_id` query parameter. When passed it will fetch 1/2 page up and down around a specific message.

When going to a target message we should generally follow the following steps.


1. First check if we already have the message fetched in our flattened list of messages. If so we should just directly scroll to that message.
2. If we do not, we should reset the query completely and fetch the specific page by setting load_around_message_id. Then trigger a scroll once that query has setttled.


To start lets start with the basics we should scroll to a specific top level message. I don't want you to worry about scrolling to a specific thread reply yet.

When we set a targetMessageId we should highlight, simmilar to how the `targetMessage` already works on mount.


The difference between what we have and what I want is that currently we only handle this onMount, and onMount we don't need to check if we already have the message because we just default to fetching it from load_around_message_id.


I want you to make sure this logic is mostly composable. You should likely create something like a `createTargetMessageController` which wraps a signal and runs the correct odrder of events when neccesary. 



