<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Design/UI

- Use Tailwind CSS defaults and existing theme tokens before introducing custom values.
- Use the project's existing component primitives first; do not mix primitive systems within the same interaction surface.
- Use `cn` for class logic.
- Use `h-dvh`, not `h-screen`.
- Fixed UI must account for `safe-area-inset-*`.
- Use structural skeletons for loading states.
- Use `tabular-nums` for all numeric data.
- Use `text-balance` for headings and `text-pretty` for body copy where applicable.
- Do not use gradients, purple gradients, multicolor gradients, or glow effects unless explicitly requested.
- Destructive or irreversible actions require an `AlertDialog`-style confirmation or an undo window.
- Navigable UI state such as filters, tabs, pagination, and expanded panels should be URL-backed.
- Format dates, times, numbers, and currency with `Intl.*`, not hardcoded formats.

## Accessibility

- Icon-only buttons must have an `aria-label`.
- Form controls must have a visible `<label>` or `aria-label`.
- Use semantic HTML before ARIA: `<button>` for actions, `<a>`/`<Link>` for navigation, `<label>` for form labels, and `<table>` for tabular data.
- Do not use clickable `<div>` or `<span>` elements for actions.
- Interactive elements must have visible `focus-visible` states.
- Never remove outlines without an equivalent focus-visible replacement.
- Images require `alt`; decorative images/icons should be hidden from assistive tech.
- Async validation, toast, or status updates should use `aria-live="polite"` where appropriate.
- Do not block paste in `input` or `textarea` elements.

## Motion

- Do not add animation unless requested or already established by the interface.
- Never use `transition: all`; list animated properties explicitly.
- Animate compositor-only properties: `transform` and `opacity`.
- Do not animate layout properties such as `width`, `height`, `top`, `left`, `margin`, or `padding`.
- Interaction feedback animations must not exceed `200ms`.
- Motion must support `prefers-reduced-motion`.
- Looping animations must pause when off-screen and stop or reduce under reduced-motion settings.

## UI Review

- For any future UI change, run `baseline-ui` against the changed files before considering the work done.
