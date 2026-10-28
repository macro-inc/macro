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
  type JSX,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewBreadcrumbs } from './ViewBreadcrumbs';

vi.mock('@ui', async () => ({
  ...(await import('../ui/utils/classname')),
  Tooltip: (props: { class?: string; children?: JSX.Element }) => (
    <div data-testid="breadcrumb-tooltip" class={props.class}>
      {props.children}
    </div>
  ),
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

describe('breadcrumb tooltip sizing', () => {
  it('keeps a return crumb from collapsing over the next item', () => {
    render(() => (
      <ViewBreadcrumbs.Root value="pr:1" onChange={() => {}}>
        <ViewBreadcrumbs.Item value="reviews" order={0} metadata={{}}>
          <ViewBreadcrumbs.ReturnButton tooltip="Involving me">
            Involving me
          </ViewBreadcrumbs.ReturnButton>
        </ViewBreadcrumbs.Item>
        <ViewBreadcrumbs.Item value="pr:1" order={1} metadata={{}}>
          <ViewBreadcrumbs.Button isActive tooltip="feat(agents): MCP">
            feat(agents): MCP
          </ViewBreadcrumbs.Button>
        </ViewBreadcrumbs.Item>
        <ViewBreadcrumbs.Outlet aria-label="Pull request location" />
      </ViewBreadcrumbs.Root>
    ));

    const [returnCrumb, titleCrumb] =
      screen.getAllByTestId('breadcrumb-tooltip');
    expect(returnCrumb?.className).toContain('shrink-0');
    expect(titleCrumb?.className).toContain('shrink');
    expect(titleCrumb?.className).not.toContain('shrink-0');
  });
});
