# Stack-specific snippets

Paste these blocks into the Magic MCP prompt's `STACK SPECIFICS:` section.
They steer the generator toward each stack's idioms.

---

## html-tailwind (default)

```
STACK SPECIFICS — html-tailwind:
- Tailwind v3 utility classes, no custom CSS unless unavoidable
- Use CSS variables for theme tokens: --bg, --fg, --primary, --accent
- Dark mode via `dark:` variants driven by `class="dark"` on <html>
- No framework JS — vanilla JS only for interactivity
- Icons: inline SVG from Heroicons
```

---

## react

```
STACK SPECIFICS — React:
- Functional components, hooks only
- TypeScript strict (interfaces for props)
- Tailwind for styling; clsx for conditional classes
- Accessibility via React-ARIA patterns
- Avoid unnecessary re-renders: memoize handlers with useCallback when they cross component boundaries
- Icons: lucide-react
```

---

## nextjs

```
STACK SPECIFICS — Next.js (App Router):
- Server components by default; mark client components explicitly with "use client"
- Use next/image for all images, next/font for fonts, next/link for nav
- Route handlers in app/api/
- Metadata via the exported metadata object per route
- Tailwind; shadcn/ui encouraged for primitives
```

---

## vue

```
STACK SPECIFICS — Vue 3:
- <script setup lang="ts"> with Composition API
- Pinia for state, Vue Router for routing
- Tailwind for styling
- Composables under composables/, following useXxx naming
- Icons: lucide-vue-next
```

---

## svelte

```
STACK SPECIFICS — Svelte 5 (Runes):
- Use $state, $derived, $effect runes
- SvelteKit for routing; load functions for data
- Tailwind for styling
- Transitions via svelte/transition, respecting prefers-reduced-motion
- Icons: lucide-svelte
```

---

## shadcn

```
STACK SPECIFICS — shadcn/ui (React):
- Use shadcn primitives first: Button, Input, Dialog, Card, Form, Select, Popover
- Theme via the CSS-variable system shadcn ships with
- cva() for component variants, not prop-driven className soup
- Forms via react-hook-form + zod schemas
- Icons: lucide-react
```

---

## react-native

```
STACK SPECIFICS — React Native:
- Use StyleSheet.create or nativewind (Tailwind-like) — state once, stay consistent
- Platform.select for iOS/Android divergence
- React Navigation for routing
- Safe area via react-native-safe-area-context
- Respect minimum touch targets (44pt iOS, 48dp Android)
- Icons: @expo/vector-icons or lucide-react-native
```

---

## flutter

```
STACK SPECIFICS — Flutter:
- Material 3 theming via ThemeData
- Widgets over custom painters unless necessary
- Use const constructors everywhere for free rebuild skips
- State: Riverpod or Bloc — don't mix
- Respect Semantics widget for a11y
```

---

## swiftui

```
STACK SPECIFICS — SwiftUI:
- iOS 17+ features: @Observable, @Bindable
- Use SF Symbols for icons
- Respect Dynamic Type and VoiceOver
- Animations via .animation(_:value:), respecting .accessibilityReduceMotion
- Navigation via NavigationStack
```

---

## jetpack-compose

```
STACK SPECIFICS — Jetpack Compose:
- Material 3 theming
- Composable functions with proper state hoisting
- Use remember / rememberSaveable for local state
- Modifier chain order matters — background before clickable for ripple
- Respect LocalAccessibilityManager reduceMotion
```
