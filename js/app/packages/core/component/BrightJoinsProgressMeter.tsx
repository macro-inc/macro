export default function BrightJoinsProgressMeter(props: { progress: number }) {
  return (
    <div
      class="-top-px left-[2px] absolute bg-gradient-to-r from-edge to-ink w-[calc(var(--onboarding-progress)-4px)] h-px transition-[width] duration-1000"
      style={`--onboarding-progress: ${props.progress}%`}
    ></div>
  );
}
