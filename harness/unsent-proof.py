p='/home/teo/.cache/channels-perf-b/writes-queued.cjs'
s=open(p).read()
a=s.index("  await step('send_after_failures'")
new=r"""  await step('unsent_indicator', async () => {
    const tag = `q-unsent-${Date.now()}`;
    const block = await intercept('SendChannelMessage', (route) => route.abort('internetdisconnected'));
    await send(tag); await L.waitFor(async () => ((await rows(tag)) > 0 ? true : null), { timeout: 5000, interval: 5 });
    const look = () => page.evaluate((t) => { const n = [...document.querySelectorAll('[data-channel-scroll] [data-message-id]')].filter((x) => (x.textContent || '').includes(t)).pop(); return n ? { label: !!n.querySelector('[data-message-unsent]'), opacity: getComputedStyle(n).opacity } : null; }, tag);
    await L.sleep(2000); const at2s = await look();
    await L.sleep(4500); const at6s = await look(); await page.screenshot({ path: path.join(L.OUT, 'unsent-indicator.png') });
    await block.stop();
    await L.waitFor(async () => { const v = await look(); return v && !v.label ? true : null; }, { timeout: 120_000, interval: 200 });
    await L.sleep(500);
    return { at2s, at6s, afterDelivery: await look(), server: await serverCount([tag]) };
  });

"""
s=s[:a]+new+s[a:]
open(p,'w').write(s)
