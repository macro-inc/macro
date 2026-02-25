import {
  applyInboxQueryFilters,
  removeOtherQueryFilters,
  applyOtherQueryFilters,
  removeInboxQueryFilters,
} from '@app/component/next-soup/filters/inbox-query-filters';
import { useSoup } from '@app/component/next-soup/soup-context';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import type { ListView } from '@app/constants/list-views';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { batch, createMemo, Match, Switch } from 'solid-js';
import { match } from 'ts-pattern';

export const SoupViewTabs = () => {
  const panel = useSplitPanelOrThrow();

  const component = createMemo(() => {
    const content = panel.handle.content();

    if (content.type !== 'component') return;

    return content.id;
  });

  const isComponentListView = (listView: ListView) => {
    return component() === listView;
  };

  return (
    <Switch>
      <Match when={isComponentListView('inbox')}>
        <InboxTabs />
      </Match>
      <Match when={isComponentListView('agents')}>
        <AgentsTabs />
      </Match>
      <Match when={isComponentListView('mail')}>
        <MailTabs />
      </Match>
      <Match when={isComponentListView('documents')}>
        <DocumentsTabs />
      </Match>
      <Match when={isComponentListView('tasks')}>
        <TasksTabs />
      </Match>
      <Match when={isComponentListView('channels')}>
        <ChannelsTabs />
      </Match>
      <Match when={isComponentListView('files')}>
        <FilesTabs />
      </Match>
    </Switch>
  );
};

const InboxTabs = () => {
  const soup = useSoup();

  const { setQueryFilters, queryFilters } = useSoupView();

  // Batch filter + query updates so the prefetch effect in soup-view-context
  // sees the final query filters and active filter state in a single tick,
  // avoiding intermediate re-renders with mismatched query keys.
  const toggleFocus = (id: 'signal' | 'noise' | 'all') => {
    if (id === 'all') return;

    const comb = { id, isActive: soup.filters.isActive(id) };

    const activateFocus = () => {
      soup.filters.toggle(id);
      soup.filters.activate('not-done');
    };

    const deactivateFocus = () => {
      soup.filters.toggle('explicit-noise');
      soup.filters.deactivate('not-done');
    };

    batch(() => {
      match(comb)
        .with({ id: 'signal', isActive: false }, () => {
          setQueryFilters((prev) =>
            applyInboxQueryFilters(removeOtherQueryFilters(prev))
          );
          activateFocus();
        })
        .with({ id: 'noise', isActive: false }, () => {
          setQueryFilters((prev) =>
            applyOtherQueryFilters(removeInboxQueryFilters(prev))
          );
          activateFocus();
        })
        .with({ id: 'signal', isActive: true }, () => {
          setQueryFilters(removeInboxQueryFilters);
          deactivateFocus();
        })
        .with({ id: 'noise', isActive: true }, () => {
          setQueryFilters(removeOtherQueryFilters);
          deactivateFocus();
        })
        .exhaustive();
    });
  };
  return (
    <div>
      <SegmentedControl
        list={['signal', 'noise', 'all']}
        onChange={(value) => {
          toggleFocus(value as 'signal');
        }}
      />
    </div>
  );
};

const AgentsTabs = () => {
  return <div></div>;
};

const MailTabs = () => {
  return <div></div>;
};

const DocumentsTabs = () => {
  return <div></div>;
};

const TasksTabs = () => {
  return <div></div>;
};

const ChannelsTabs = () => {
  return <div></div>;
};

const FilesTabs = () => {
  return <div></div>;
};
