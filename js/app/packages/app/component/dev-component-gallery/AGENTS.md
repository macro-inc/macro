# Dev Component Gallery

This folder is for temporary, dev-only component experiments.

## How to add gallery items
- Add scratch/demo components under `items/`.
- Each file in `items/` should export one focused demo component.
- Import demo components into `ComponentScratchpad.tsx` only to arrange them in the gallery grid.
- Wrap each demo in `ComponentCell` so spacing, border, and surface styling stay consistent.
- Keep demos self-contained and safe to render in development.
- Do not wire product data-fetching or mutations into gallery cells.
- Prefer small focused examples over full feature implementations.
- If a demo needs helper data, define local mock data in its `items/` file or a nearby dev-only helper.

## File responsibilities
- `PopupComponentGallery.tsx`: owns the floating action button, popup shell, header controls, and overall container styling.
- `ComponentScratchpad.tsx`: owns the grid arrangement and imports item demos.
- `ComponentCell.tsx`: reusable cell frame for individual demos.
- `items/`: individual dev-only gallery item components.

## Cleanup
- Remove obsolete experiments once the component moves into product code.
- Keep this folder dev-only; it is mounted behind `import.meta.env.DEV` in `Root.tsx`.
