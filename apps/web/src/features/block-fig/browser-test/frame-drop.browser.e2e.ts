import { expect, test } from '@playwright/test';

for (const auto of [false, true]) {
  test(`dragging into ${auto ? 'auto layout' : 'a frame'} reparents and undoes as one move`, async ({
    page,
  }) => {
    await page.goto('/?new&edit');
    await expect(page.getByTestId('fig-viewer')).toBeVisible();
    const seed = await page.evaluate(async (auto) => {
      const engine = window.figFixture.engine()!;
      const parent = engine.summary.pages[0].id;
      let sourceParent = parent;
      if (auto) {
        const container = await engine.apply(0, [
          {
            op: 'create',
            parent,
            node: {
              type: 'FRAME',
              name: 'Original parent',
              x: 0,
              y: 0,
              width: 40,
              height: 40,
              props: { opacity: 0.5, clipContent: false },
            },
          },
        ]);
        sourceParent = container.created[0];
      }
      const source = await engine.apply(0, [
        {
          op: 'create',
          parent: sourceParent,
          node: {
            type: 'RECTANGLE',
            name: 'Moving rectangle',
            x: 0,
            y: 0,
            width: 40,
            height: 40,
            props: { fills: [{ color: 'FF0000' }] },
          },
        },
      ]);
      const frame = await engine.apply(0, [
        {
          op: 'create',
          parent,
          node: {
            type: 'FRAME',
            name: 'Destination',
            x: 180,
            y: -40,
            width: 220,
            height: 160,
            props: {
              fills: [{ color: 'EEEEEE' }],
              ...(auto
                ? {
                    layoutMode: 'HORIZONTAL',
                    itemSpacing: 10,
                    paddingLeft: 10,
                    paddingTop: 10,
                    sizingHorizontal: 'FIXED',
                    sizingVertical: 'FIXED',
                  }
                : {}),
            },
          },
        },
      ]);
      const frameId = frame.created[0];
      if (auto)
        await engine.apply(
          0,
          [0, 1].map((i) => ({
            op: 'create',
            parent: frameId,
            node: {
              type: 'RECTANGLE',
              name: `Sibling ${i}`,
              x: 0,
              y: 0,
              width: 40,
              height: 40,
              props: { fills: [{ color: '0000FF' }] },
            },
          }))
        );
      return {
        bytes: Array.from(await engine.save()),
        source: source.created[0],
        frame: frameId,
      };
    }, auto);
    await page.getByTestId('fig-file-input').setInputFiles({
      name: 'drop-test.fig',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(seed.bytes),
    });
    await expect(page.getByRole('banner')).toContainText('drop-test');
    await expect(page.getByTestId('fig-viewer')).toBeVisible();
    await page
      .getByRole('button', { name: 'Find layers', exact: true })
      .click();
    await page
      .getByRole('searchbox', { name: 'Find layers' })
      .fill('Moving rectangle');
    await page
      .getByTestId('fig-search-hit')
      .filter({ hasText: /^Moving rectangle$/ })
      .click();
    await expect(page.getByTestId('fig-field-x')).toBeVisible();
    const zoom = page.getByRole('button', { name: 'Zoom and view options' });
    await zoom.click();
    await page.getByRole('menuitem', { name: 'Zoom to selection' }).click();
    await zoom.click();
    await page.getByRole('menuitem', { name: 'Zoom to 100%' }).click();
    await expect(zoom).toHaveText('100%');
    const canvas = page.getByTestId('fig-canvas');
    const box = (await canvas.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Release between the two existing auto-layout children.
    const dx = 235 - 20;
    const dy = -10 - 20;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
    await page.mouse.up();
    const ancestors = () =>
      page.evaluate(
        async (id) =>
          (await window.figFixture.engine()!.ancestry(0, id)).map((r) => r.id),
        seed.source
      );
    await expect.poll(ancestors).toContain(seed.frame);
    if (auto) {
      await expect
        .poll(() =>
          page.evaluate(
            async (id) =>
              (await window.figFixture.engine()!.layers(0, id))
                .map((r) => r.name)
                .reverse(),
            seed.frame
          )
        )
        .toEqual(['Sibling 0', 'Moving rectangle', 'Sibling 1']);
    } else {
      const info = await page.evaluate(
        (id) => window.figFixture.engine()!.nodeInfo(0, id),
        seed.source
      );
      expect(info.bounds.x).toBeCloseTo(dx, 0);
      expect(info.bounds.y).toBeCloseTo(dy, 0);
    }
    await canvas.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(ancestors).not.toContain(seed.frame);
    const restored = await page.evaluate(
      (id) => window.figFixture.engine()!.nodeInfo(0, id),
      seed.source
    );
    expect(restored.bounds.x).toBeCloseTo(0, 0);
    expect(restored.bounds.y).toBeCloseTo(0, 0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(ancestors).toContain(seed.frame);
    const placed = await page.evaluate(
      (id) => window.figFixture.engine()!.nodeInfo(0, id),
      seed.source
    );
    await page.mouse.move(
      start.x + placed.bounds.x + placed.bounds.w / 2 - 20,
      start.y + placed.bounds.y + placed.bounds.h / 2 - 20
    );
    await page.mouse.down();
    await page.mouse.move(start.x - 100, start.y + 200, { steps: 12 });
    await page.mouse.up();
    await expect.poll(ancestors).toEqual([seed.source]);
    await page.screenshot({ path: test.info().outputPath('after-drop.png') });
    expect(await page.evaluate(() => window.figFixture.errors())).toEqual([]);
  });
}
