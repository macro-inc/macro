import type { CustomToastConfig } from '@core/component/Toast/Toast';
import { createSignal, For } from 'solid-js';

/** Stands in for `@core/component/Toast/Toast` so tests can see and press custom toasts. */
type OpenToast = { id: number; config: CustomToastConfig };

const [open, setOpen] = createSignal<OpenToast[]>([]);
let nextId = 0;

export const toast = {
  custom(config: CustomToastConfig) {
    const id = ++nextId;
    setOpen((toasts) => [...toasts, { id, config }]);
    return id;
  },
  dismiss(id: number) {
    setOpen((toasts) => toasts.filter((toast) => toast.id !== id));
  },
};

export function FakeToaster() {
  return (
    <For each={open()}>
      {(toast) => (
        <div role="status">
          <p>{toast.config.title}</p>
          <p>{toast.config.content?.()}</p>
          <For each={toast.config.actions}>
            {(action) => (
              <button onClick={action.onClick}>{action.label}</button>
            )}
          </For>
        </div>
      )}
    </For>
  );
}
