// Progressive enhancement only: the page reads in full without this file.

const STEP_COUNT = 4;
const STEP_PLAY_MS = 1700;

function setUpStage() {
  const stage = document.querySelector('[data-stage]');
  const stepButtons = document.querySelectorAll('[data-step-button]');
  const playButton = document.querySelector('[data-play]');
  if (!stage || !playButton) return;

  let playTimer;

  function showStep(step) {
    stage.dataset.step = String(step);

    for (const button of stepButtons) {
      if (button.dataset.stepButton === String(step)) {
        button.setAttribute('aria-current', 'step');
      } else {
        button.removeAttribute('aria-current');
      }
    }
  }

  function stopPlaying() {
    clearTimeout(playTimer);
    playTimer = undefined;
  }

  function playFrom(step) {
    showStep(step);
    if (step >= STEP_COUNT) {
      stopPlaying();
      return;
    }

    playTimer = setTimeout(() => playFrom(step + 1), STEP_PLAY_MS);
  }

  for (const button of stepButtons) {
    button.addEventListener('click', () => {
      stopPlaying();
      showStep(Number(button.dataset.stepButton));
    });
  }

  playButton.addEventListener('click', () => {
    stopPlaying();
    playFrom(1);
  });

  // A chip and the thing it points at light up together, in both directions.
  function setLit(reference, lit) {
    const linked = stage.querySelectorAll(
      `[data-ref="${reference}"], [data-pane="${reference}"]`
    );
    for (const element of linked) element.classList.toggle('lit', lit);
  }

  for (const chip of stage.querySelectorAll('[data-ref]')) {
    chip.addEventListener('pointerenter', () => setLit(chip.dataset.ref, true));
    chip.addEventListener('pointerleave', () => setLit(chip.dataset.ref, false));
  }
}

function setUpBlocks() {
  const nav = document.querySelector('[data-blocks-nav]');
  const blocks = [...document.querySelectorAll('[data-block]')];
  if (!nav || blocks.length === 0) return;

  const tabs = blocks.map((block) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = `tab-${block.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', block.id);
    tab.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${block.dataset.icon}" /></svg>`;
    tab.append(block.dataset.block);
    nav.append(tab);

    block.setAttribute('role', 'tabpanel');
    block.setAttribute('aria-labelledby', tab.id);
    return tab;
  });

  function select(index, { focus = false } = {}) {
    blocks.forEach((block, blockIndex) => {
      const selected = blockIndex === index;
      block.hidden = !selected;
      tabs[blockIndex].setAttribute('aria-selected', String(selected));
      tabs[blockIndex].tabIndex = selected ? 0 : -1;
    });

    if (focus) tabs[index].focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      select(index);
      // On a phone the tabs are one scrolling row; keep the chosen one in view.
      tab.scrollIntoView({ block: 'nearest', inline: 'center' });
    });

    tab.addEventListener('keydown', (event) => {
      const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
      const backward = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
      if (!forward && !backward) return;

      event.preventDefault();
      const offset = forward ? 1 : -1;
      select((index + offset + tabs.length) % tabs.length, { focus: true });
    });
  });

  // A link to a Block (the hero headline has four) opens that Block's tab.
  // The Block is shown before the browser follows the link, so the browser's
  // own scrolling, history and focus handling all still apply.
  function selectFromHash(hash) {
    const index = blocks.findIndex((block) => `#${block.id}` === hash);
    if (index === -1) return false;

    select(index);
    return true;
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const link = event.target.closest('a[href^="#"]');
    if (link) selectFromHash(link.getAttribute('href'));
  });

  window.addEventListener('hashchange', () => selectFromHash(location.hash));

  if (selectFromHash(location.hash)) {
    // On a direct load the browser scrolled before the other Blocks were
    // hidden, so the target has moved since.
    document.getElementById(location.hash.slice(1)).scrollIntoView();
  } else {
    select(0);
  }
}

const COPY_RESET_MS = 1600;

function setUpCopy() {
  for (const button of document.querySelectorAll('[data-copy]')) {
    const source = document.getElementById(button.dataset.copy);
    const label = button.querySelector('[data-copy-label]');
    if (!source || !label) continue;

    let resetTimer;

    button.addEventListener('click', async () => {
      clearTimeout(resetTimer);

      try {
        await navigator.clipboard.writeText(source.textContent);
        label.textContent = 'Copied';
      } catch {
        // Some embedded views refuse clipboard writes; select the text instead.
        getSelection().selectAllChildren(source);
        label.textContent = 'Selected';
      }

      resetTimer = setTimeout(() => {
        label.textContent = 'Copy';
      }, COPY_RESET_MS);
    });
  }
}

const KEY_PRESS_MS = 180;

function setUpKeys() {
  const keys = [...document.querySelectorAll('[data-key]')];
  if (keys.length === 0) return;

  document.addEventListener('keydown', (event) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('input, textarea, [contenteditable]')) return;

    const pressed = event.key.toLowerCase();
    for (const key of keys) {
      if (!key.dataset.key.split(' ').includes(pressed)) continue;

      key.classList.add('pressed');
      setTimeout(() => key.classList.remove('pressed'), KEY_PRESS_MS);
    }
  });
}

setUpStage();
setUpBlocks();
setUpCopy();
setUpKeys();
