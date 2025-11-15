import { GlitchText } from '@core/component/GlitchText';
import { PcNoiseGrid } from '@core/component/PcNoiseGrid';
import { createSignal, createEffect, onCleanup, Show } from 'solid-js';

interface PresentModeGlitchProps {
  show: boolean;
  onComplete: () => void;
}

export function PresentModeGlitch(props: PresentModeGlitchProps) {
  const [isVisible, setIsVisible] = createSignal(false);
  const [showContent, setShowContent] = createSignal(false);
  let timeoutIds: number[] = [];

  createEffect(() => {
    if (props.show) {
      setIsVisible(true);
      // Start content animation after a brief delay
      const id = window.setTimeout(() => {
        setShowContent(true);
      }, 50);
      timeoutIds.push(id);
    } else {
      setIsVisible(false);
      setShowContent(false);
      timeoutIds.forEach(id => clearTimeout(id));
      timeoutIds = [];
    }
  });

  onCleanup(() => {
    timeoutIds.forEach(id => clearTimeout(id));
  });

  const handleAnimationComplete = () => {
    // Wait a bit then fade out
    const id1 = window.setTimeout(() => {
      setIsVisible(false);
      const id2 = window.setTimeout(() => {
        props.onComplete();
      }, 200);
      timeoutIds.push(id2);
    }, 400);
    timeoutIds.push(id1);
  };

  return (
    <Show when={isVisible()}>
      <div
        class="fixed inset-0 z-[99999] pointer-events-none"
        style={{
          'background-color': '#000000',
          opacity: isVisible() ? 1 : 0,
          transition: 'opacity 0.2s ease-out',
        }}
      >
        {/* Cybernetic noise grid background */}
        <div class="absolute inset-0 opacity-20">
          <PcNoiseGrid
            cellSize={8}
            warp={2}
            crunch={0.5}
            size={[1, 1]}
            rounding={0}
            freq={0.01}
            speed={[0.5, 0.3]}
          />
        </div>

        {/* Scanlines overlay */}
        <div
          class="absolute inset-0 opacity-20"
          style={{
            'background-image':
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 196, 255, 0.1) 2px, rgba(0, 196, 255, 0.1) 4px)',
            'background-size': '100% 4px',
          }}
        />

        {/* Glitch distortion effect */}
        <div
          class="absolute inset-0 opacity-10"
          style={{
            'background-image': `
              linear-gradient(90deg, transparent 0%, rgba(0, 196, 255, 0.1) 50%, transparent 100%),
              linear-gradient(0deg, transparent 0%, rgba(0, 196, 255, 0.05) 50%, transparent 100%)
            `,
            'background-size': '200% 200%',
            animation: 'glitch-scan 0.1s linear infinite',
          }}
        />

        {/* Main content */}
        <Show when={showContent()}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-8">
            {/* Glitch text with shadow effects */}
            <div class="relative">
              {/* Shadow glitch layers */}
              <div class="absolute inset-0 blur-sm opacity-50">
                <GlitchText
                  from=""
                  to="JACKED IN"
                  chars="█▓▒░▀▄▌▐■□▲►▼◄◀▶◁▷◊○●◯◮◭◬◫◪◩◨◧◦◥◤◣◢◡◠◟◞◝◜◛◚◙◘◗◖◕◔◓◒◑◐●◎◍◌○◊"
                  cycles={1}
                  framerate={48}
                  delay={0}
                  class="font-mono text-6xl sm:text-8xl text-accent/30 font-bold tracking-wider"
                />
              </div>
              {/* Main glitch text */}
              <div class="relative">
                <GlitchText
                  from=""
                  to="JACKED IN"
                  chars="█▓▒░▀▄▌▐■□▲►▼◄◀▶◁▷◊○●◯◮◭◬◫◪◩◨◧◦◥◤◣◢◡◠◟◞◝◜◛◚◙◘◗◖◕◔◓◒◑◐●◎◍◌○◊"
                  cycles={1}
                  framerate={48}
                  delay={0}
                  onComplete={handleAnimationComplete}
                  class="font-mono text-6xl sm:text-8xl text-accent font-bold tracking-wider drop-shadow-[0_0_20px_rgba(0,196,255,0.5)]"
                />
              </div>
            </div>

            {/* Cybernetic brackets with animated dots */}
            <div class="flex items-center gap-4 text-accent/50 font-mono text-2xl">
              <span class="animate-pulse">[</span>
              <span class="text-accent/30 flex items-center gap-1">
                <span>A</span>
                <span class="animate-pulse">C</span>
                <span>T</span>
                <span class="animate-pulse">I</span>
                <span>V</span>
                <span class="animate-pulse">A</span>
                <span>T</span>
                <span class="animate-pulse">I</span>
                <span>N</span>
                <span class="animate-pulse">G</span>
              </span>
              <span class="animate-pulse">]</span>
            </div>

            {/* Animated glitch lines */}
            <div class="absolute inset-0 pointer-events-none overflow-hidden">
              {Array.from({ length: 30 }).map((_, i) => {
                const delay = i * 50;
                const offset = (i % 3) * 33;
                return (
                  <div
                    class="absolute w-full h-px bg-accent glitch-line"
                    style={{
                      top: `${offset}%`,
                      left: '0%',
                      opacity: '0.1',
                      'animation-delay': `${delay}ms`,
                    }}
                  />
                );
              })}
            </div>

            {/* Corner brackets */}
            <div class="absolute top-8 left-8 text-accent/20 font-mono text-4xl">
              {'{'}
            </div>
            <div class="absolute top-8 right-8 text-accent/20 font-mono text-4xl">
              {'}'}
            </div>
            <div class="absolute bottom-8 left-8 text-accent/20 font-mono text-4xl">
              {'['}
            </div>
            <div class="absolute bottom-8 right-8 text-accent/20 font-mono text-4xl">
              {']'}
            </div>
          </div>
        </Show>

        {/* CSS animations */}
        <style>
          {`
            @keyframes glitch-scan {
              0% { background-position: 0% 0%; }
              100% { background-position: 100% 100%; }
            }
            @keyframes glitch-line {
              0%, 100% { transform: translateX(0px); }
              25% { transform: translateX(50px); }
              50% { transform: translateX(-50px); }
              75% { transform: translateX(30px); }
            }
            .glitch-line {
              animation: glitch-line 0.5s linear infinite;
            }
          `}
        </style>
      </div>
    </Show>
  );
}

