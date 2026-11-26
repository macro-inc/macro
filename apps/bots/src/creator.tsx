import * as Slider from '@kobalte/core/slider';
import { useLocation, useNavigate } from '@solidjs/router';
import { createSignal, For, onMount } from 'solid-js';
import { storeHireDraft, takeHireDraft } from './draft';
import { creatorPresets, sampleSurnames } from './presets';
import { buildSignInUrl, hireIntent } from './return-intent';

export default function Creator() {
  const location = useLocation();
  const navigate = useNavigate();
  const [portrait, setPortrait] = createSignal(0);
  const preset = () => creatorPresets[portrait()] ?? creatorPresets[0];
  const [first, setFirst] = createSignal(
    __BOTS_FIXTURES__ ? preset().label : ''
  );
  const [last, setLast] = createSignal(
    __BOTS_FIXTURES__ ? sampleSurnames[0] : ''
  );
  const [width, setWidth] = createSignal(0);
  const [resume, setResume] = createSignal(false);
  const [storageUnavailable, setStorageUnavailable] = createSignal(false);

  onMount(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('handoff')) return;

    if (params.size === 2 && params.get('intent') === 'hire') {
      try {
        const draft = takeHireDraft(
          sessionStorage,
          params.get('handoff') ?? ''
        );
        if (draft && draft.portrait < creatorPresets.length) {
          setFirst(draft.first);
          setLast(draft.last);
          setPortrait(draft.portrait);
          setWidth(draft.width);
          setResume(true);
        }
      } catch {
        // Storage may be disabled by the browser.
      }
    }

    navigate('/', { replace: true, scroll: false });
  });

  function startHire() {
    let handoff: string | undefined;
    try {
      handoff = storeHireDraft(sessionStorage, {
        first: first(),
        last: last(),
        portrait: portrait(),
        width: width(),
      });
    } catch {
      setStorageUnavailable(true);
      return;
    }

    navigate(buildSignInUrl(hireIntent, handoff));
  }

  const name = () =>
    [first().trim(), last().trim()].filter(Boolean).join(' ') || 'Unnamed bot';

  return (
    <div class="creator">
      <section class="panel controls" aria-label="Customize portrait">
        <Slider.Root
          class="width-slider"
          value={[width()]}
          minValue={-20}
          maxValue={20}
          onChange={([value]) => setWidth(value)}
        >
          <div class="slider-label">
            <Slider.Label>Face width</Slider.Label>
            <output>{width()}</output>
          </div>
          <Slider.Track class="slider-track">
            <Slider.Fill class="slider-fill" />
            <Slider.Thumb class="slider-thumb">
              <Slider.Input aria-hidden="true" />
            </Slider.Thumb>
          </Slider.Track>
        </Slider.Root>
        <div class="range-labels">
          <span>Narrow</span>
          <span>Wide</span>
        </div>
        <h2>Start from</h2>
        <div class="presets">
          <For each={creatorPresets}>
            {(sample, index) => (
              <button
                type="button"
                aria-pressed={preset() === sample}
                onClick={() => {
                  setPortrait(index());
                  if (__BOTS_FIXTURES__) {
                    setFirst(sample.label);
                    setLast(sampleSurnames[index()]);
                  }
                  setWidth(0);
                }}
              >
                <img src={sample.portrait} alt="" />
                {sample.label}
              </button>
            )}
          </For>
        </div>
      </section>
      <section class="stage" aria-label="Portrait preview">
        <div class="portrait-frame">
          <img
            src={preset().portrait}
            alt=""
            style={{ transform: `scaleX(${1 + width() / 100})` }}
          />
        </div>
        <h1>{name()}</h1>
      </section>
      <section class="panel profile" aria-labelledby="hire-heading">
        <div class="profile-heading">
          <div class="eyebrow">Bot profile</div>
          <h2 id="hire-heading">Hire teammate</h2>
          <p>Name your bot and preview its portrait.</p>
        </div>
        <div class="names">
          <label>
            First name
            <input
              value={first()}
              maxLength={40}
              onInput={(event) => setFirst(event.currentTarget.value)}
            />
          </label>
          <label>
            Last name
            <input
              value={last()}
              maxLength={40}
              onInput={(event) => setLast(event.currentTarget.value)}
            />
          </label>
        </div>
        <div class="profile-summary">
          <img src={preset().portrait} alt="" />
          <div>
            <strong>{name()}</strong>
            <p>Draft</p>
          </div>
        </div>
        <div class="hire">
          <button type="button" class="primary" onClick={startHire}>
            Hire {name()}
          </button>
          {resume() && (
            <p role="status">Draft restored. Sign in to continue hiring.</p>
          )}
          {storageUnavailable() && (
            <p role="status">Draft handoff requires browser session storage.</p>
          )}
        </div>
      </section>
    </div>
  );
}
