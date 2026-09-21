import type { JSX } from 'solid-js';
import { CalendarCallDetails } from '../components/calendar-call-details';
import type { CallAvatarRenderer } from '../components/calendar-person-avatar';
import type {
  CalendarCallsActions,
  CalendarCallsSource,
} from '../context/calendar-calls';
import {
  type CalendarCallItem,
  calendarCallCanJoin,
} from '../core/calendar-calls';
import { createCalendarCalls } from '../primitives/calendar-calls';

export function CalendarCallDetailsView(props: {
  item: CalendarCallItem;
  source: CalendarCallsSource;
  actions: CalendarCallsActions;
  onClose: () => void;
  renderAvatar?: CallAvatarRenderer;
  renderInvite?: (item: CalendarCallItem) => JSX.Element;
}) {
  const state = createCalendarCalls(props.source, props.actions);
  state.select(props.item);
  const item = () => state.selected() ?? props.item;
  const closeAnd = (action: () => void) => {
    props.onClose();
    action();
  };
  return (
    <CalendarCallDetails
      item={item()}
      canJoin={calendarCallCanJoin(item(), state.now())}
      renderAvatar={props.renderAvatar}
      invite={props.renderInvite?.(item())}
      pending={state.pending()}
      error={state.error()}
      copied={
        Boolean(state.url(item())) && state.copiedUrl() === state.url(item())
      }
      url={state.url(item())}
      editing={state.editing()}
      title={state.title()}
      confirmRevoke={state.confirmRevoke()}
      onBack={props.onClose}
      onJoin={() => void state.join(item())}
      onCopy={() => void state.share(item())}
      onOpenRecord={() =>
        closeAnd(() => {
          if (item().record) props.actions.openRecord(item().record!.id);
        })
      }
      onOpenEvent={
        item().event && props.actions.openEvent
          ? () => closeAnd(() => props.actions.openEvent!(item().event!))
          : undefined
      }
      onEditEvent={
        item().event?.canEdit !== false &&
        item().event &&
        props.actions.editEvent
          ? () => closeAnd(() => props.actions.editEvent!(item().event!))
          : undefined
      }
      onRename={state.startEditing}
      onTitle={state.setTitle}
      onSave={() => void state.save()}
      onCancelEdit={state.cancelEditing}
      onRequestRevoke={state.setConfirmRevoke}
      onRevoke={async () => {
        await state.revoke();
        if (!state.detailsOpen()) props.onClose();
      }}
    />
  );
}
