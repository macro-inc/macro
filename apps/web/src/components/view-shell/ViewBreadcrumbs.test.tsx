import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import {
  createContext,
  createSignal,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewBreadcrumbs } from './ViewBreadcrumbs';

vi.mock('@ui', async () => ({
  ...(await import('../ui/utils/classname')),
}));

afterEach(cleanup);

describe('breadcrumb outlet transitions', () => {
  it.each(['My Files', 'Financial Models'])(
    'keeps %s visible and clickable when the previous header unmounts',
    (label) => {
      const onChange = vi.fn();
      const [oldHeader, setOldHeader] = createSignal(true);
      const [preview, setPreview] = createSignal(false);
      const Label = createContext('Missing location');

      const disposed = vi.fn();
      function Location(props: { onSelect: () => void }) {
        const name = useContext(Label);
        onCleanup(disposed);
        return <button onClick={props.onSelect}>{name}</button>;
      }

      render(() => (
        <ViewBreadcrumbs.Root value="sheet" onChange={onChange}>
          <Label.Provider value={label}>
            <ViewBreadcrumbs.Item value="location" metadata={{}}>
              {(item) => <Location onSelect={item.onSelect} />}
            </ViewBreadcrumbs.Item>
          </Label.Provider>
          <Show when={oldHeader()}>
            <ViewBreadcrumbs.Outlet aria-label="List location" />
          </Show>
          <Show when={preview()}>
            <ViewBreadcrumbs.Outlet aria-label="Sheet location" />
          </Show>
        </ViewBreadcrumbs.Root>
      ));

      // The preview mounts while the outgoing list header still exists.
      setPreview(true);
      expect(
        within(
          screen.getByRole('navigation', { name: 'List location' })
        ).getByRole('button', { name: label })
      ).toBeTruthy();
      setOldHeader(false);
      const location = () =>
        within(
          screen.getByRole('navigation', { name: 'Sheet location' })
        ).getByRole('button', { name: label });
      fireEvent.click(location());
      expect(onChange).toHaveBeenCalledWith('location');
      expect(disposed).toHaveBeenCalledTimes(1);

      // Reopening the sheet creates a new header with the same registration.
      setPreview(false);
      expect(disposed).toHaveBeenCalledTimes(2);
      setPreview(true);
      expect(location()).toBeTruthy();
    }
  );
});
