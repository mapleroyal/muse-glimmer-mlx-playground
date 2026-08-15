# Shape design system

- Use Tailwind radius utilities for every rounded treatment. Do not add component-specific squircle masks or clipping paths.
- `app/globals.css` upgrades every nonzero CSS border radius—including pseudo-elements, partial corners, arbitrary radii, and `rounded-full` controls—to `superellipse(1.5)` when the browser supports `corner-shape`, except for explicit round opt-outs.
- Supporting browsers also scale the shared radius ladder by 1.25 so the superellipse keeps the intended visual reach. Other browsers retain the ordinary `border-radius` geometry and original scale.
- Native radio inputs remain round automatically. Add `data-corner-shape="round"` to custom radio controls, avatars and profile images, status or presence lights, and CSS-border loading spinners. The centralized rule resets the marked element and its own `::before` and `::after`; mark nested circular elements individually.
- Other circular CSS treatments—including icon buttons, switches, sliders, handles, chart UI, and partial or pseudo-element corners—intentionally become squircles.
- SVG geometry such as chart dots and icon circles is unaffected by `corner-shape` and does not need an opt-out.
- Keep `--app-corner-radius-scale`, `--app-corner-shape`, and `--radius-base` centralized in `app/globals.css`.
