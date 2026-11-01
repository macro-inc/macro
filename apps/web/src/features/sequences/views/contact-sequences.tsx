import { fireAndForget } from '@core/util/fireAndForget';
import { ContactSequences } from '../components/contact-sequences';
import { useSequences } from '../context/sequences-context';

export function ContactSequencesView(props: {
  contactId: string;
  onOpenSequence: (sequenceId: string) => void;
}) {
  const context = useSequences();
  const source = context.createContactEnrollments(() => props.contactId);
  return (
    <ContactSequences
      enrollments={source.enrollments()}
      failed={source.failed()}
      ownerName={context.userName}
      onRetry={() => fireAndForget(source.refresh(), 'sequences.contact')}
      onOpenSequence={props.onOpenSequence}
    />
  );
}
