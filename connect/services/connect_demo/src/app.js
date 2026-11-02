let latestRequest = 0;

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('ajax')) return;
  event.preventDefault();
  const workspace = document.getElementById('workspace');
  if (!workspace) return;
  const requestId = ++latestRequest;
  workspace.textContent = 'Loading tools…';
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      body: new URLSearchParams(new FormData(form)),
      credentials: 'same-origin',
    });
    const html = await response.text();
    if (requestId !== latestRequest) return;
    workspace.innerHTML = html;
  } catch {
    if (requestId !== latestRequest) return;
    workspace.textContent = 'The demo could not reach the service.';
  }
  workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
