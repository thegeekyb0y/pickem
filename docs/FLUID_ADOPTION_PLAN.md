# Fluid Functionalism adoption

## Scope and decisions

- Adopt Fluid Functionalism as a focused component/motion layer, not a wholesale
  redesign. Keep Bricolage Grotesque for existing product text and display,
  Geist Mono for numeric/data content, and warm-paper/copper OKLCH tokens.
- Use Radix flavor; current app has no primitive library. Configure shadcn
  manually instead of running `shadcn init`, so existing theme tokens are not
  rewritten. Map `utils` to `@/lib/cn`; retain that existing class merge helper.
- Fluid's Inter Variable is scoped to Fluid controls that animate weight. It
  is not the app-wide font. Keep its variable available through next/font with
  `preload: false`; do not change Bricolage/Geist assignments.
- Fluid's agent skill is installed globally and informs app implementation;
  the registry's copied React components and dependencies are the runtime UI.

## Motion/accessibility contract

- Root provider follows `prefers-reduced-motion`; Fluid's transform/layout
  travel is reduced while opacity/color cues remain. CSS loops stop/reduce.
- Use the three Fluid spring tiers and paired exits. `spring.slow` is for large
  surfaces only; live-result bars never animate font weight.
- Transform/opacity remain the custom-motion default. Fluid's shipped,
  absolutely positioned selection/focus/hover overlays and fixed control
  internals may animate measured bounds only when surrounding layout does not
  reflow; custom UI does not animate layout properties.
- Keep pointer cursors on actionable elements. Fluid Hover is mouse-only;
  avoid gap-click for ambiguous/destructive/data-changing actions; preserve
  keyboard focus and touch interactions.
- Prefer Fluid's shipped behavior over editing registry files. Keep project's
  accessible labels, focus-visible treatment, semantic navigation, safe-area
  handling, and minimum touch targets.

## Build order

1. Registry foundation: manually configured `components.json`, `@fluid`
   namespace, token aliases in existing CSS, reduced-motion provider. Preserve
   the original token values and font family assignments.
2. Fluid pilot components: button, badge, input-group, tabs, select, dropdown,
   dialog, switch. Use in navigation, profile, owner controls, and wizard in
   separate screen commits. Keep Discover tab state URL-backed.
3. Date/time picker: shadcn Calendar (`react-day-picker`) with Radix Popover,
   existing tokens, and Fluid motion. Use UTC/local helpers, show the timezone,
   keep phone time input native, disable past dates, offer presets, close after
   choosing open time, and lazy-load only on create/edit routes.
4. Quiz builder: feature branch, stacked Google Forms-style question cards,
   add/duplicate/confirmed-delete, drag reorder with keyboard up/down fallback,
   and responsive phone layout. Do not substitute the stepper `AskUserQuestions`
   for this flow; its numbered chips aren't ranks and multi-select is unordered.
5. Quiz covers: a wide shallow banner matching the Discover header's rounded
   outline, responsive crop/focal point, preview in builder, and reuse on the
   quiz page/Discover cards. Sources are presets, server-only Redis-cached
   Unsplash search with credit/download callback, and authenticated/rate-limited
   Vercel Blob upload with size/type checks, WebP conversion, and EXIF removal.
6. Finish the approved expand/deploy/contract schema work only after explicit
   migration approval; no migration is run as part of the UI foundation.
7. Run the Fluid skill's audit only after the foundation, scoped to navigation,
   profile, and wizard; review each suggested rewrite and keep it commit-sized.

## Acceptance and risks

- Validate all three viewport classes, keyboard/focus paths, touch behavior,
  reduced-motion preference, theme-token consistency, date/time conversion,
  drag ordering, and image-preview loading/layout stability.
- Keep date-picker/calendar JS out of non-create/edit routes; compare route
  bundles after each component group. Motion is already installed; watch for
  only one copy. Inter adds a font resource but is not preloaded app-wide.
- Risks: registry dependencies may alter CSS variables; inspect every install
  diff and restore warm tokens. Fluid's default 36px controls can be too short
  for phone targets; preserve 44px touch sizing where needed. Unsplash/Blob
  features require server secrets, quotas, and an approved persistence schema.

## Open gates

- Ask before applying any database migration; rehearse locally first and create
  a Neon backup branch before a separately approved Neon migration.
- Confirm the Unsplash key is provisioned before enabling live search.
- Keep exact banner crop/aspect responsive and use the supplied Discover header
  image as the visual reference; tune only after reviewing the rendered UI.
