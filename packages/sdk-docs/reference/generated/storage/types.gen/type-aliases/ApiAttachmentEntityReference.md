# Type Alias: ApiAttachmentEntityReference

> **ApiAttachmentEntityReference** = [`ApiAttachmentChannelReference`](ApiAttachmentChannelReference.md) & \{ `reference_type`: `"channel"`; \} \| [`ApiAttachmentCommentReference`](ApiAttachmentCommentReference.md) & \{ `reference_type`: `"comment"`; \} \| [`ApiAttachmentGenericReference`](ApiAttachmentGenericReference.md) & \{ `reference_type`: `"generic"`; \}

An attachment reference, tagged by source kind.
