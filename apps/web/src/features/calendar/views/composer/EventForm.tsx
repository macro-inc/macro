import { cn } from '@ui';
import { EventFormParts } from '../../components/composer/event-form-parts';
import {
  createEventForm,
  type EventFormProps,
} from '../../components/composer/event-form-state';
import { DesktopEventForm } from './DesktopEventForm';

/** Compose the desktop editor around the existing shared form controller. */
export function EventForm(props: EventFormProps) {
  const form = createEventForm(props);
  return (
    <EventFormParts.Root form={form} class={cn('gap-0', props.class)}>
      <DesktopEventForm />
    </EventFormParts.Root>
  );
}
