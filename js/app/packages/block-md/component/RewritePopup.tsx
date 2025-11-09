// import { rewriteMarkdown } from '@block-md/signal/rewriteSignal';
// import { createBlockSignal, useBlockId } from '@core/block';
// import { Dialog } from '@kobalte/core/dialog';
// import { RadioGroup } from '@kobalte/core/radio-group';
// import { createEffect, createSignal, For, Show } from 'solid-js';

// export const rewritePopupOpenSignal = createBlockSignal<boolean>(false);

// export function RewritePopup() {
//   const [rewritePopupOpen, setRewritePopupOpen] = rewritePopupOpenSignal;
//   const [input, setInput] = createSignal<string>('');
//   const [inputRef, setInputRef] = createSignal<HTMLTextAreaElement | undefined>(
//     undefined
//   );

//   const REWRITE_OPTIONS = new Map([
//     [
//       'CUSTOM',
//       {
//         label: 'Custom',
//         description:
//           "Provide specific instructions for how you'd like your text transformed.",
//       },
//     ],
//     [
//       'SPELLING_GRAMMAR',
//       {
//         label: 'Check Spelling & Grammar',
//         description:
//           'Correct errors in spelling, grammar, and punctuation for error-free text.',
//       },
//     ],
//     [
//       'SIMPLIFY_CLARIFY',
//       {
//         label: 'Simplify & Clarify',
//         description:
//           'Reduce complexity, eliminate jargon, and improve readability for wider audiences.',
//       },
//     ],
//     [
//       'PROFESSIONAL_POLISH',
//       {
//         label: 'Professional Polish',
//         description:
//           'Enhance business-appropriate language, structure, and tone for workplace communication.',
//       },
//     ],
//   ]);

//   const [selectedOption, setSelectedOption] = createSignal<string>(
//     Array.from(REWRITE_OPTIONS.keys())[0]
//   );

//   const handleRewrite = () => {
//     setRewritePopupOpen(false);

//     const option = selectedOption();
//     let rewriteInstructions = '';
//     if (option === 'CUSTOM') {
//       const _input = input();
//       if (!_input) {
//         return;
//       }
//       rewriteInstructions = _input;
//     } else {
//       const description = REWRITE_OPTIONS.get(option)?.description;
//       if (!description) {
//         return;
//       }
//       rewriteInstructions = description;
//     }

//     rewriteMarkdown({ input: rewriteInstructions });
//   };

//   createEffect(() => {
//     const isOpen = rewritePopupOpen();
//     if (isOpen) {
//       inputRef()?.focus();
//       setInput('');
//       setSelectedOption(Array.from(REWRITE_OPTIONS.keys())[0]);
//     }
//   });

//   return (
//     <Dialog open={rewritePopupOpen()} onOpenChange={setRewritePopupOpen}>
//       <Dialog.Overlay class="fixed flex inset-0 bg-modal-overlay items-center justify-center z-modal-overlay portal-scope">
//         <Dialog.Content class="w-[440px] text-ink max-h-[100%] my-auto overflow-y-auto z-modal-content">
//           <div class="bg-dialog w-full shadow-xl rounded-xl p-2.5 ring-1 ring-edge">
//             <div class="flex flex-col gap-2 p-2">
//               <label class="text-ink font-medium text-xl mb-1">
//                 How would you like document rewritten?
//               </label>

//               <RadioGroup
//                 value={selectedOption()}
//                 onChange={setSelectedOption}
//                 class="-space-y-px rounded-md bg-menu"
//               >
//                 <div>
//                   <For each={Array.from(REWRITE_OPTIONS.keys())}>
//                     {(_option: string) => {
//                       const option = REWRITE_OPTIONS.get(_option);
//                       if (!option) {
//                         return;
//                       }

//                       return (
//                         <RadioGroup.Item
//                           value={_option}
//                           disabled={false}
//                           onClick={() => {
//                             setSelectedOption(_option);
//                           }}
//                           class="group relative flex cursor-pointer p-2 rounded-md  focus:outline-none data-[checked]:bg-active"
//                         >
//                           <RadioGroup.ItemInput class="peer" />
//                           <RadioGroup.ItemControl class="relative mt-0.5 h-4 w-4 shrink-0 rounded-full border border-edge bg-menu">
//                             <RadioGroup.ItemIndicator class="absolute inset-0 flex items-center justify-center">
//                               <div class="h-2 w-2 rounded-full bg-ink" />
//                             </RadioGroup.ItemIndicator>
//                           </RadioGroup.ItemControl>
//                           <span class="ml-3 mr-2 flex flex-col w-full">
//                             <RadioGroup.ItemLabel class="block text-sm font-medium text-ink group-data-[checked]:text-ink">
//                               {option.label}
//                             </RadioGroup.ItemLabel>
//                             <Show
//                               when={_option === 'CUSTOM'}
//                               fallback={
//                                 <RadioGroup.ItemDescription class="block text-sm text-ink-muted group-data-[checked]:text-ink">
//                                   {option.description}
//                                 </RadioGroup.ItemDescription>
//                               }
//                             >
//                               <textarea
//                                 class={`flex resize-none rounded-md w-full p-[0.35rem] my-3 text-sm h-max-[800px] overflow-hidden border-[1.5] border-edge`}
//                                 ref={setInputRef}
//                                 rows={5}
//                                 onSubmit={(e) => e.preventDefault()}
//                                 placeholder={
//                                   "Provide instructions for how you'd like your document revised."
//                                 }
//                                 onInput={(e) => {
//                                   setInput(e.currentTarget.value);
//                                   e.target.style.height = 'auto';
//                                   e.target.style.height = `${e.target.scrollHeight}px`;
//                                 }}
//                                 onKeyDown={(e) => {
//                                   if (e.key === 'Enter' && !e.shiftKey) {
//                                     e.preventDefault();
//                                     handleRewrite();
//                                   }
//                                 }}
//                                 onMouseDown={() => {
//                                   setSelectedOption('CUSTOM');
//                                 }}
//                               />
//                             </Show>
//                           </span>
//                         </RadioGroup.Item>
//                       );
//                     }}
//                   </For>
//                 </div>
//               </RadioGroup>
//               <button
//                 class="bg-accent/90 text-ink rounded px-3 py-[0.375rem] text-sm mt-1 hover:bg-active hover-transition-bg transition w-[95%] mx-auto"
//                 onClick={handleRewrite}
//               >
//                 Rewrite Document
//               </button>
//             </div>
//           </div>
//         </Dialog.Content>
//       </Dialog.Overlay>
//     </Dialog>
//   );
// }
