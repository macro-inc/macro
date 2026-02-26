import { QUERY_FILTERS } from '@app/component/next-soup/filters/filters';
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
import { useUserContext } from '@core/context/user';
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

  const { setQueryFilters } = useSoupView();

  // Batch filter + query updates so the prefetch effect in soup-view-context
  // sees the final query filters and active filter state in a single tick,
  // avoiding intermediate re-renders with mismatched query keys.
  const toggleFocus = (id: 'signal' | 'noise' | 'all') => {
    if (id === 'all') {
      batch(() => {
        setQueryFilters({});
        soup.filters.activate('explicit-noise');
        soup.filters.deactivate('not-done');
      });
      return;
    }

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
  const { setQueryFilters } = useSoupView();

  const user = useUserContext();

  const handleTabChange = (value: string) => {
    match(value)
      .with('owned', () => {
        const userId = user.userId();
        if (!userId) return;
        setQueryFilters({
          ...QUERY_FILTERS.agent,
          chat_filters: { owners: [userId] },
        });
      })
      .with('running', () => {
        // TODO
        setQueryFilters({
          ...QUERY_FILTERS.agent,
        });
        // soup.filters.activate('active-agent');
      })
      .with('shared', () => {
        // TODO
        setQueryFilters({
          ...QUERY_FILTERS.agent,
        });
        // soup.filters.activate('active-agent');
      });
  };

  return (
    <div>
      <SegmentedControl
        list={[
          {
            value: 'owned',
            label: 'My agents',
          },

          {
            value: 'running',
            label: 'Running agents',
          },
          {
            value: 'shared',
            label: 'Shared with me',
          },
        ]}
        onChange={handleTabChange}
      />
    </div>
  );
};

const MailTabs = () => {
  const soup = useSoup();
  const { setQueryFilters } = useSoupView();

  const user = useUserContext();

  const handleTabChange = (value: string) => {
    match(value)
      .with('important', () => {
        setQueryFilters({
          ...QUERY_FILTERS.email,
          email_filters: { importance: true },
        });
        soup.filters.set(['email', 'no-drafts']);
      })
      .with('noise', () => {
        setQueryFilters({
          ...QUERY_FILTERS.email,
          email_filters: {
            importance: false,
          },
        });
        soup.filters.set(['email', 'no-drafts']);
      })
      .with('drafts', () => {
        setQueryFilters({
          ...QUERY_FILTERS.email,
        });
        soup.filters.set(['email-drafts']);
      })
      .with('sent', () => {
        const email = user.email();
        if (!email) return;
        setQueryFilters({
          ...QUERY_FILTERS.email,
          email_filters: {
            senders: [email],
          },
        });
        soup.filters.set(['email', 'no-drafts']);
      });
  };

  return (
    <div>
      <SegmentedControl
        list={[
          {
            value: 'important',
            label: 'Important',
          },

          {
            value: 'noise',
            label: 'Noise',
          },
          {
            value: 'drafts',
            label: 'Drafts',
          },
          {
            value: 'sent',
            label: 'Sent',
          },
        ]}
        onChange={handleTabChange}
      />
    </div>
  );
};

const DocumentsTabs = () => {
  const soup = useSoup();
  const { setQueryFilters } = useSoupView();

  const user = useUserContext();

  const handleTabChange = (value: string) => {
    match(value)
      .with('owned', () => {
        const userId = user.userId();

        if (!userId) return;

        setQueryFilters({
          ...QUERY_FILTERS.document,
          document_filters: { owners: [userId] },
        });

        soup.filters.set(['document']);
      })
      .with('shared', () => {
        setQueryFilters({
          ...QUERY_FILTERS.document,
        });
        soup.filters.set(['document', 'shared-document']);
      })
      .with('all', () => {
        setQueryFilters({
          ...QUERY_FILTERS.document,
        });
        soup.filters.set(['document']);
      });
  };

  return (
    <div>
      <SegmentedControl
        list={[
          {
            value: 'owned',
            label: 'My documents',
          },

          {
            value: 'shared',
            label: 'Shared with me',
          },
          {
            value: 'all',
            label: 'All',
          },
        ]}
        onChange={handleTabChange}
      />
    </div>
  );
};

const TasksTabs = () => {
  return (
    <div>
      <SegmentedControl
        list={[
          {
            value: 'assigned-to-me',
            label: 'Assigned to me',
          },

          {
            value: 'created-by-me',
            label: 'Created by me',
          },
          {
            value: 'all',
            label: 'All',
          },
        ]}
        onChange={(value) => {}}
      />
    </div>
  );
};

const ChannelsTabs = () => {
  return (
    <div>
      <SegmentedControl
        list={[
          {
            value: 'recent',
            label: 'Recent',
          },

          {
            value: 'people',
            label: 'People',
          },
          {
            value: 'teams',
            label: 'Teams',
          },
        ]}
        onChange={(value) => {}}
      />
    </div>
  );
};

const FilesTabs = () => {
  return (
    <div>
      <SegmentedControl
        list={[
          {
            value: 'owned',
            label: 'My files',
          },

          {
            value: 'shared',
            label: 'Shared with me',
          },
          {
            value: 'all',
            label: 'All',
          },
        ]}
        onChange={(value) => {}}
      />
    </div>
  );
};
