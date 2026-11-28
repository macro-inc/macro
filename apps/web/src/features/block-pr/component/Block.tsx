import { useBlockId } from '@core/block';
import { PrPage } from '../pr-page';

/** Legacy block host uses the same PR page as both routed hosts. */
export default function PrBlock() {
  const foreignEntityId = useBlockId();
  return <PrPage foreignEntityId={foreignEntityId} />;
}
