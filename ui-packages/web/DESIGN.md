---
name: Gamma Compose
description: A restrained, precise browser workbench for composing React applications.
colors:
  workspace: "#f5f7fa"
  panel: "#ffffff"
  ink: "#192332"
  muted: "#526174"
  line: "#d8e0eb"
  accent: "#2457d6"
  success: "#087a55"
  warning: "#a33b14"
typography:
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  code:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.9
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel}"
    rounded: "{rounded.md}"
    size: "28px"
  input-surface:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "10px"
  tab-active:
    backgroundColor: "{colors.workspace}"
    textColor: "{colors.accent}"
    rounded: "{rounded.sm}"
---

# Design System: Gamma Compose

## Overview

**Creative North Star: "The Quiet Instrument Panel"**

Gamma Compose is a compact developer tool used beside a live application preview. Its
visual system favors cool neutral surfaces, sharp information hierarchy, and familiar
controls. It should feel deliberately engineered, never promotional or ornamental.

The interface stays flat and continuous. Boundaries, alignment, and a single blue accent
separate functions without turning every region into a card.

**Key Characteristics:**

- Compact, predictable controls.
- Flat white work surfaces on a cool neutral workspace.
- One restrained blue accent for action, selection, and focus.
- System typography for UI and monospace only for code or the wordmark.

## Colors

The palette is cool, quiet, and state-oriented.

### Primary

- **Workbench Blue** (`#2457d6`): primary actions, active tabs, links, and focus outlines.

### Neutral

- **Workspace Mist** (`#f5f7fa`): secondary layers and disabled controls.
- **Panel White** (`#ffffff`): conversation, preview, source, and input surfaces.
- **Developer Ink** (`#192332`): primary text.
- **Muted Slate** (`#526174`): labels and secondary state.
- **Boundary Blue-Gray** (`#d8e0eb`): structural dividers and control borders.

### Named Rules

**The One Signal Rule.** Blue is reserved for an action, selection, or focus state and
does not decorate inactive surfaces.

## Typography

**Display Font:** system UI sans-serif
**Body Font:** system UI sans-serif
**Label/Mono Font:** SFMono-Regular with Consolas and Liberation Mono fallbacks

**Character:** Familiar system typography keeps the tool fast and legible. Monospace
communicates source material and identity, not general interface labels.

### Hierarchy

- **Title** (600, 14–22px): page and project identity.
- **Body** (400, 13–14px, 1.6–1.8): conversation and explanatory copy.
- **Label** (500–600, 11–12px): tabs, status, and compact controls.
- **Code** (400, 13px, 1.9): source files with stable alignment.

### Named Rules

**The Working Density Rule.** Use the smallest size that remains comfortably readable;
do not use display typography inside the workbench.

## Elevation

The workbench is flat by default and uses no decorative shadows. Depth comes from
contrasting surface colors, one-pixel dividers, selected states, and focus outlines.

### Named Rules

**The Flat Boundary Rule.** Do not combine a structural border with a diffuse shadow.

## Components

### Buttons

- **Shape:** compact rounded rectangle (`6px`) or square icon action (`28px`).
- **Primary:** Workbench Blue with Panel White foreground.
- **Hover / Focus:** darken slightly on hover; use a visible `2px` blue focus outline.
- **Disabled:** Workspace Mist with Muted Slate foreground.

### Cards / Containers

- **Corner Style:** `8px` only when a control needs a bounded surface.
- **Background:** Panel White.
- **Shadow Strategy:** none.
- **Border:** `1px` Boundary Blue-Gray for interactive groups.
- **Internal Padding:** `8–16px` according to density.

### Inputs / Fields

- **Style:** white, borderless text input inside one `8px` bordered composer surface.
- **Focus:** the enclosing boundary becomes Workbench Blue.
- **Error / Disabled:** errors remain actionable; unavailable inputs are visibly disabled.

### Navigation

Tabs use 12px labels, compact padding, and a pale active background. Panel resize handles
remain visually quiet until hover, focus, or drag.

### Composer Dock

The conversation input, local persistence state, active model, and send or stop action
form one bottom surface. Runtime tool activity remains attached to its message.

## Do's and Don'ts

### Do:

- **Do** use alignment, spacing, and `#d8e0eb` dividers to express structure.
- **Do** keep persistence and model state compact, truthful, and close to the composer.
- **Do** preserve full keyboard and IME behavior in every panel width.
- **Do** hide lower-priority labels before allowing controls to overflow.

### Don't:

- **Don't** place marketing copy inside the workbench.
- **Don't** use ornamental AI-dashboard styling, glass effects, gradients, or decorative motion.
- **Don't** expose provider credentials, implementation details, or speculative usage metrics as user status.
- **Don't** fill toolbars with unavailable controls or labels that compete with the task.
- **Don't** use a colored side stripe, oversized radius, or border-plus-wide-shadow card treatment.
