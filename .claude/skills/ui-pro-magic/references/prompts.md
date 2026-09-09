# Component prompt templates

Ready-to-paste prompt blocks for `21st_magic_component_builder`. Replace the
`<...>` tokens with values from `design-system/MASTER.md` and the user's request.

Every prompt ends with the same **CONSTRAINTS** block — don't remove it.

---

## Base constraints block (always append)

```
CONSTRAINTS:
- Style: <style>
- Palette: primary <hex>, secondary <hex>, accent <hex>, bg <hex>, text <hex>
- Typography: <heading font> / <body font>
- Use SVG icons only (Heroicons or Lucide), never emojis
- All clickable elements get cursor-pointer
- Hover via color/opacity, never layout-shifting transforms
- Respect prefers-reduced-motion
- Touch targets >= 44x44px
- Responsive at 375 / 768 / 1024 / 1440 px
- Stack: <stack>
```

---

## Hero section

```
Build a hero section for <project> (<product type>, <industry>).

LAYOUT:
- <hero-centric / split-image / video-bg / animated-gradient>
- Headline, subheadline, primary CTA + secondary CTA
- <optional: social proof row / trust logos / live stats>

TONE: <bold / elegant / playful / technical>

<base constraints block>
```

---

## Pricing table

```
Build a pricing table with <N> tiers for <project>.

TIERS: <Free / Pro / Enterprise> — each with name, price, 4-6 features, CTA
FEATURED TIER: <which one> — visually elevated (border glow, badge, scale)
BILLING TOGGLE: <monthly / yearly with discount badge>

INTERACTIONS:
- Highlight on hover (color only, no scale shift)
- Disabled CTA shows reason in tooltip

<base constraints block>
```

---

## Navigation bar

```
Build a <floating / sticky / transparent-on-scroll> navbar for <project>.

LEFT: logo + wordmark (SVG)
CENTER: <N> links
RIGHT: <CTA button / account menu / theme toggle>

BEHAVIOR:
- Mobile: hamburger -> slide-in drawer
- Scroll: <blur backdrop / solid bg / shrink>
- Active link: <underline / pill / color>

<base constraints block>
Note: floating navbar must have top-4 left-4 right-4 spacing, never top-0.
```

---

## Dashboard card

```
Build a dashboard KPI card showing <metric name>.

CONTENT:
- Metric label (muted)
- Large number + unit
- Delta vs previous period (arrow + % + color-coded)
- Sparkline (last 30 days)
- Optional: drill-down icon button

STATES: loading (skeleton), empty, error

<base constraints block>
```

---

## Form (login / signup / contact)

```
Build a <login / signup / contact> form for <project>.

FIELDS: <list>
VALIDATION: inline error messages below each field
LOADING: submit button disables and shows spinner

ACCESSIBILITY:
- Every input has a visible label (not placeholder-only)
- Error messages use aria-describedby
- Focus ring visible on every interactive element

<base constraints block>
```

---

## Modal / dialog

```
Build a modal dialog for <purpose>.

SIZE: <sm / md / lg / full-on-mobile>
HEADER: title + close button (top-right)
BODY: <content>
FOOTER: primary action + cancel

BEHAVIOR:
- Backdrop click closes (unless destructive)
- Escape key closes
- Focus trapped inside
- Return focus to trigger on close

<base constraints block>
```

---

## Data table

```
Build a data table for <entity> with <columns>.

FEATURES: sort, filter, pagination, row selection, bulk actions
EMPTY STATE: illustration + CTA
LOADING: row skeletons

RESPONSIVE: on mobile, collapse to card list (not horizontal scroll).

<base constraints block>
Accessibility: provide semantic <table> with scope attributes on headers.
```

---

## Feature grid

```
Build a feature grid with <N> features for <project>.

EACH FEATURE:
- SVG icon (from <Heroicons / Lucide>, single color tint)
- Title
- 1-2 line description
- Optional "Learn more" link

LAYOUT: <N>-column on desktop, 2-col on tablet, 1-col on mobile.

<base constraints block>
```

---

## Testimonial section

```
Build a testimonial section for <project>.

LAYOUT: <single-quote-centered / 3-card-grid / marquee-scroll>
EACH TESTIMONIAL: avatar, quote, name, role, company logo
<optional: star rating, video play button>

<base constraints block>
Logos: call logo_search MCP tool first to get correct brand SVGs.
```

---

## FAQ / accordion

```
Build an FAQ section with <N> items.

EACH ITEM: question (clickable), expandable answer
BEHAVIOR: one open at a time (or allow multi-open — specify)
ICON: chevron that rotates on open

<base constraints block>
Accessibility: proper aria-expanded / aria-controls wiring.
```

---

## Refinement prompt (for `21st_magic_component_refiner`)

```
Refine the following component. Keep its structure intact; improve:
- <specific asks: responsiveness, dark mode, a11y, performance, animation>

EXISTING CODE:
<paste>

<base constraints block>
```
