---
name: ui-pro-magic
description: |
  Two-layer UI/UX skill that combines the strategic design intelligence of
  ui-ux-pro-max (50+ styles, 97 palettes, 57 font pairings, 99 UX rules, 25 chart
  types, 9 stacks) with the component generation capabilities of the 21st.dev
  Magic MCP (component builder, refiner, inspiration, logo search). Use for any
  request that involves designing, building, refining, or auditing UI — landing
  pages, dashboards, SaaS apps, e-commerce, mobile, components. Workflow: 1) lock
  the design system with ui-ux-pro-max (style, palette, typography, anti-patterns),
  2) generate components with Magic MCP constrained by that system, 3) run the
  pre-delivery checklist. Trigger examples: "build me a landing page for...",
  "design a dashboard for...", "create a hero section", "generate a pricing table",
  "improve the UI of...", "refine this component". Do NOT trigger for pure
  backend tasks, data pipelines, or non-UI code.
---

# UI Pro Magic — Design System + Component Generation

A two-layer orchestrator for UI/UX work:

- **Layer 1 — Strategy:** `ui-ux-pro-max` locks the design system (style, palette, typography, anti-patterns, stack rules) from a searchable database of 50+ styles, 97 palettes, 57 font pairings, 99 UX rules.
- **Layer 2 — Implementation:** 21st.dev Magic MCP generates the actual component code (React/Tailwind/shadcn), constrained by the locked design system.

Strategy decides *what* to build. Magic decides *how* to ship it.

## When to trigger

Fire whenever the request involves designing, building, refining, or auditing UI:

- ✅ "build me a landing page for a SaaS analytics tool"
- ✅ "create a hero section with pricing below"
- ✅ "design a dashboard for a fintech app"
- ✅ "refine this button component"
- ✅ "audit the UI of this page"
- ❌ Pure backend, data pipelines, DevOps

## Prerequisites

1. **Python 3** (for ui-ux-pro-max search engine):
   ```bash
   python3 --version
   ```
2. **ui-ux-pro-max skill** installed at one of:
   - `~/claude-library/ui-ux-pro-max-skill/` (author's default)
   - Anywhere else — resolve the path from `UI_UX_PRO_MAX_PATH` env var if set
3. **21st.dev Magic MCP** configured in Claude Code with an API key from [21st.dev/magic-chat](https://21st.dev/magic-chat?mcp_section=true):
   ```bash
   claude mcp add magic -s user -- npx -y @21st-dev/magic@latest API_KEY=<your-key>
   ```

## The workflow

### Step 1 — Analyze the request

Extract:
- **Product type** (SaaS, e-commerce, portfolio, dashboard, landing, mobile…)
- **Industry** (fintech, healthcare, beauty, gaming…)
- **Style keywords** (minimal, brutalist, glass, dark mode, playful…)
- **Stack** (default `html-tailwind` if unspecified; otherwise `react`, `nextjs`, `vue`, `svelte`, `shadcn`, `react-native`, `flutter`, `swiftui`, `jetpack-compose`)
- **Components needed** (hero, pricing table, nav, dashboard card, form…)
- **Project name** (use a sensible default if the user doesn't give one)

### Step 2 — Lock the design system (ui-ux-pro-max)

Always run `--design-system --persist` first. This creates a Master file that constrains every subsequent component generation.

```bash
python3 ~/claude-library/ui-ux-pro-max-skill/src/ui-ux-pro-max/scripts/search.py \
  "<product_type> <industry> <style_keywords>" \
  --design-system --persist \
  -p "<Project Name>"
```

This produces:
- `design-system/MASTER.md` — the global Source of Truth
- `design-system/pages/` — folder for page-specific overrides

Optionally create a page override (e.g. the dashboard has different rules than the landing):
```bash
python3 .../search.py "<query>" --design-system --persist -p "<Project>" --page "dashboard"
```

### Step 3 — Supplement with targeted searches (as needed)

Only when Step 2 doesn't cover something specific:

| Need | Command |
|------|---------|
| Chart type | `... "<query>" --domain chart` |
| Deeper UX rules | `... "<query>" --domain ux` |
| Alternative fonts | `... "<query>" --domain typography` |
| Landing structure | `... "<query>" --domain landing` |
| Stack specifics | `... "<query>" --stack <name>` |

### Step 4 — Generate components (Magic MCP)

For each component in the request, call the Magic MCP tool with the design system injected.

Available Magic MCP tools:

| Tool | Use for |
|------|---------|
| `21st_magic_component_builder` | Generate a new component from a text description |
| `21st_magic_component_refiner` | Refine an existing component (improve styling, responsiveness, a11y) |
| `21st_magic_component_inspiration` | Explore design variations before committing |
| `logo_search` | Find brand SVGs from Simple Icons |

**Critical rule:** never call Magic with a bare component description. Always inject the locked design system so the output matches.

Prompt template for `21st_magic_component_builder`:

```
Build a <component> for <project> using stack <stack>.

DESIGN SYSTEM (must be respected):
- Style: <style from MASTER.md>
- Palette: <primary / secondary / accent / bg / text hex values>
- Typography: <heading font> / <body font>
- Effects: <shadows, borders, radii>
- Anti-patterns to avoid: <list from MASTER.md>

COMPONENT REQUIREMENTS:
<specific asks from the user>

CONSTRAINTS:
- Use SVG icons only (Heroicons or Lucide), never emojis
- All clickable elements get cursor-pointer
- Hover states via color/opacity, not layout-shifting transforms
- Respect prefers-reduced-motion
- Touch targets >= 44x44px
```

For refinement, pass the existing code plus the same design-system block to `21st_magic_component_refiner`.

### Step 5 — Pre-delivery checklist

Before handing off, verify (from ui-ux-pro-max's canonical list):

**Visual**
- [ ] No emoji icons — SVGs only
- [ ] All icons from one set (Heroicons/Lucide)
- [ ] Brand logos verified against Simple Icons
- [ ] Hover states don't shift layout

**Interaction**
- [ ] `cursor-pointer` on every clickable element
- [ ] Clear hover feedback
- [ ] Transitions 150–300 ms
- [ ] Visible focus rings

**Light/Dark mode**
- [ ] Light-mode text contrast >= 4.5:1
- [ ] Glass elements use `bg-white/80+`, not `bg-white/10`
- [ ] Borders visible in both modes

**Layout**
- [ ] Floating nav has `top-4 left-4 right-4` spacing, not `top-0`
- [ ] Content not hidden behind fixed nav
- [ ] Responsive at 375 / 768 / 1024 / 1440 px
- [ ] No horizontal scroll on mobile

**Accessibility**
- [ ] All images have alt text
- [ ] Form inputs have labels
- [ ] Color is not the only indicator
- [ ] `prefers-reduced-motion` respected

## Escalation and error handling

- **Magic MCP unavailable?** Fall back to generating code directly, still injecting the ui-ux-pro-max design system as a strict constraint block in the prompt.
- **ui-ux-pro-max not found?** Ask the user for the path, or skip to Magic with an explicit "no locked design system" warning and a minimal sensible default (Tailwind + slate/indigo + Inter/Manrope).
- **Conflict between user request and anti-pattern?** Surface the conflict and propose two paths: respect the anti-pattern, or override it with a documented justification.

## User control

- "use Magic without ui-ux-pro-max" → skip Step 2
- "just give me the design system" → stop after Step 2
- "refine, don't rebuild" → use `21st_magic_component_refiner` only
- "generate 3 variants" → use `21st_magic_component_inspiration` first, then build the chosen one

## Rules

1. **Strategy before implementation.** Never generate a component before the design system is locked.
2. **Inject, don't hope.** Magic MCP only respects what you put in the prompt.
3. **Persist the system.** Always use `--persist` so the Master survives across sessions and page-level overrides stay consistent.
4. **One icon set, one palette, one type system** per project. Enforce this at every refinement.
5. **Checklist is non-negotiable.** Run it before claiming the UI is done.

## References

- [references/prompts.md](references/prompts.md) — prompt templates per component type (hero, pricing, dashboard card, nav, form, modal)
- [references/stacks.md](references/stacks.md) — stack-specific snippets to paste into Magic prompts
