import { TextButton } from '@core/component/TextButton';
import { Bar } from '@core/component/TopBar/Bar';
import {
  useContacts,
  useEmailContacts,
  useOrganizationUsers,
} from '@core/user';
import Refresh from '@phosphor-icons/core/regular/arrow-clockwise.svg?component-solid';
import Copy from '@phosphor-icons/core/regular/copy.svg?component-solid';
import { useHistory } from '@service-storage/history';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';

interface SignalDebugCardProps {
  title: string;
  data: any[];
  renderItem: (item: any) => JSX.Element;
}

function SignalDebugCard(props: SignalDebugCardProps) {
  const formatJson = (data: any) => {
    try {
      return JSON.stringify(data, null, 2);
    } catch (_e) {
      return String(data);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(formatJson(props.data));
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  return (
    <div class="border border-edge rounded-lg p-4">
      <h2 class="text-lg font-semibold mb-3 text-accent">
        {props.title} - {props.data.length} items
      </h2>
      <div>
        <Show
          when={props.data.length > 0}
          fallback={
            <div class="text-text-secondary italic">
              No {props.title.toLowerCase()} found
            </div>
          }
        >
          <div class="max-h-60 overflow-y-auto space-y-2">
            <For each={props.data}>{props.renderItem}</For>
          </div>
        </Show>
      </div>
      <div class="border-t border-edge mt-3 pt-3">
        <details>
          <summary class="cursor-pointer text-accent text-sm">Raw JSON</summary>
          <div class="mt-2 relative">
            <button
              onClick={copyToClipboard}
              class="absolute top-2 right-2 p-1 rounded bg-surface-secondary hover:bg-surface-tertiary text-text-secondary hover:text-text-primary transition-colors z-10"
              title="Copy to clipboard"
            >
              <Copy class="w-4 h-4" />
            </button>
            <pre class="text-xs bg-message p-3 rounded overflow-auto max-h-80 border border-edge/20">
              {formatJson(props.data)}
            </pre>
          </div>
        </details>
      </div>
    </div>
  );
}

const DataDebug: Component = () => {
  const contacts = useContacts();
  const emailContacts = useEmailContacts();
  const organizationUsers = useOrganizationUsers();
  const history = useHistory();

  const [_, setRefreshKey] = createSignal(0);

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div class="flex flex-col h-full w-full">
      <Bar
        left={
          <div class="p-2 text-sm w-2xl truncate">
            Global Signals Data Debug
          </div>
        }
        center={
          <TextButton
            theme="base"
            text="Refresh"
            icon={Refresh}
            onClick={handleRefresh}
          />
        }
      ></Bar>
      <div class="flex flex-col gap-6 p-6 overflow-scroll">
        <div class="grid grid-cols-2 @width-md/split:-grid-cols-1 gap-6">
          <SignalDebugCard
            title="useContacts()"
            data={contacts()}
            renderItem={(contact) => (
              <div class="bg-surface-secondary p-2 rounded text-sm">
                <div class="font-medium">{contact.email}</div>
                <div class="text-text-secondary">ID: {contact.id}</div>
              </div>
            )}
          />

          <SignalDebugCard
            title="useEmailContacts()"
            data={emailContacts()}
            renderItem={(contact) => (
              <div class="bg-surface-secondary p-2 rounded text-sm">
                <div class="font-medium">{contact.name}</div>
                <div class="text-text-secondary">
                  Type: {contact.type} |
                  {'email' in contact
                    ? ` Email: ${contact.email}`
                    : ` Domain: ${contact.domain}`}
                </div>
              </div>
            )}
          />

          <SignalDebugCard
            title="useOrganizationUsers()"
            data={organizationUsers()}
            renderItem={(user) => (
              <div class="bg-surface-secondary p-2 rounded text-sm">
                <div class="font-medium">{user.email}</div>
                <div class="text-text-secondary">
                  ID: {user.id} | Admin: {user.is_it_admin ? 'Yes' : 'No'}
                </div>
              </div>
            )}
          />

          <SignalDebugCard
            title="useHistory()"
            data={history()}
            renderItem={(item) => (
              <div class="bg-surface-secondary p-2 rounded text-sm">
                <div class="font-medium">{item.name}</div>
                <div class="text-text-secondary">
                  ID: {item.id} | Type: {item.type}
                </div>
              </div>
            )}
          />
        </div>
      </div>
    </div>
  );
};

export default DataDebug;
