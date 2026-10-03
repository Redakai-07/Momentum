# Momentum — Design System

Momentum should feel **quiet, focused, tactile, human, confident, fast,
personal, intentional**. The interface exists to answer one question:

> "Here is what matters now."

It is explicitly **not** generic modern-SaaS. The visual language earns
attention through hierarchy — type, weight, spacing, a hairline, one
accent — never through decoration.

See [docs/design-audit.md](docs/design-audit.md) for the audit that
preceded this system.

---

## 1. Principles

1. **Hierarchy, not containers.** Fewer boxes. Structure comes from type
   size/weight, spacing, and a hairline divider — not from cards.
2. **One radius family.** A small, near-flat corner everywhere; `rounded-full`
   only for genuinely round things (dots, toggles, avatars).
3. **No shadow by default.** A hairline border *is* the surface. Exactly one
   shadow exists, for true overlays.
4. **Colour is meaning.** Never decorative.
5. **Motion only on state change**, never to decorate an entrance.
6. **One icon weight**, two optical sizes, and never an icon beside text that
   already says the same thing.

---

## 2. Typography

Two families, loaded via `next/font`.

| Role | Family | Token |
| --- | --- | --- |
| Body / UI | Manrope | `--font-sans` |
| Numerals, labels, eyebrows, time | Space Grotesk | `--font-mono` |

- Body: `15px / 1.55`.
- Scale (all sizes are `px` literals, not a ramp — use the nearest):
  - Display / greeting: `23px` → `27px` at `sm`, `font-semibold`,
    `tracking-tight`.
  - Page title: `22px` → `24px`, `font-semibold`, `tracking-tight`.
  - Section heading: `13–14px`, `font-semibold`, `tracking-tight`.
  - Body: `13–13.5px`, `leading-relaxed`.
  - Meta / caption: `11.5–12.5px`, `text-muted-foreground`.
  - Eyebrow / label: `9.5–10.5px`, `font-mono`, `uppercase`,
    `tracking-[0.16–0.18em]`.
- Numerals that align in columns or change live always carry `.tnum`.
- Never enlarge type to create emphasis; use weight, colour or position.

---

## 3. Spacing

- Base rhythm: multiples of `4px` (`gap-1` = 4, `gap-2` = 8, `gap-3` = 12,
  `gap-4` = 16, `gap-5` = 20, `gap-7` = 28, `gap-8` = 32).
- Screen gutter: `px-5`, `sm:px-8`, `lg:px-10`.
- Content measure: `max-w-[660px]` (focus screens) / `max-w-[1020px]` (wide:
  calendar).
- Vertical section gaps: `space-y-6` between groups; `mt-7` before the
  secondary-links rule.
- Prefer whitespace over a divider; add a `border-t border-border/70 pt-4`
  rule only when two blocks genuinely need separating.

---

## 4. Colour

Tokens are raw HSL triplets in `globals.css`, consumed via `hsl(var(--x))`.
All are theme-scoped; nothing hard-codes a hex in a component.

| Token | Meaning |
| --- | --- |
| `background` / `foreground` | page + text |
| `card` / `popover` | resting surface / overlay surface |
| `muted` / `muted-foreground` | quiet fill / secondary text |
| `border` / `input` / `ring` | hairlines, field edges, focus |
| `primary` | interactive & active (teal) |
| `accent` | soft interactive wash |
| `signal` / `signal-soft` / `signal-foreground` | due / attention (warm coral) |
| `success` | complete |
| `destructive` | overdue / destructive |
| `sidebar` | desktop rail |

Rules:
- Accent colour is selective. A screen should usually have **one** accent
  moment.
- `signal` is for time-sensitive states only (due today, special tasks).
- Accent presets (`[data-accent]`) and hobby accents
  (`[data-hobby-accent]`) override interactive / hobby tokens only.

---

## 5. Surfaces

- `.surface` — `background: card`, `border: 1px solid border`. **No shadow,
  no inset highlight.** This is the only card primitive.
- `.surface-quiet` — a `muted/35` wash with no border, for grouping that does
  not need a box drawn around it.
- `.lift` — optional, for genuinely interactive tiles: firms the border on
  hover (pointer only) and tints on press. It does **not** translate or cast a
  shadow.
- Lists: `ListShell` = `rounded-xl border border-border/70 bg-card`, with a
  `divide-y divide-border/60` between rows. No nesting another box inside it.

---

## 6. Radii

One near-flat family, set once in `@theme`:

| Token | Value | Used for |
| --- | --- | --- |
| `rounded-md` | 6px | small controls |
| `rounded-lg` | 8px | buttons, inputs, icon tiles |
| `rounded-xl` | 9px | list groups, panels |
| `rounded-2xl` | 10px | sheets / dialogs |
| `rounded-full` | — | dots, toggles, avatars only |

`xl`/`2xl`/`3xl` are deliberately close so no element reads as a "pillow".

---

## 7. Icons

- Set: **lucide** (already installed). One set, no mixing.
- Stroke weight: **1.75** is the default and covers the whole app. The only
  other weights are deliberate:
  - `2` — small inline glyphs (≤16px) and the active navigation icon, where
    the thinner stroke would blur.
  - `3` — the checkbox tick, a 12px glyph that needs the extra weight.
  - `0` — filled marks (streak flame, due star), which are shapes, not strokes.
  Stroke weights `1.5`, `2.2` and `2.4` were removed; nothing else exists.
- Optical sizes: `3.5–4` inline meta, `4–5` section/empty marks, `19px` nav,
  `14–16` toolbar buttons. Never mix an icon into running text that already
  names the thing.
- Sections are marked by **type + spacing**, not by an icon per heading.

---

## 8. Buttons

`Button` variants: `primary` (filled), `outline`, `ghost`, `soft`
(`accent` wash), `danger` (text + tint only). Sizes: `sm` (h-8), `md` (h-9),
`icon`, `icon-sm`.

- No shadows on any variant.
- Tactile press: `active:scale-[0.975]`, 150ms.
- Focus: `ring-2 ring-ring/70` with an offset.
- One primary action per view. Secondary actions are `ghost`/`outline`.

---

## 9. Inputs

- `h-9`, `rounded-lg`, `border-input`, `bg-card`.
- Focus: `ring-2 ring-ring/60` + `border-ring/60`.
- Native `select` / `time` / `date` popups follow `color-scheme`, so they are
  dark in dark mode with no white flash.
- `Field` groups a `Label` (13px medium) with its control; hints are 12px
  muted on the same baseline row.

---

## 10. Sheets & dialogs

- One `Modal` primitive. Bottom sheet on mobile (`items-end`, `rounded-t-2xl`),
  centred card on `sm+` (`rounded-2xl`, `max-w-lg`).
- Scrim: `bg-black/50`, **no blur**.
- The only shadow in the system: `--shadow-lift`, reserved for the dialog
  panel and popovers.
- Enter motion: `anim-pop-in`. Close is instant. Escape / back closes the
  topmost layer only (see `modal-stack`).

---

## 11. Task states

A task is a line of hierarchy, **not a database row**:

```
Practice Binary Search          ← WHAT   (14.5px medium, tight)
Next  Solve problem 1           ← NEXT   (12.5px muted, mono label)
30 min remaining · Due today    ← TIME   (11.5px mono, tnum)
[━━━━━░░░░]  18m/30m            ← STATE  (only once started)
```

- `TaskRow` shows: title → next action → one meta line → a progress bar only
  when timed work has actually started.
- Done: title `line-through`, muted; no meta, no bar.
- Overdue/due colour lives on the meta line (`destructive` / `signal`).
- Priority is a single 1.5px dot, only for high/low, never for medium/done.
- Secondary fields (notes, tags, schedule detail) live behind the detail
  modal — progressive disclosure, not inline clutter.

---

## 12. Motion

Motion communicates a state change, and nothing else.

| Class | When |
| --- | --- |
| `anim-fade-in` | a small element appearing (empty state, scrim) |
| `anim-pop-in` | dialog / sheet entering |
| `anim-rise-in`, `anim-fade-up` | a group appearing after a real change |
| `anim-check` | checkbox ticking on |
| `anim-fill` | a progress fill revealing |
| `anim-ring-in` | a ring revealing |

- Durations 130–450ms, ease `cubic-bezier(0.2, 0.8, 0.3, 1)`.
- Do **not** animate every element's entrance; `.stagger` is for first paint
  of a list only.
- `prefers-reduced-motion: reduce` collapses all animation/transition to
  `0.01ms` (global block in `globals.css`). Keep it.

---

## 13. Dark mode

- Static near-black: `background: 0 0% 4.5%`. No animated or colour-shifting
  background, no giant glow.
- `card` / `popover` are slightly lifted greys, separated by a hairline.
- Accents brighten one step (`primary` 166 62% 61%, `signal` 14 88% 67%) so
  meaning survives on black.
- Driven by the `.dark` class on `<html>`; **system theme is respected** by the
  theme provider and never fought.

## 14. Light mode

Equally intentional: a soft neutral page (`0 0% 96.5%`) with true-white cards
that separate via a hairline border, not a shadow. Contrast targets AA.

---

## 15. Accessibility

- Every interactive element is a real `button`/`a`/input with a name.
- `TaskRow` is `role="button"`, focusable, Enter/Space to open; the checkbox
  is `role="checkbox"` with `aria-checked` and stops propagation.
- Progress bars expose `role="progressbar"` with min/max/now.
- Rings use `role="img"` with a descriptive `aria-label`.
- Focus is always visible (`ring-2 ring-ring/70`), never removed.
- `touch-action: manipulation` on controls to remove double-tap delay.
- Safe area: `env(safe-area-inset-top)` is applied **once**, on `main`, inside
  `max(...)`. Backgrounds stay edge-to-edge; content is inset. Never move the
  bottom nav to fix top spacing.
- The bottom navigation's physical position is fixed and correct — it respects
  the Android gesture inset and only its visual style may change.

---

## 16. DO NOT USE

- ❌ Generic gradient backgrounds (including skeleton shimmer sheens).
- ❌ Glassmorphism by default — no decorative `backdrop-blur` (the dialog
  scrim is plain dimming).
- ❌ Card-everything — do not wrap every block in a `.surface`.
- ❌ Excessive pills — reserve `rounded-full` for round things.
- ❌ Excessive shadows — never add a shadow to a resting surface.
- ❌ Random icon colours — colour icons only to carry state.
- ❌ Decorative blobs / blurred halos behind content.
- ❌ Animated or colour-changing backgrounds.
- ❌ Glows (coloured box-shadow halos) on controls.
- ❌ Giant typography used for impact rather than hierarchy.
- ❌ Dashboard clutter — Home shows context, the next action, active work and
  one progress line. Detailed statistics live in Profile, not on Home.
- ❌ An icon next to every piece of text.

---

## 17. Final review checklist

For any screen:

1. Remove all shadows and gradients mentally — does it still read as
   intentionally designed?
2. Remove half the cards — does it get better?
3. Hide all secondary information — is the primary action still obvious?

If any answer is "no", simplify further.
