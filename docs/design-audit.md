# Momentum — Visual & Interaction Audit

Audit performed before any redesign. Goal: move Momentum away from a
generic "AI productivity app" surface (cards, shadows, gradients, soft
radii, decorative glows, icon-everywhere) toward a quiet, focused,
tactile, intentional tool that answers **"what matters now?"**.

---

## 1. Method

- Read every shared primitive and every screen component.
- Counted the systemic offenders with ripgrep so the fix targets the
  pattern, not just one screen:

| Pattern | Count | Where |
| --- | --- | --- |
| `rounded-xl` / `rounded-2xl` / `rounded-3xl` | 52 | almost every screen |
| `shadow-soft` / `shadow-lift` / `shadow-elevate` | 19 | surfaces, buttons, modal, banners |
| `surface` (card bg + border + inset highlight + shadow) | 20+ | today, calendar, profile, hobby, backup |
| blurred decorative halos (`blur-xl/2xl/3xl`) | 3 | Home hero, empty state, hobby |
| gradient usages | 1 | skeleton shimmer (`linear-gradient`) |
| distinct icon stroke widths | 1.5 / 1.75 / 2 / 2.2 / 3.5 | all screens |

A note on scope: most repetition flows through a handful of shared
classes/components (`.surface`, `.lift`, `ListShell`, `EmptyState`,
`Button`, `Modal`, `TaskRow`). Fixing those propagates across the app.

---

## 2. Systemic findings

### 2.1 Card-everything
`ListShell` (`surface overflow-hidden rounded-2xl`) is the container for
**every** list on every screen. Home additionally wraps its hero, each
group, and its empty state in `.surface` cards. The result is that
nothing has priority: a greeting, a task and a decorative panel all
arrive in the same soft rounded box.

### 2.2 Excessive rounding
Three near-identical large radii (`xl`, `2xl`, `3xl`) are used
interchangeably, so every element is pillow-shaped. There is no crisp
edge in the interface.

### 2.3 Decorative decoration with no job
- Home hero has two blurred colour blobs (`bg-primary/15 blur-3xl`,
  `bg-signal/10 blur-3xl`) behind the greeting.
- `EmptyState` wraps its icon in a blurred `bg-primary/10 blur-xl` halo.
- Hobby note cards sit on `.lift`, which physically raises them on hover.
- The skeleton uses a sweeping gradient sheen.

None of these communicate state; they exist to look "designed".

### 2.4 Weak hierarchy / information overload
- `TaskRow` is close to correct, but the *next action* — the single most
  useful secondary field — is only shown on Home's hero, never in the
  list itself.
- Home mixes greeting, streak pill, timer stat, to-do stat, a 78px
  progress ring, an "up next" block, a remaining-time line, then group
  sections, banners, a reminders strip and a chip row. It reads as a
  dashboard, not a focus list.
- Profile/Statistics legitimately hold numbers, but the same card
  treatment is reused there and on Home, flattening the distinction.

### 2.5 Borders & dividers
Hairline `border-border/60` dividers inside `ListShell` are fine, but
they sit inside a bordered, shadowed, rounded card, giving a
double-container effect. Calendar carries a full grid of vertical rules
plus a bordered card plus a legend.

### 2.6 Iconography
Icons are lucide (a good, coherent set), but usage is inconsistent:
stroke `1.5` for empty-state/calendar marks, `1.75` for nav/rows, `2` for
inline meta, `2.2` for arrows, `3.5` for the checkbox tick. Size drifts
between `3`, `3.5`, `4`, `h-[19px]`, `h-6`. Icons also appear next to
almost every piece of meta text (`Timer`, `CircleCheck`, `Bell`,
`Clock3`), which adds noise rather than recognition.

### 2.7 Motion
`anim-fade-in`, `anim-rise-in`, `anim-pop-in`, `anim-fade-up`,
`anim-ring-in`, `anim-check`, `anim-fill` and `.stagger` are all in use.
Each is individually subtle, but nearly every element enters with motion,
so motion no longer signals "something changed". The one genuinely
expressive animation (checkbox tick) is under-used.

### 2.8 Bottom navigation
Position and safe-area handling are **correct** and must not change. The
visual is slightly loud: a translucent blurred bar, an active pill
(`bg-primary/12`) plus `scale-105` plus a stroke-width bump, which is
three emphasis signals for one state.

### 2.9 Safe area
`main` in `app-shell.tsx` applies `env(safe-area-inset-top)` inside
`max(...)` exactly once and the background stays edge-to-edge. This is
already correct — the audit confirmed **no** double application, so no
change is needed beyond keeping it that way.

---

## 3. Screen-by-screen

- **Home** — hero card + blobs + ring + stat row; then banners,
  reminders strip, per-group cards, chip row. Too many focal points.
- **Calendar** — month card + legend + day panel. Needs more whitespace,
  fewer rules; the day marker meaning ("work left") is good.
- **Task creation** — already conversational (progressive wizard). Surface
  styling inherits the rounding/shadow problem; steps are fine.
- **Task editing** — accordion is good; inherits primitives.
- **Daily / Reminder / Occasional / Custom** — all use `ListShell` +
  `TaskRow`; fixing those fixes these.
- **Profile / Statistics / Settings** — heavy card repetition
  (`rounded-2xl` × several); acceptable to keep some grouping but flatten
  shadows and radii.
- **Notifications / Pomodoro / Focus** — focus banner is already "one
  line, no card"; good reference for the rest.
- **Empty states** — blurred halo is the clearest single decoration to
  remove.
- **Dialogs / sheets** — `shadow-lift` + `rounded-2xl`; keep a single
  overlay shadow, tighten radius.

---

## 4. Principles adopted

1. **Hierarchy, not containers.** Fewer boxes; type, weight, spacing and
   a hairline divider carry structure.
2. **One radius family.** A small, near-flat corner everywhere; pills
   only for genuinely round things (dots, avatars, toggles).
3. **Almost no shadow.** A hairline border is the surface. One shadow,
   reserved for true overlays (dialog, sheet, popover).
4. **Colour is meaning.** `primary` = interactive/active, `signal` =
   due/attention, `success` = done, `destructive` = overdue. Never
   decorative.
5. **Progress and motion only on state change.**
6. **Icons: one stroke weight (1.75), two optical sizes, never beside
   text that already says the same thing.**
