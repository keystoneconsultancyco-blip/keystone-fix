# UI Pro Magic

A Claude Code skill that combines two layers for UI/UX work:

1. **Strategy** — the [`ui-ux-pro-max`](https://github.com/) design intelligence (50+ styles, 97 palettes, 57 font pairings, 99 UX rules, 25 chart types, 9 stacks) locks the design system.
2. **Implementation** — the [21st.dev Magic MCP](https://21st.dev/magic-chat?mcp_section=true) generates the actual React/Tailwind/shadcn component code, constrained by that system.

Strategy decides *what* to build. Magic decides *how* to ship it.

## Why this skill

Magic on its own happily produces beautiful components — that don't match each other. Five prompts, five palettes, five font stacks, zero coherence.

`ui-ux-pro-max` on its own produces a rigorous design system — but you still have to translate it into code yourself.

`ui-pro-magic` glues them together: lock the system once, then every component Magic generates respects the same palette, typography, anti-patterns, and stack idioms.

## The workflow

1. **Analyze** — extract product type, industry, style, stack, components needed
2. **Lock** — `search.py --design-system --persist` writes `design-system/MASTER.md`
3. **Generate** — for each component, call Magic MCP with the locked system injected into the prompt
4. **Refine** — use `21st_magic_component_refiner` with the same system block
5. **Checklist** — run the pre-delivery verification before handoff

## Prerequisites

### 1. Python 3

```bash
python3 --version
```

### 2. `ui-ux-pro-max` skill

Install from the official source. The author's default path is `~/claude-library/ui-ux-pro-max-skill/`. If you put it elsewhere, either update the path in `SKILL.md` or export `UI_UX_PRO_MAX_PATH`.

### 3. 21st.dev Magic MCP

Get an API key from [21st.dev/magic-chat](https://21st.dev/magic-chat?mcp_section=true), then register the MCP:

```bash
claude mcp add magic -s user -- npx -y @21st-dev/magic@latest API_KEY=<your-key>
```

Verify:
```bash
claude mcp list
```

You should see `magic: ✓ Connected`.

## Installation

Clone into your Claude Code skills directory:

```bash
git clone https://github.com/NeousAxis/ui-pro-magic.git ~/.claude/skills/ui-pro-magic
```

The skill will then appear in your skills list and trigger automatically on UI/UX requests.

## Structure

```
ui-pro-magic/
├── SKILL.md                 # main skill: decision logic, workflow, rules
├── references/
│   ├── prompts.md           # component prompt templates (hero, pricing, nav, form...)
│   └── stacks.md            # stack-specific snippets (react, next, vue, svelte, shadcn...)
├── README.md
├── LICENSE
└── .gitignore
```

## Example

**User:** "build me a landing page for a fintech analytics SaaS, dark mode, brutalist"

**Skill:**
1. Lock the design system:
   ```bash
   python3 ~/claude-library/ui-ux-pro-max-skill/src/ui-ux-pro-max/scripts/search.py \
     "fintech analytics SaaS dashboard dark brutalism" \
     --design-system --persist -p "Fintech Analytics"
   ```
2. For each section (hero, features, pricing, CTA, footer), invoke `21st_magic_component_builder` with the locked palette, typography, and stack injected.
3. Refine with `21st_magic_component_refiner` where needed.
4. Run the pre-delivery checklist.

## User control

- `"use Magic without ui-ux-pro-max"` → skip the strategy step
- `"just give me the design system"` → stop after strategy
- `"refine, don't rebuild"` → use the refiner only
- `"generate 3 variants"` → use `21st_magic_component_inspiration` first

## Rules

1. Strategy before implementation. Never generate a component before the system is locked.
2. Inject, don't hope. Magic MCP only respects what you put in the prompt.
3. Persist the system. Always use `--persist`.
4. One icon set, one palette, one type system per project.
5. Checklist is non-negotiable.

## License

MIT — see [LICENSE](LICENSE).

## Contributing

PRs welcome. Good targets: new stack snippets, new component templates, refinements to the escalation logic.
