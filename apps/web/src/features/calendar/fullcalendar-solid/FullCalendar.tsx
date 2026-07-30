import {
  type AllDayContentArg,
  Calendar,
  type CalendarApi,
  type CalendarOptions,
  type DatesSetArg,
  type DayCellContentArg,
  type DayHeaderContentArg,
  type EventContentArg,
  type MoreLinkContentArg,
  type NowIndicatorContentArg,
  type SlotLabelContentArg,
  type SlotLaneContentArg,
  type WeekNumberContentArg,
} from '@fullcalendar/core';
import type { CustomRendering } from '@fullcalendar/core/internal';
import { mergeRefs } from '@solid-primitives/refs';
import {
  type Accessor,
  type Component,
  createContext,
  createEffect,
  createSignal,
  getOwner,
  type JSX,
  type Owner,
  on,
  onCleanup,
  splitProps,
  useContext,
} from 'solid-js';
import { render } from 'solid-js/web';

/**
 * Content accepted by FullCalendar's Solid-aware rendering hooks.
 *
 * Return values follow Solid JSX semantics. FullCalendar's framework-neutral
 * `true`, `{ html }`, and `{ domNodes }` forms are intentionally not supported;
 * omit or unmount a content registration to restore FullCalendar's default.
 */
export type SolidCalendarContent = JSX.Element;

/** A Solid render function for a FullCalendar content hook. */
export type SolidCalendarContentGenerator<RenderProps> = (
  renderProps: RenderProps
) => SolidCalendarContent;

interface SolidContentOptions {
  allDayContent?: SolidCalendarContentGenerator<AllDayContentArg>;
  dayCellContent?: SolidCalendarContentGenerator<DayCellContentArg>;
  dayHeaderContent?: SolidCalendarContentGenerator<DayHeaderContentArg>;
  eventContent?: SolidCalendarContentGenerator<EventContentArg>;
  moreLinkContent?: SolidCalendarContentGenerator<MoreLinkContentArg>;
  nowIndicatorContent?: SolidCalendarContentGenerator<NowIndicatorContentArg>;
  slotLabelContent?: SolidCalendarContentGenerator<SlotLabelContentArg>;
  slotLaneContent?: SolidCalendarContentGenerator<SlotLaneContentArg>;
  weekNumberContent?: SolidCalendarContentGenerator<WeekNumberContentArg>;
}

type SolidContentOptionName = keyof SolidContentOptions;
type ConnectorOptionName =
  | 'customRenderingMetaMap'
  | 'customRenderingReplaces'
  | 'handleCustomRendering';

/** FullCalendar options accepted by the Solid connector root. */
export type FullCalendarOptions = Omit<
  CalendarOptions,
  SolidContentOptionName | ConnectorOptionName
>;

/** Props for the FullCalendar context root. */
export type FullCalendarRootProps = FullCalendarOptions & {
  /** Calendar controls, content registrations, and a `FullCalendar.Host`. */
  children?: JSX.Element;
};

/** Props for the DOM element owned by FullCalendar. */
export type FullCalendarHostProps = Omit<
  JSX.HTMLAttributes<HTMLDivElement>,
  'children' | 'ref'
> & {
  /** Receives FullCalendar's host element. */
  ref?: (element: HTMLDivElement) => void;
};

/** Public state and API available to descendants of `FullCalendar.Root`. */
export interface FullCalendarContextValue {
  /** The mounted FullCalendar API, or `undefined` before a host mounts. */
  api: Accessor<CalendarApi | undefined>;
  /** The latest date information emitted by FullCalendar. */
  dateInfo: Accessor<DatesSetArg | undefined>;
}

interface SolidRenderingMeta {
  generator: unknown;
  owner: Owner | null;
  type: typeof SOLID_RENDERING_META;
}

interface ContentRegistration {
  generator: unknown;
  owner: Owner | null;
  token: symbol;
}

interface ContentRegistrationHandle {
  dispose(): void;
}

interface FullCalendarController extends FullCalendarContextValue {
  destroy(): void;
  mount(element: HTMLDivElement): void;
  registerContent(
    optionName: SolidContentOptionName,
    generator: unknown,
    owner: Owner | null
  ): ContentRegistrationHandle;
  unmount(element: HTMLDivElement): void;
}

type AnyCustomRendering = CustomRendering<unknown>;
type SetCustomRendering = (rendering: AnyCustomRendering) => void;

interface MountedCustomRendering {
  containerEl: HTMLElement;
  dispose: () => void;
  generatorName: string;
  owner: Owner | null;
  setRendering: SetCustomRendering;
}

interface CustomRenderingManager {
  destroy(): void;
  handle(rendering: AnyCustomRendering): void;
  retainGeneratorNames(generatorNames: ReadonlySet<string>): void;
}

interface BuiltCalendarOptions {
  contentOptionNames: Set<string>;
  options: CalendarOptions;
}

const SOLID_RENDERING_META = Symbol('FullCalendarSolidRendering');
const FullCalendarContext = createContext<FullCalendarController>();

/**
 * Provides a FullCalendar controller and accepts its initial and reactive
 * options. Descendants determine where the calendar and custom content render.
 */
export function FullCalendarRoot(props: FullCalendarRootProps) {
  const [local, options] = splitProps(props, ['children']);
  const controller = createFullCalendarController(() => ({ ...options }));

  onCleanup(() => controller.destroy());

  return (
    <FullCalendarContext.Provider value={controller}>
      {local.children}
    </FullCalendarContext.Provider>
  );
}

/** The DOM host that FullCalendar renders into. */
export function FullCalendarHost(props: FullCalendarHostProps) {
  const controller = useFullCalendarController();
  const [local, elementProps] = splitProps(props, ['ref']);
  const [element, setElement] = createSignal<HTMLDivElement>();

  createEffect(
    on(element, (hostElement) => {
      if (!hostElement) return;

      controller.mount(hostElement);
      onCleanup(() => controller.unmount(hostElement));
    })
  );

  return <div {...elementProps} ref={mergeRefs(setElement, local.ref)} />;
}

interface CalendarContentSlotProps<RenderProps> {
  children: (renderProps: RenderProps) => SolidCalendarContent;
}

type ContentRenderProps<OptionName extends SolidContentOptionName> =
  NonNullable<
    SolidContentOptions[OptionName]
  > extends SolidCalendarContentGenerator<infer RenderProps>
    ? RenderProps
    : never;

function registerContentSlot<OptionName extends SolidContentOptionName>(
  optionName: OptionName
): Component<CalendarContentSlotProps<ContentRenderProps<OptionName>>> {
  return (props) => {
    const controller = useFullCalendarController();
    const renderContent = (renderProps: ContentRenderProps<OptionName>) =>
      props.children(renderProps);
    const registration = controller.registerContent(
      optionName,
      renderContent,
      getOwner()
    );

    onCleanup(() => registration.dispose());
    return null;
  };
}

/** Registers Solid content for FullCalendar's all-day label. */
export const FullCalendarAllDayContent = registerContentSlot('allDayContent');

/** Registers Solid content for FullCalendar day cells. */
export const FullCalendarDayCellContent = registerContentSlot('dayCellContent');

/** Registers Solid content for FullCalendar day headers. */
export const FullCalendarDayHeaderContent =
  registerContentSlot('dayHeaderContent');

/** Registers Solid content for calendar events. */
export const FullCalendarEventContent = registerContentSlot('eventContent');

/** Registers Solid content for FullCalendar's more-events link. */
export const FullCalendarMoreLinkContent =
  registerContentSlot('moreLinkContent');

/** Registers Solid content for FullCalendar's current-time indicator. */
export const FullCalendarNowIndicatorContent = registerContentSlot(
  'nowIndicatorContent'
);

/** Registers Solid content for FullCalendar slot labels. */
export const FullCalendarSlotLabelContent =
  registerContentSlot('slotLabelContent');

/** Registers Solid content for FullCalendar slot lanes. */
export const FullCalendarSlotLaneContent =
  registerContentSlot('slotLaneContent');

/** Registers Solid content for FullCalendar week numbers. */
export const FullCalendarWeekNumberContent =
  registerContentSlot('weekNumberContent');

/** Returns the nearest FullCalendar controller. */
export function useFullCalendar(): FullCalendarContextValue {
  return useFullCalendarController();
}

function useFullCalendarController(): FullCalendarController {
  const controller = useContext(FullCalendarContext);
  if (!controller) {
    throw new Error(
      'FullCalendar components must be used within FullCalendar.Root'
    );
  }

  return controller;
}

function createFullCalendarController(
  getOptions: Accessor<FullCalendarOptions>
): FullCalendarController {
  const [calendar, setCalendar] = createSignal<Calendar>();
  const [dateInfo, setDateInfo] = createSignal<DatesSetArg>();
  const [hostElement, setHostElement] = createSignal<HTMLDivElement>();
  const [resizeFrame, setResizeFrame] = createSignal<number>();
  const [isUnmounting, setIsUnmounting] = createSignal(false);
  const contentRegistrations = new Map<
    SolidContentOptionName,
    ContentRegistration
  >();

  const requestResize = () => {
    if (isUnmounting() || !calendar()) return;

    const currentResizeFrame = resizeFrame();
    if (currentResizeFrame !== undefined) {
      cancelAnimationFrame(currentResizeFrame);
    }
    setResizeFrame(
      requestAnimationFrame(() => {
        setResizeFrame(undefined);
        calendar()?.updateSize();
      })
    );
  };

  const customRenderingManager = createCustomRenderingManager(requestResize);
  const handleCustomRendering = (rendering: AnyCustomRendering) => {
    customRenderingManager.handle(rendering);
  };

  const buildOptions = () =>
    buildCalendarOptions(
      getOptions(),
      contentRegistrations,
      handleCustomRendering,
      setDateInfo
    );

  const resetOptions = () => {
    const calendarInstance = calendar();
    if (!calendarInstance) return;

    const nextOptions = buildOptions();
    customRenderingManager.retainGeneratorNames(nextOptions.contentOptionNames);
    calendarInstance.resetOptions(nextOptions.options);
  };

  createEffect(on(getOptions, resetOptions, { defer: true }));

  const unmount = (element: HTMLDivElement) => {
    if (hostElement() !== element) return;

    setIsUnmounting(true);
    const currentResizeFrame = resizeFrame();
    if (currentResizeFrame !== undefined) {
      cancelAnimationFrame(currentResizeFrame);
      setResizeFrame(undefined);
    }
    calendar()?.destroy();
    setCalendar(undefined);
    setDateInfo(undefined);
    setHostElement(undefined);
    customRenderingManager.destroy();
  };

  return {
    api: calendar,
    dateInfo,
    destroy() {
      const mountedHostElement = hostElement();
      if (mountedHostElement) unmount(mountedHostElement);
      contentRegistrations.clear();
    },
    mount(element) {
      if (hostElement()) {
        throw new Error('FullCalendar.Root can only contain one mounted host');
      }

      setIsUnmounting(false);
      setHostElement(element);
      const initialOptions = buildOptions();
      customRenderingManager.retainGeneratorNames(
        initialOptions.contentOptionNames
      );
      const calendarInstance = new Calendar(element, initialOptions.options);
      setCalendar(calendarInstance);
      calendarInstance.render();
    },
    registerContent(optionName, generator, owner) {
      if (contentRegistrations.has(optionName)) {
        throw new Error(
          `FullCalendar.${optionName} can only be registered once per root`
        );
      }

      const registration: ContentRegistration = {
        generator,
        owner,
        token: Symbol(optionName),
      };
      contentRegistrations.set(optionName, registration);
      resetOptions();

      return {
        dispose() {
          if (
            contentRegistrations.get(optionName)?.token !== registration.token
          ) {
            return;
          }

          contentRegistrations.delete(optionName);
          resetOptions();
        },
      };
    },
    unmount,
  };
}

function buildCalendarOptions(
  rootOptions: FullCalendarOptions,
  contentRegistrations: Map<SolidContentOptionName, ContentRegistration>,
  handleCustomRendering: (rendering: AnyCustomRendering) => void,
  setDateInfo: (dateInfo: DatesSetArg) => void
): BuiltCalendarOptions {
  const options = { ...rootOptions } as Record<string, unknown>;
  const externalDatesSet = rootOptions.datesSet;
  const customRenderingMetaMap: Record<string, SolidRenderingMeta> = {};

  options.datesSet = (dateInfo: DatesSetArg) => {
    setDateInfo(dateInfo);
    externalDatesSet?.(dateInfo);
  };

  for (const [optionName, registration] of contentRegistrations) {
    customRenderingMetaMap[optionName] = createSolidRenderingMeta(
      registration.generator,
      registration.owner
    );
    delete options[optionName];
  }

  return {
    contentOptionNames: new Set(Object.keys(customRenderingMetaMap)),
    options: {
      ...options,
      customRenderingMetaMap,
      handleCustomRendering,
    } as CalendarOptions,
  };
}

function createSolidRenderingMeta(
  generator: unknown,
  owner: Owner | null
): SolidRenderingMeta {
  return { generator, owner, type: SOLID_RENDERING_META };
}

function isSolidRenderingMeta(value: unknown): value is SolidRenderingMeta {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === SOLID_RENDERING_META
  );
}

function createCustomRenderingManager(
  onRenderingChange: () => void
): CustomRenderingManager {
  const mountedRenderings = new Map<string, MountedCustomRendering>();

  const remove = (id: string) => {
    const mounted = mountedRenderings.get(id);
    if (!mounted) return;

    mounted.dispose();
    mountedRenderings.delete(id);
  };

  return {
    destroy() {
      for (const mounted of mountedRenderings.values()) mounted.dispose();
      mountedRenderings.clear();
    },
    handle(rendering) {
      if (!rendering.isActive) {
        remove(rendering.id);
        onRenderingChange();
        return;
      }

      const renderingOwner = getCustomRenderingOwner(rendering);
      const mounted = mountedRenderings.get(rendering.id);
      if (
        mounted?.containerEl === rendering.containerEl &&
        mounted.owner === renderingOwner
      ) {
        mounted.setRendering(rendering);
        onRenderingChange();
        return;
      }

      remove(rendering.id);

      const [currentRendering, setCurrentRendering] =
        createSignal<AnyCustomRendering>(rendering, { equals: false });
      const renderContent = () => {
        const current = currentRendering();
        return resolveCustomContent(current.generatorMeta, current.renderProps);
      };
      const dispose = render(
        // Solid's DOM renderer treats an accessor as a reactive child.
        () => renderContent as unknown as JSX.Element,
        rendering.containerEl,
        undefined,
        { owner: renderingOwner }
      );

      mountedRenderings.set(rendering.id, {
        containerEl: rendering.containerEl,
        dispose,
        generatorName: rendering.generatorName,
        owner: renderingOwner,
        setRendering: setCurrentRendering,
      });
      onRenderingChange();
    },
    retainGeneratorNames(generatorNames) {
      let didRemoveRendering = false;

      for (const [id, mounted] of mountedRenderings) {
        if (!generatorNames.has(mounted.generatorName)) {
          remove(id);
          didRemoveRendering = true;
        }
      }

      if (didRemoveRendering) onRenderingChange();
    },
  };
}

function getCustomRenderingOwner(rendering: AnyCustomRendering): Owner | null {
  return isSolidRenderingMeta(rendering.generatorMeta)
    ? rendering.generatorMeta.owner
    : null;
}

function resolveCustomContent(
  generatorMeta: unknown,
  renderProps: unknown
): JSX.Element {
  const generator = isSolidRenderingMeta(generatorMeta)
    ? generatorMeta.generator
    : generatorMeta;

  return (
    typeof generator === 'function' ? generator(renderProps) : generator
  ) as JSX.Element;
}

/** Compound components for composing a Solid FullCalendar integration. */
export const FullCalendar = {
  AllDayContent: FullCalendarAllDayContent,
  DayCellContent: FullCalendarDayCellContent,
  DayHeaderContent: FullCalendarDayHeaderContent,
  EventContent: FullCalendarEventContent,
  Host: FullCalendarHost,
  MoreLinkContent: FullCalendarMoreLinkContent,
  NowIndicatorContent: FullCalendarNowIndicatorContent,
  Root: FullCalendarRoot,
  SlotLabelContent: FullCalendarSlotLabelContent,
  SlotLaneContent: FullCalendarSlotLaneContent,
  WeekNumberContent: FullCalendarWeekNumberContent,
} as const;
