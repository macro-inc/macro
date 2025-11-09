// import { createEffect, createSignal, For, onMount } from 'solid-js';
// import { computeToken } from './colorUtil';
// import { themeUpdate } from './themeReactive';

// export async function copyTokens() {
//   let tokenList: string[] = [];
//   const rootStyles = getComputedStyle(document.documentElement);
//   Object.entries(rootStyles).forEach(([_property, value]) => {
//     if (value.startsWith('--color')) {
//       tokenList.push(value);
//     }
//   });
//   tokenList.forEach((token) => {
//     token = computeToken(rootStyles.getPropertyValue(token));
//   });
//   try {
//     const jsonString = JSON.stringify(tokenList, null, 2);
//     await navigator.clipboard.writeText(jsonString);
//   } catch (err) {
//     console.error('Failed to copy: ', err);
//   }
// }

// export function ComputeTokens() {
//   const [computed, setComputed] = createSignal<Record<string, string>>({});
//   let copyRef!: HTMLInputElement;
//   let tokenList: string[] = [];

//   function getTokens() {
//     const rootStyles = getComputedStyle(document.documentElement);
//     Object.entries(rootStyles).forEach(([_property, value]) => {
//       if (value.startsWith('--color')) {
//         tokenList.push(value);
//       }
//     });
//   }

//   async function copyTokens() {
//     try {
//       const jsonString = JSON.stringify(computed(), null, 2);
//       await navigator.clipboard.writeText(jsonString);
//       copyRef.innerHTML = '&nbsp;&nbsp;copied!&nbsp;&nbsp;';
//       setTimeout(() => {
//         copyRef.innerHTML = 'copy tokens';
//       }, 500);
//     } catch (err) {
//       console.error('Failed to copy: ', err);
//     }
//   }

//   function computeTokens() {
//     const rootStyles = getComputedStyle(document.documentElement);
//     setComputed((prev) => {
//       tokenList.forEach((token) => {
//         prev[token] = computeToken(rootStyles.getPropertyValue(token));
//       });
//       return { ...prev };
//     });
//     console.log('compute tokens');
//   }

//   onMount(() => {
//     getTokens();
//   });

//   createEffect(() => {
//     themeUpdate();
//     computeTokens();
//   });

//   return (
//     <>
//       <style>{`
//         .compute-theme{
//           font-family: "Forma DJR Mono";
//           border: 1px solid var(--b4);
//           box-sizing: border-box;
//           position: relative;
//           font-size: 14px;
//           display: grid;
//           height: 100%;
//         }
//         .copy-button{
//           transform: translateX(calc(-100% - 20px));
//           background-color: var(--a0);
//           position: absolute;
//           line-height: 20px;
//           text-wrap: nowrap;
//           padding: 0px 20px;
//           user-select: none;
//           color: var(--b0);
//           cursor: copy;
//           left: 100%;
//           top: 20px;
//         }
//         .compute-tokens{
//           overscroll-behavior: none;
//           box-sizing: border-box;
//           scrollbar-width: none;
//           overflow-y: scroll;
//           min-height: 0;
//           padding: 20px;
//           width: 100%;
//         }
//         .token-item{
//           margin-bottom: 8px;
//           color: var(--c0);
//         }
//       `}</style>

//       <div class="compute-theme">
//         <div class="copy-button" ref={copyRef} onPointerDown={copyTokens}>
//           copy tokens
//         </div>
//         <div class="compute-tokens">
//           <For each={Object.entries(computed())}>
//             {([token, value]) => (
//               <>
//                 {token}: {value}
//                 <br />
//               </>
//             )}
//           </For>
//         </div>
//       </div>
//     </>
//   );
// }
