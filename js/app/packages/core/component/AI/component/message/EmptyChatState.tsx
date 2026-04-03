export function EmptyChatState(props: { minHeight: number }) {
  return (
    <div
      class="w-full"
      style={{
        'min-height': `${props.minHeight}px`,
      }}
    />
  );
}
