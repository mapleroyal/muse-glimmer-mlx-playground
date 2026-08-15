# Typography design system

- Keep typography centralized in `app/globals.css` theme tokens; avoid parallel class systems or component-level overrides unless there is a clear blocker.
- Product UI text should use the semantic utilities below. Do not define product typography in components with raw Tailwind `text-*`, `font-*`, `tracking-*`, or `leading-*` utilities when a semantic token fits.
- Shared primitives should carry the correct semantic defaults so screens inherit the system by composition rather than one-off overrides.
- Each semantic utility owns size, line height, weight, and tracking as one rule. Override it with another semantic utility instead of layering raw typography utilities on top.
- `text-body-md` (14/20) is the application default. Add a utility only when the text has a more specific role.
- `cn()` is configured to merge the semantic utilities as complete type styles. Keep its type-style list synchronized with the tokens below.
- Allowed exceptions:
  - code/monospace
  - third-party rendering hooks such as charts and calendars
  - 16px mobile form controls that prevent browser zoom
  - purposeful responsive or state-specific typography changes

| Utility            | Spec                 | Intended use                        |
| ------------------ | -------------------- | ----------------------------------- |
| `text-display-lg`  | 40/48, 600, -0.03em  | hero only, max 2 lines              |
| `text-display-md`  | 32/40, 600, -0.02em  | major feature heading               |
| `text-display-sm`  | 28/36, 600, -0.015em | large promo / empty state heading   |
| `text-headline-lg` | 24/32, 600, -0.012em | primary page title                  |
| `text-headline-md` | 20/28, 600, -0.01em  | section title                       |
| `text-headline-sm` | 18/24, 600, -0.008em | dense section/card heading          |
| `text-title-lg`    | 16/24, 500, 0        | card/dialog title                   |
| `text-title-md`    | 14/20, 500, 0        | compact title, nav group title      |
| `text-title-sm`    | 13/18, 500, 0        | small supporting title              |
| `text-body-lg`     | 16/24, 400, 0        | long-form/default reading           |
| `text-body-md`     | 14/20, 400, 0        | standard app copy                   |
| `text-body-sm`     | 12/16, 400, 0.002em  | secondary/supporting text           |
| `text-label-lg`    | 14/20, 500, 0        | buttons, tabs, field labels         |
| `text-label-md`    | 12/16, 500, 0        | badges, compact controls            |
| `text-label-sm`    | 11/16, 600, 0.02em   | eyebrow/meta only, never paragraphs |
