// import { createCallback } from '@solid-primitives/rootless';
// import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
// import { useIsRightbarChat } from '../../app/component/rightbar/signal';
// import tooltipStore, { closeTooltip } from './TooltipStore';

interface TooltipProps {
  text: string;
  color: 'red' | 'code' | 'folder' | 'canvas' | 'note' | 'email';
  position: 'top' | 'bottom' | 'left' | 'right';
  secondaryPosition?: 'top' | 'bottom' | 'left' | 'right';
  secondaryWidth?: number;
  storageKey: string;
  showHide?: boolean;
}

export default function Tooltip(_props: TooltipProps) {
  // const [position, setPosition] = createSignal<TooltipProps['position']>(
  //   props.position
  // );
  // let tooltipRef!: HTMLDivElement;
  // const isRightbarChat = useIsRightbarChat();

  // const {
  //   text,
  //   color,
  //   position: _position,
  //   secondaryPosition,
  //   secondaryWidth,
  //   storageKey,
  //   showHide,
  // } = props;

  // const getXY = createCallback(() => {
  //   if (position() === 'top') {
  //     return {
  //       top: '4px',
  //       left: '50%',
  //       transform: 'translateX(-50%) translateY(-100%)',
  //     };
  //   }

  //   if (position() === 'bottom') {
  //     return {
  //       bottom: '4px',
  //       left: '50%',
  //       transform: 'translateX(-50%) translateY(100%)',
  //     };
  //   }

  //   if (position() === 'left') {
  //     return {
  //       top: '50%',
  //       left: '4px',
  //       transform: 'translateY(-50%) translateX(-100%)',
  //     };
  //   }

  //   if (position() === 'right') {
  //     return {
  //       top: '50%',
  //       right: '4px',
  //       transform: 'translateY(-50%) translateX(100%)',
  //     };
  //   }
  // });

  // const getDirection = createCallback(() => {
  //   if (position() === 'top') {
  //     return 'flex-col';
  //   }
  //   if (position() === 'bottom') {
  //     return 'flex-col-reverse';
  //   }
  //   if (position() === 'left') {
  //     return 'flex-row';
  //   }
  //   if (position() === 'right') {
  //     return 'flex-row-reverse';
  //   }
  // });

  // const colorsDict = {
  //   red: {
  //     bg: 'bg-failure/50',
  //     dot: 'bg-failure',
  //     text: 'text-failure',
  //   },
  //   code: {
  //     bg: 'bg-code/60',
  //     dot: 'bg-code',
  //     text: 'text-code',
  //   },
  //   folder: {
  //     bg: 'bg-folder/60',
  //     dot: 'bg-folder',
  //     text: 'text-folder',
  //   },
  //   canvas: {
  //     bg: 'bg-canvas/60',
  //     dot: 'bg-canvas',
  //     text: 'text-canvas',
  //   },
  //   note: {
  //     bg: 'bg-note/60',
  //     dot: 'bg-note',
  //     text: 'text-note',
  //   },
  //   email: {
  //     bg: 'bg-email/60',
  //     dot: 'bg-email',
  //     text: 'text-email',
  //   },
  // };

  // const lineTranslateDict = {
  //   top: 'translate-x-1/2',
  //   bottom: '-translate-x-1/2',
  //   left: '-translate-y-1/2',
  //   right: '-translate-y-1/2',
  // };

  // const lineTranslate = createMemo(() => {
  //   return lineTranslateDict[position() as keyof typeof lineTranslateDict];
  // });

  // const colors = createMemo(() => {
  //   return colorsDict[color as keyof typeof colorsDict];
  // });

  // const lineStyles = createMemo(() => {
  //   return {
  //     width:
  //       position() === 'right' || position() === 'left' ? 'w-12' : 'w-[1px]',
  //     height:
  //       position() === 'right' || position() === 'left' ? 'h-[1px]' : 'h-12',
  //     backgroundColor: colors().bg,
  //   };
  // });

  // onMount(() => {
  //   if (isRightbarChat) {
  //     return;
  //   }

  //   const blockParent = tooltipRef.closest('[data-corvu-resizable-panel]');

  //   if (!blockParent || !secondaryPosition || !secondaryWidth) {
  //     return;
  //   }

  //   const resizeObserver = new ResizeObserver((entries) => {
  //     for (const entry of entries) {
  //       const { width } = entry.contentRect;

  //       if (width <= secondaryWidth && position() !== secondaryPosition) {
  //         setPosition(secondaryPosition);
  //       } else if (width > secondaryWidth && position() !== props.position) {
  //         setPosition(props.position);
  //       }
  //     }
  //   });

  //   // Start observing the resizable panel
  //   resizeObserver.observe(blockParent);

  //   // Cleanup observer on component unmount
  //   onCleanup(() => {
  //     resizeObserver.disconnect();
  //   });
  // });

  // if (isRightbarChat) {
  //   return null;
  // }

  return null;

  // return (
  //   <div
  //     ref={tooltipRef}
  //     class={`absolute hidden ${getDirection()} justify-center items-center gap-2 sm:flex transition-opacity duration-200 ${!tooltipStore[storageKey as keyof typeof tooltipStore] ? 'opacity-100' : 'opacity-0'} pointer-events-none`}
  //     style={{
  //       ...getXY(),
  //     }}
  //   >
  //     <p class={`whitespace-nowrap text-xs font-medium ${colors().text}`}>
  //       {text}
  //       <Show when={showHide}>
  //         {' ['}
  //         <span
  //           class="select-none underline cursor-pointer pointer-events-auto"
  //           onClick={() =>
  //             closeTooltip(storageKey as keyof typeof tooltipStore)
  //           }
  //         >
  //           {'hide'}
  //         </span>
  //         {']'}
  //       </Show>
  //     </p>

  //     <div class={`flex ${getDirection()} justify-center items-center`}>
  //       <div
  //         class={`${lineStyles().width} ${lineStyles().height} ${colors().bg} ${lineTranslate()}`}
  //       />
  //       <div
  //         class={`w-2 h-2 rounded-full ${colors().bg} flex items-center justify-center`}
  //       >
  //         <div
  //           class={`w-[6px] h-[6px] rounded-full ${colors().dot} animate-[ping_2s_ease-in-out_infinite]`}
  //         />
  //       </div>
  //     </div>
  //   </div>
  // );
}
