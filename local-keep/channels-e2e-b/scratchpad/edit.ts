const path = 'unread.spec.ts';
const text = await Bun.file(path).text();
const from = `  await chooseFromRowMenu(
    page,
    row,
    'Mute notifications',
    'Until I turn it off'
  );
  await expect(mutedBell(row)).toBeVisible();

  await ben.post(made.muted, 'while muted');`;
const to = `  // The submenu's entries are sometimes made again while it is open; the one
  // with the keyboard is then gone, and Enter chooses nothing.
  const mute = () =>
    chooseFromRowMenu(page, row, 'Mute notifications', 'Until I turn it off');
  await failsSometimes(async () => {
    await mute();
    await expect(mutedBell(row)).toBeVisible({ timeout: 5_000 });
  });
  if ((await mutedBell(row).count()) === 0) await mute();
  await expect(mutedBell(row)).toBeVisible();

  await ben.post(made.muted, 'while muted');`;
if (!text.includes(from)) throw new Error('no match');
await Bun.write(path, text.replace(from, to));
