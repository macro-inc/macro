import { useLocation, useNavigate } from '@solidjs/router';
import {
  createSignal,
  For,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import reticle from './assets/creator-reticle.svg';
import { ChoiceGroup, PortraitControls } from './creator-controls';
import { OperatingProfile } from './creator-operating-profile';
import {
  intelligenceStops,
  sampleEstimates,
  sizeNames,
} from './creator-profile';
import {
  clearRestoredHireDraft,
  type Draft,
  defaultDraft,
  draftName,
  namePartLimit,
  readRestoredHireDraft,
  saveRestoredHireDraft,
  storeHireDraft,
  takeHireDraft,
} from './draft';
import { Portrait } from './portrait';
import {
  choices,
  optionLabel,
  type PresetId,
  presetShelf,
  presets,
  stageExamples,
} from './presets';
import { buildSignInUrl, hireIntent } from './return-intent';
import { fixtureTeamName } from './routes';
import { useSession } from './session';
import './creator.css';

const HirePanel = __BOTS_FIXTURES__
  ? lazy(() => import('./hire-panel'))
  : () => null;

export default function Creator() {
  const location = useLocation();
  const navigate = useNavigate();
  const identity = useSession();
  const [draft, setDraft] = createSignal(defaultDraft());
  const [restored, setRestored] =
    createSignal<ReturnType<typeof takeHireDraft>>();
  const [sampleSignedIn, setSampleSignedIn] = createSignal(false);
  const [reviewOpen, setReviewOpen] = createSignal(false);
  const [reviewPending, setReviewPending] = createSignal(false);
  const [storageUnavailable, setStorageUnavailable] = createSignal(false);
  const [pose, setPose] = createSignal(0);
  let dialog: HTMLDialogElement | undefined;
  let hireButton: HTMLButtonElement | undefined;
  let hireStrip: HTMLDivElement | undefined;
  let drag: { id: number; start: number } | undefined;

  const name = () => draftName(draft());
  const hireLabel = () => `Hire ${name()}`;
  const angleLabels = [
    'Left',
    'Slightly left',
    'Front',
    'Slightly right',
    'Right',
  ];
  const angleLabel = () => angleLabels[pose() + 2];

  onMount(() => {
    const strip = hireStrip;
    if (!strip) return;

    const root = document.documentElement;
    const resize = new ResizeObserver(() => {
      root.style.setProperty(
        '--creator-hire-height',
        `${Math.ceil(strip.getBoundingClientRect().height)}px`
      );
    });
    resize.observe(strip);
    onCleanup(() => {
      resize.disconnect();
      root.style.removeProperty('--creator-hire-height');
    });
  });

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const handoffs = params.getAll('handoff');
    const returning = handoffs.length > 0;

    try {
      let result: ReturnType<typeof takeHireDraft>;
      if (returning) {
        if (
          params.size === 2 &&
          handoffs.length === 1 &&
          params.get('intent') === 'hire'
        ) {
          result = takeHireDraft(sessionStorage, handoffs[0]);
        }
      } else {
        result = readRestoredHireDraft(sessionStorage);
      }

      if (result) {
        setDraft(result.draft);
        setRestored(result);
        if (__BOTS_FIXTURES__ && result.sampleSignedIn) {
          setSampleSignedIn(true);
          if (returning) openReview();
        }
      }
    } catch {
      setStorageUnavailable(true);
      return;
    }

    if (returning) navigate('/', { replace: true, scroll: false });
  });

  function openReview() {
    if (!dialog || dialog.open) return;

    setReviewOpen(true);
    dialog.showModal();
  }

  function closeReview() {
    setReviewOpen(false);
    hireButton?.focus();
  }

  function updateDraft(change: Partial<Draft>) {
    const updated = setDraft((previous) => ({ ...previous, ...change }));
    const existing = restored();
    if (!existing) return;

    try {
      saveRestoredHireDraft(sessionStorage, { ...existing, draft: updated });
    } catch {
      setStorageUnavailable(true);
    }
  }

  function selectPreset(id: PresetId) {
    const { first, last, look } = presets[id];
    const current = draft();

    setPose(0);
    updateDraft({
      preset: id,
      first: current.firstEdited ? current.first : first,
      last: current.lastEdited ? current.last : last,
      look: {
        ...look,
        gender: current.genderEdited ? current.look.gender : look.gender,
      },
    });
  }

  function startHire() {
    if (sampleSignedIn()) {
      openReview();
      return;
    }

    try {
      const handoff = storeHireDraft(sessionStorage, draft());
      navigate(buildSignInUrl(hireIntent, handoff));
    } catch {
      setStorageUnavailable(true);
    }
  }

  function finishHire() {
    setRestored(undefined);
    try {
      clearRestoredHireDraft(sessionStorage);
    } catch {
      setStorageUnavailable(true);
    }
  }

  function setAngle(value: number) {
    setPose(Math.min(2, Math.max(-2, value)));
  }

  function PresetCards(props: { ids: readonly PresetId[] }) {
    return (
      <For each={props.ids}>
        {(id) => (
          <button
            type="button"
            aria-pressed={draft().preset === id}
            onClick={() => selectPreset(id)}
          >
            <Portrait preset={id} look={presets[id].look} />
            <span>{presets[id].label}</span>
          </button>
        )}
      </For>
    );
  }

  return (
    <div class="creator">
      <section class="stage" aria-label="Portrait preview">
        <div class="creator-stage-portrait">
          <div class="portrait-frame">
            <div
              class="creator-pose-handle"
              title="Drag to angle portrait"
              role="slider"
              tabIndex={0}
              aria-label="Portrait angle"
              aria-valuemin={-2}
              aria-valuemax={2}
              aria-valuenow={pose()}
              aria-valuetext={angleLabel()}
              onKeyDown={(event) => {
                const key = event.key;
                if (
                  ![
                    'ArrowLeft',
                    'ArrowRight',
                    'ArrowDown',
                    'ArrowUp',
                    'Home',
                    'End',
                  ].includes(key)
                )
                  return;
                event.preventDefault();
                if (key === 'Home') setAngle(-2);
                else if (key === 'End') setAngle(2);
                else
                  setAngle(
                    pose() +
                      (key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 1)
                  );
              }}
              onPointerDown={(event) => {
                if (!event.isPrimary || event.button !== 0) return;
                drag = {
                  id: event.pointerId,
                  start: event.clientX - pose() * 26,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (drag?.id === event.pointerId)
                  setAngle(Math.round((event.clientX - drag.start) / 26));
              }}
              onLostPointerCapture={() => {
                drag = undefined;
              }}
            >
              <div class="creator-scene">
                <Portrait
                  preset={draft().preset}
                  look={draft().look}
                  pose={pose()}
                />
              </div>
            </div>
            <img class="creator-reticle" src={reticle} alt="" />
          </div>
          <h1>{name()}</h1>
          <div
            class="creator-orbit"
            role="group"
            aria-label="Portrait rotation"
          >
            <button
              type="button"
              aria-label="Rotate portrait left"
              disabled={pose() === -2}
              onClick={() => setAngle(pose() - 1)}
            >
              <span aria-hidden="true">←</span>
            </button>
            <output aria-live="polite">{angleLabel()}</output>
            <button
              type="button"
              aria-label="Rotate portrait right"
              disabled={pose() === 2}
              onClick={() => setAngle(pose() + 1)}
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
        <div class="creator-examples">
          <h2 class="eyebrow">Examples</h2>
          <div role="group" aria-label="Examples">
            <PresetCards ids={stageExamples} />
          </div>
        </div>
      </section>
      <section class="panel controls" aria-label="Customize portrait">
        <PortraitControls
          look={draft().look}
          tab={draft().tab}
          onTab={(tab) => updateDraft({ tab })}
          onLook={(look) => updateDraft({ look })}
        />
        <div class="creator-preset-controls">
          <ChoiceGroup
            label="Gender"
            value={draft().look.gender}
            options={choices.gender}
            columns={3}
            onChange={(gender) =>
              updateDraft({
                look: { ...draft().look, gender },
                genderEdited: true,
              })
            }
          />
          <div class="creator-shelf">
            <h2 class="eyebrow">Start from</h2>
            <div class="presets" role="group" aria-label="Start from">
              <PresetCards ids={presetShelf} />
            </div>
          </div>
        </div>
      </section>
      <section class="panel profile" aria-labelledby="hire-heading">
        <div class="profile-heading">
          <div class="eyebrow">Bot profile</div>
          <h2 id="hire-heading">Hire teammate</h2>
          <p>A teammate for Macro, with its own email once set up.</p>
        </div>
        <div class="names">
          <label>
            First name
            <input
              value={draft().first}
              maxLength={namePartLimit}
              onInput={(event) =>
                updateDraft({
                  first: event.currentTarget.value,
                  firstEdited: Boolean(event.currentTarget.value.trim()),
                })
              }
            />
          </label>
          <label>
            Last name
            <input
              value={draft().last}
              maxLength={namePartLimit}
              onInput={(event) =>
                updateDraft({
                  last: event.currentTarget.value,
                  lastEdited: Boolean(event.currentTarget.value.trim()),
                })
              }
            />
          </label>
        </div>
        <div class="profile-summary">
          <Portrait preset={draft().preset} look={draft().look} />
          <div>
            <strong>{name()}</strong>
            <Show
              when={
                (__BOTS_FIXTURES__ && sampleSignedIn()) ||
                identity()?.status === 'signed-in'
              }
            >
              <p>
                {__BOTS_FIXTURES__ && sampleSignedIn()
                  ? fixtureTeamName
                  : 'Team verified'}
              </p>
            </Show>
            <p class="creator-look-summary">
              {[
                optionLabel(choices.gender, draft().look.gender),
                optionLabel(choices.hair, draft().look.hair),
                optionLabel(choices.outfit, draft().look.outfit),
              ].join(' · ')}
            </p>
          </div>
        </div>
        <OperatingProfile draft={draft()} onChange={updateDraft} />
        <div
          class="hire"
          ref={(element) => {
            hireStrip = element;
          }}
        >
          <div class="creator-mobile-hire-summary">
            {sizeNames[draft().size]} ·{' '}
            {intelligenceStops[draft().intelligence].label}
            <span>
              {__BOTS_FIXTURES__
                ? `Sample ${sampleEstimates[draft().size][draft().intelligence]}`
                : 'Price unavailable'}
            </span>
          </div>
          <button
            type="button"
            class="primary"
            disabled={
              __BOTS_NATIVE__ &&
              (identity.loading || identity()?.status !== 'signed-out')
            }
            onClick={startHire}
            ref={(element) => {
              hireButton = element;
            }}
          >
            {hireLabel()}
          </button>
          {!__BOTS_FIXTURES__ && (
            <p>
              Hire is unavailable until the team and purchase terms can be
              verified.
            </p>
          )}
          <Show when={restored() && !sampleSignedIn()}>
            <p role="status">Draft restored.</p>
          </Show>
          <Show when={storageUnavailable()}>
            <p role="status">Draft handoff requires browser session storage.</p>
          </Show>
        </div>
      </section>
      {__BOTS_FIXTURES__ && (
        <dialog
          ref={(element) => {
            dialog = element;
          }}
          class="panel creator-hire-dialog"
          aria-labelledby="creator-hire-title"
          onClose={(event) => {
            if (!event.currentTarget.open) closeReview();
          }}
          onCancel={(event) => {
            event.preventDefault();
            if (!reviewPending()) {
              event.currentTarget.close();
              closeReview();
            }
          }}
        >
          <header class="creator-review-heading">
            <div>
              <div class="eyebrow">Sample Hire</div>
              <h2 id="creator-hire-title">{hireLabel()}</h2>
            </div>
            <form method="dialog">
              <button
                type="submit"
                aria-label="Close Hire review"
                disabled={reviewPending()}
                autofocus
              >
                ×
              </button>
            </form>
          </header>
          <Show when={reviewOpen()}>
            <Suspense fallback={<p role="status">Loading Hire review…</p>}>
              <HirePanel
                draft={draft()}
                onAccepted={finishHire}
                onPending={setReviewPending}
              />
            </Suspense>
          </Show>
        </dialog>
      )}
    </div>
  );
}
