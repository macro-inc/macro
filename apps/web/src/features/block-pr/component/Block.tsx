import { useBlockId } from '@core/block';
import { PrDetail } from '../views/PrDetail';

/** Legacy block boundary for previews until the block runtime is retired. */
export default function PrBlock() {
  return <PrDetail foreignEntityId={useBlockId()} />;
}
