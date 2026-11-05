import { type Accessor, createContext, useContext } from 'solid-js';

/** What the inline Calendar in the content area needs from the view. */
export type NotificationsCalendarPaneContext = {
  /** Bumped when the open event is chosen again, to re-aim at it in place. */
  refocus: Accessor<number>;
};

const Context = createContext<NotificationsCalendarPaneContext>();

export const NotificationsCalendarPaneProvider = Context.Provider;

export function useNotificationsCalendarPane(): NotificationsCalendarPaneContext {
  const context = useContext(Context);
  if (!context) {
    throw new Error('NotificationsCalendarPaneProvider is required');
  }
  return context;
}
