import { type Component, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

// Monochrome brand marks for the comparison-table headers. They inherit the
// header text color via `currentColor` (no accent/brand color of their own).

export function MacroLogo() {
  return (
    <svg
      class="mvn-logo-macro"
      viewBox="0 0 182 119"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M0.121368 44.5707V94.6784L0.123097 94.8165C0.140592 95.5053 0.289921 96.1847 0.563153 96.8184C0.854625 97.4943 1.28114 98.1038 1.8166 98.6094L22.5065 118.144L37.6081 112.239V59.7876L15.2084 38.6654L0.121368 44.5707Z" />
      <path d="M30.89 6.04832V48.797L41.1458 58.4696V68.173L94.2982 118.349L109.4 112.444L109.392 59.9907L45.9767 0.140625L30.89 6.04832Z" />
      <path d="M102.685 6.04936V48.7977L112.948 58.4841L112.848 68.0867L166.111 118.35L181.197 112.445V62.3371C181.198 61.6013 181.047 60.8733 180.756 60.1975C180.465 59.5216 180.038 58.9121 179.503 58.4065L117.789 0.140625L102.685 6.04936Z" />
    </svg>
  );
}

export function LinearLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />
    </svg>
  );
}

export function NotionLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" />
    </svg>
  );
}

export function SlackLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
    </svg>
  );
}

export function SuperhumanLogo() {
  return (
    <svg viewBox="0 0 23 23" fill="currentColor" aria-hidden="true">
      <path d="M22.3826 6.22157C22.1402 3.17618 19.718 0.759886 16.6746 0.523503C13.2525 0.259071 9.81644 0.261063 6.3944 0.533481C3.34902 0.773957 0.932736 3.19625 0.696353 6.24163C0.431921 9.66367 0.433913 13.0997 0.706346 16.5217C0.948815 19.5671 3.3711 21.9834 6.4145 22.2198C9.83653 22.4843 13.2725 22.4823 16.6946 22.2098C19.74 21.9673 22.1563 19.545 22.3927 16.5018C22.6572 13.0797 22.6552 9.6436 22.3826 6.22157ZM11.5715 3.84741C12.8036 3.84741 13.8014 4.84317 13.8014 6.07133C13.8014 7.29949 12.8036 8.29525 11.5715 8.29525C10.3393 8.29525 9.34159 7.29949 9.34159 6.07133C9.34159 4.84317 10.3393 3.84741 11.5715 3.84741ZM15.779 18.4993H15.781L11.9101 16.3796C11.6997 16.2634 11.4432 16.2634 11.2329 16.3796L7.36202 18.4993C6.73891 18.8399 6.0598 18.1487 6.41838 17.5395L10.9664 9.83397C11.2369 9.37517 11.9041 9.37517 12.1745 9.83397L16.7226 17.5395C17.0812 18.1487 16.4041 18.8399 15.779 18.4993Z" />
    </svg>
  );
}

export function ClickUpLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M2 18.439l3.69-2.828c1.961 2.56 4.044 3.739 6.363 3.739 2.307 0 4.33-1.166 6.203-3.704L22 18.405C19.298 22.065 15.941 24 12.053 24 8.178 24 4.788 22.078 2 18.439zM12.036 5.612l-6.58 5.666-3.098-3.598L12.05 0l9.634 7.688-3.11 3.588z" />
    </svg>
  );
}

export type ComparisonRow = {
  feature: string;
  macro: string;
  them: string;
  /** Render the competitor cell in the muted "not available" color. */
  themNo?: boolean;
};

/** Merged comparison table that fades out below a fixed height with a
 * "Show more" affordance (mirrors the /crm page pattern). */
export function ComparisonTable(props: {
  competitor: string;
  logo: Component;
  rows: ComparisonRow[];
}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <div class="mvn-collapse">
      <div
        classList={{ 'mvn-collapse-inner': true, 'is-collapsed': !expanded() }}
      >
        <div class="mvn-table-wrap">
          <table class="mvn-table">
            <thead>
              <tr>
                <th />
                <th class="mvn-macro-col">
                  <span class="mvn-th-brand">
                    <MacroLogo /> Macro
                  </span>
                </th>
                <th>
                  <span class="mvn-th-brand">
                    <Dynamic component={props.logo} /> {props.competitor}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={props.rows}>
                {(row) => (
                  <tr>
                    <th scope="row">{row.feature}</th>
                    <td class="mvn-macro-col">{row.macro}</td>
                    <td classList={{ 'mvn-no': !!row.themNo }}>{row.them}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
      <Show when={!expanded()}>
        <button
          type="button"
          class="mvn-showmore"
          onClick={() => setExpanded(true)}
        >
          <span>Show more</span>
        </button>
      </Show>
    </div>
  );
}
