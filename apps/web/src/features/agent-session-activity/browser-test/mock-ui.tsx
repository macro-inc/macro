import type { JSX } from 'solid-js';

export const useSidePanel = () => null;

export const SidePanel = {
  Section: (props: { title: JSX.Element; children: JSX.Element }) => (
    <section>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  ),
  CountTitle: (props: { label: JSX.Element; count: number }) => (
    <>
      {props.label} ({props.count})
    </>
  ),
};

export function Button(props: { children: JSX.Element; onClick: () => void }) {
  return (
    <button
      class="rounded-full bg-accent px-2 py-1 text-button-accent-ink"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function EntityMention(props: { display: { name: () => string } }) {
  return <span>{props.display.name()}</span>;
}

export function EntityIcon() {
  return <span aria-hidden>▣</span>;
}

export function usePropertyEntityDisplay(id: () => string) {
  return {
    name: () => `Document ${id()}`,
    icon: () => <EntityIcon />,
    isLoading: () => false,
    hasPreviewAccess: () => true,
    blockOrFileType: () => 'md',
    linkParams: () => undefined,
  };
}

export function useActivityContext() {
  return { entityDisplay: () => undefined };
}
