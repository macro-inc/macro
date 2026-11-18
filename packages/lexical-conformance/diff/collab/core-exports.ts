// Narrow entry point to today's implementations; no replacement algorithms.

export {
  COLLAB_SELECTION_TAG,
  COLLABORATION_TAG,
} from '../../../lexical-core/constants';
export {
  $liftDraftCommentMarks,
  $restoreDraftCommentMarks,
  stripDraftCommentMarks,
} from '../../../lexical-core/nodes/CommentNode';
export { isSerializedImageNode } from '../../../lexical-core/nodes/ImageNode';
export { isSerializedVideoNode } from '../../../lexical-core/nodes/VideoNode';
export {
  $getNodeById,
  $updateAllNodeIds,
  type NodeIdMappings,
} from '../../../lexical-core/plugins/nodeIdPlugin';
export {
  $getPeerId,
  $setLocal,
} from '../../../lexical-core/plugins/peerIdPlugin';
