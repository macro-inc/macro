import { Component, Show } from 'solid-js';

interface NotificationProps {
  icon?: string;
  title: string;
  body: string;
  badge?: string;
  onClose?: () => void;
}

export const BrowserNotificationPreview: Component<NotificationProps> = (props) => {
  return (
    <div class="w-full bg-[#1a1a1a] rounded-lg shadow-2xl overflow-hidden">
      <div class="flex items-start gap-3 p-4">
        {/* Icon with optional badge */}
        <div class="relative flex-shrink-0">
          <div class="w-10 h-10 rounded-lg overflow-hidden bg-gray-800 flex items-center justify-center">
            <Show when={props.icon} fallback={<div class="w-6 h-6 bg-gray-600 rounded" />}>
              <img src={props.icon} alt="" class="w-full h-full object-cover" />
            </Show>
          </div>
          <Show when={props.badge}>
            <div class="absolute -top-1 -left-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
              <img src={props.badge} alt="" class="w-3 h-3" />
            </div>
          </Show>
        </div>

        {/* Content */}
        <div class="flex-1 min-w-0">
          <div class="text-white font-medium text-sm mb-1 truncate">
            {props.title}
          </div>
          <div class="text-gray-400 text-sm line-clamp-2">
            {props.body}
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={props.onClose}
          class="flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clip-rule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};
