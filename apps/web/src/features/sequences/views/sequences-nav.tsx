import { SequencesNav } from '../components/sequences-nav';
import { useSequences } from '../context/sequences-context';
import { needsAttentionTotal } from '../core/sequence';

export function SequencesNavView(props: {
  active: boolean;
  onSelect: () => void;
}) {
  const list = useSequences().createSequenceList();
  return (
    <SequencesNav
      active={props.active}
      attention={needsAttentionTotal(list.sequences())}
      onSelect={props.onSelect}
    />
  );
}
