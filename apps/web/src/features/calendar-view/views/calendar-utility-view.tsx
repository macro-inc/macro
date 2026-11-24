import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import { CalendarViewContextProvider } from '@app/features/calendar/components/CalendarViewContext';
import { useNavigate, usePaneHistory } from '@app/lib/split-router';
import { calendarSplitRoute } from '@app/routes/routes';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { type JSX, Show } from 'solid-js';
import { CalendarFocusContextProvider } from '../calendar-focus-target';

/** Shared navigation and source ownership for the calendar utility pages. */
export function CalendarUtilityView(props: {
  title: string;
  desktop: JSX.Element;
  children: (back: () => void) => JSX.Element;
}) {
  useViewRestoration();
  useSplitDisplayName(() => props.title);
  const navigate = useNavigate();
  const history = usePaneHistory();
  const back = () => {
    if ((history()?.index ?? 0) > 0) {
      fireAndForget(navigate(-1), 'calendar-utility-back');
      return;
    }
    fireAndForget(
      navigate({
        route: calendarSplitRoute,
        params: { period: getPreferredCalendarPeriodView() },
      }),
      'calendar-utility-back'
    );
  };
  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <Show when={isTouchDevice()} fallback={props.desktop}>
          <CalendarFocusContextProvider>
            <CalendarViewContextProvider>
              {props.children(back)}
            </CalendarViewContextProvider>
          </CalendarFocusContextProvider>
        </Show>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
