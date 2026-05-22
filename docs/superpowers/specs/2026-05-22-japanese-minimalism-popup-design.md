# Popup Japanese Minimalism Redesign

## Overview
Rewrite `popup/popup.css` to adopt a modern Japanese minimalism aesthetic. The goal is extreme restraint: generous whitespace, ultra-thin dividers, low-saturation warm grays, and a single vermilion accent.

## Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--paper` | `#F5F0E8` | Page background |
| `--card` | `#FDFBF7` | Card/surface background |
| `--ink` | `#2C2C2C` | Primary text |
| `--stone` | `#8C867D` | Secondary/muted text |
| `--vermilion` | `#C45C48` | Accent color (active states, primary actions, progress) |
| `--mist` | `#E0DCD4` | Divider lines |
| `--wash` | `#EDE8DE` | Hover background |

## Principles

- **Borders**: `1px solid var(--mist)` only. No heavy outlines, no black borders.
- **Radius**: `4px` universally. Soft but restrained.
- **Shadows**: None, or `0 1px 3px rgba(0,0,0,0.04)` at most.
- **Typography**: System font stack. Weights `300-400` for body, `500` for headings. Line-height `1.7`.
- **Spacing**: Increase padding/margin by ~30% compared to original to create breathing room.
- **Buttons**: Borderless, solid background. Hover shifts background to `--wash`.
- **Navigation**: Bottom `1px` divider. Active tab has a `2px` vermilion bottom border.
- **Progress bars**: Vermilion fill (`--vermilion`) on `--mist` background. Height `6-8px`, no heavy borders.
- **Checkboxes**: Custom styled with thin borders, checked state uses vermilion.

## Scope

Single file change: `popup/popup.css`. All existing class names preserved. No HTML or JS changes.

## Exclusions

- No animation beyond subtle hover color transitions.
- No external fonts or images.
- No structural layout changes.
