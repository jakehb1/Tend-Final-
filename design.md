# Tend — Design System

A practical reference for designers and engineers working on the Tend app
(`project/*.html`). Everything here is in active use; if you change a token,
search-and-replace it across all pages.

---

## 1. Brand voice

Tend is a calm, editorial business app. It looks like a publication, not a
SaaS dashboard. Three principles:

- **Quiet over loud.** Cream paper, sage accents, dark ink. No bright UI
  blues, no gradients, no shadows louder than `0 1px 0 var(--line-2)`.
- **Editorial structure.** Sections use `§01`, `§02` markers and mono
  kicker labels. Treat the chrome like a magazine masthead.
- **Mono for meta, serif/sans for content.** IBM Plex Mono carries
  timestamps, status, labels. FH Premier (with IBM Plex Sans fallback)
  carries titles and body.

---

## 2. Color tokens

Defined as CSS custom properties at the top of every page. **Always use the
token**, never the literal hex.

| Token             | Value                              | Use                                                    |
| ----------------- | ---------------------------------- | ------------------------------------------------------ |
| `--bg`            | `#FAF9F5`                          | Page background (warm cream)                           |
| `--bg-2`          | `#F4F1EA`                          | Card / input background, hover surfaces                |
| `--bg-3`          | `#EBE7DC`                          | Pressed / secondary chips                              |
| `--fg`            | `#1F1E1B`                          | Primary text, primary buttons                          |
| `--fg-dim`        | `rgba(31, 30, 27, 0.66)`           | Secondary text, body copy in cards                     |
| `--fg-mute`       | `rgba(31, 30, 27, 0.42)`           | Mono labels, captions, placeholder                     |
| `--line`          | `rgba(31, 30, 27, 0.08)`           | Hairline dividers                                      |
| `--line-2`        | `rgba(31, 30, 27, 0.18)`           | Borders on cards, chips                                |
| `--accent`        | `#E5E9E0`                          | **Sage.** Brand mark background, active nav, hits      |
| `--accent-ink`    | `#1F1E1B`                          | Text on sage surfaces                                  |
| `--accent-soft`   | `rgba(229, 233, 224, 0.45)`        | Tinted callouts                                        |
| `--amber`         | `#B07A2E`                          | Warnings, broken connectors, "add a connection"        |
| `--good`          | `#4F7A4B`                          | Healthy connector dots only — use sparingly            |

**Rule:** sage `#E5E9E0` is the *only* accent surface. Don't introduce a
second accent color. Use ink `--fg` for primary actions, amber for warnings.

---

## 3. Typography

```css
font-family: 'FH Premier', 'IBM Plex Sans', system-ui, sans-serif;  /* body */
font-family: 'IBM Plex Mono', monospace;                            /* meta */
```

| Scale | Size                   | Where                                       |
| ----- | ---------------------- | ------------------------------------------- |
| H1    | `clamp(28px, 3.4vw, 40px)`, weight 500, letter-spacing -0.02em | Page title (hero)                |
| H2    | 11px mono, 0.14em tracking, uppercase                          | Section header (`§01 / …`)       |
| H3    | 16–17px, weight 500                                            | Card title                       |
| Body  | 14.5px, line-height 1.55, color `--fg-dim`                     | Paragraphs, descriptions         |
| Meta  | 10–11px mono, 0.08–0.14em tracking, `--fg-mute`                | Timestamps, status, kickers      |
| Input | **16px minimum on mobile** (iOS would zoom otherwise)          | Composer textarea                |

Italic editorial moments use a sage-pill treatment:

```html
<h1>Good morning, Sarah. <span class="it">Here's your day.</span></h1>
```
```css
.db-hero h1 .it {
  font-style: italic;
  font-weight: 400;
  background: var(--accent);
  padding: 0 8px;
  border-radius: 6px;
}
```

---

## 4. Layout & spacing

- Editorial pages cap content at **`max-width: 1080–1200px`** centered.
- Outer page padding: `44px 44px 80px` desktop; collapses to `24px 18px 60px`
  on phones.
- Section spacing: `36px` between major sections, `18px` under a section
  header before its first card.
- Card padding: `16–22px` depending on density; pill buttons sit at `7×14px`.
- Border radii: `6px` chips, `10–14px` cards, `999px` pills/buttons.
- Hairline dividers: `1px solid var(--line)`. **No drop shadows** beyond a
  single 1px inset on hover.

### Responsive breakpoints

| Width      | Treatment                                                       |
| ---------- | --------------------------------------------------------------- |
| ≥ 1024px   | Desktop: two-column where applicable, fixed brand + gear corners |
| 720–1023px | Single-column editorial, drawer-style nav                        |
| ≤ 720px    | Mobile composer card, larger tap targets                         |
| ≤ 480px    | Tighter padding, hide workspace tag                              |

### Mobile-webapp hygiene (do not remove)

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
```
```css
html { -webkit-text-size-adjust: 100%; }
html, body { height: 100dvh; }            /* dvh handles the URL bar */
body { overscroll-behavior: none; }
button, a, .b-item { touch-action: manipulation; }
input, textarea { font-size: 16px; }       /* anything < 16px triggers iOS zoom */
```

---

## 5. Page architecture

| Page                | Role                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| `login.html`        | Sign-in. Redirects to `dashboard.html` (returning user) or `onboarding.html`.     |
| `onboarding.html`   | First-time account setup. Sets `localStorage["tend.onboarded"] = 1` when done.    |
| `dashboard.html`    | **Landing page after login.** Daily Welcome overlay fires here.                   |
| `app.html`          | Chat interface — context window + bento home + composer.                          |
| `data-layer.html`   | Connections snapshot. Chip strip + detail rows + coverage tiles.                  |
| `connect.html`      | Connector management (manage / reconnect individual integrations).                |

Every authed page bootstraps with:

```html
<script>
  document.documentElement.style.visibility = 'hidden';
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(function (r) {
      if (!r.ok) return window.location.replace('login.html');
      return r.json();
    })
    .then(function (data) {
      if (data && data.user) window.__TEND_USER__ = data.user;
      document.documentElement.style.visibility = '';
    })
    .catch(function () { window.location.replace('login.html'); });
</script>
```

---

## 6. Navigation pattern

The Tend brand mark (top-left, sage pill) is the **navigation entry point**
on every page. Clicking it opens a slide-out drawer with the same four
links:

- **Chat** → `app.html`
- **Dashboard** → `dashboard.html`
- **Data layer** → `data-layer.html`
- **Connections** → `connect.html`

The active page is highlighted with `class="active"` (sage background, dark
ink on the icon). Sign out lives in the drawer footer.

---

## 7. Daily Welcome onboarding

After login, the user lands on `dashboard.html` and a full-screen overlay
runs the three-step daily welcome:

1. **Pick today's focus** — `listing` / `past-clients` / `field-day` / `admin-ops`
2. **Energy check** — `full` / `half` / `thin`
3. **Anything on your mind?** — free-text notes

Selections persist for the browser session as:

```js
sessionStorage["tend.daily"] = JSON.stringify({ focus, energy, notes });
sessionStorage["tend.welcomed"] = "1";  // suppresses re-prompt
```

The dashboard then reads `tend.daily` and:
- Appends a "Focus: …" tag to the hero kicker
- Adds `.focus-hit` (dark left bar) to matching sessions / approvals
- Hides non-decision cards when `energy === "thin"`
- Renders the note as a sage-bordered `.db-note` callout under the hero

---

## 8. Core components

### Brand button (logo)

```html
<button class="brand-btn" id="brand-btn">
  <span class="mark" aria-hidden="true"></span>
</button>
```
```css
.brand-btn { background: var(--accent); border-radius: 6px; padding: 5px 7px; }
.brand-btn .mark {
  width: 22px; height: 16px;
  background: url('images/tend-logo.png') no-repeat left center / auto 100%;
  filter: brightness(0);
}
```

The mark is fixed-size; the pill shrink-wraps. `background-position: left center`
+ `background-size: auto 100%` crops the full wordmark down to just the
T-with-bars symbol.

### Editorial section header

```html
<div class="db-sec-h">
  <h2><span class="sec-num">§01</span> / Today <span class="sec-label">/</span>
      <span style="color:var(--fg)">Operating Snapshot</span></h2>
  <span class="meta"><strong>SUN MAY 17</strong></span>
</div>
```

### KPI tile

```html
<div class="kpi-tile">
  <div class="lbl">Runs this week</div>
  <div class="val">8</div>
  <div class="foot">+3 vs last week</div>
</div>
```

Grid of 4 across desktop, 2×2 on tablet, stacked on phone. Tiles share a
1px border instead of independent borders.

### Connector chip strip

```html
<div class="conn-strip">
  <span class="lbl">Connectors</span>
  <a class="conn-chip"><span class="dot"></span>Gmail</a>
  <a class="conn-chip inactive"><span class="dot"></span>HubSpot</a>
  <a class="conn-add">+ ADD</a>
</div>
```

Live chips get a sage-green dot; inactive ones grey out the chip + dot.
The `+ ADD` chip uses a dashed amber border to signal "action".

### Chat composer (mobile)

A single rounded card. Textarea on top, action row on the bottom (`+`
left, paperclip / mic / send right). Focus glow lives on the card, not on
the textarea border. **Textarea must be 16px** to prevent iOS focus-zoom.

### Send button states

```css
.composer .send                   { background: var(--bg-3); color: var(--fg-mute); }
.composer .send.is-active         { background: var(--fg);   color: var(--bg); }
```

`.is-active` is toggled by JS the moment the input has a non-whitespace
character; reset on submit and on voice transcription.

---

## 9. Interaction principles

- **Tap targets ≥ 38px** on mobile composer; 34px elsewhere.
- **One accent action per surface.** A card has one primary affordance.
- **No modals for navigation.** Drawer slides in from the left; the daily
  welcome is a full-screen takeover, not a centered modal.
- **Inputs degrade gracefully.** Speech recognition unavailable → mic
  button hides. No DB connected → demo path accepts any credentials.
- **Compose-time feedback.** Send button highlights as soon as you type;
  textarea auto-grows to 160px max.

---

## 10. File mirror rule

The repo has two parallel app directories:

```
project/*.html         ← primary
tend/project/*.html    ← deployment mirror
```

**Every edit to a `project/*.html` file must be copied verbatim to
`tend/project/*.html`** before commit. If the two diverge, the
Railway deployment will serve stale content.

```bash
cp project/app.html tend/project/app.html
```

---

## 11. Things explicitly avoided

- **Drop shadows beyond hairlines.** No `box-shadow: 0 8px 24px …`.
- **Multiple accent colors.** Sage is the only accent. Amber is for warnings
  only.
- **Modal navigation.** Don't add Bootstrap-style modals.
- **Icon libraries.** Inline SVG only, 14–16px, `stroke-width: 1.6`.
- **Borders on focus.** Use box-shadow rings (`0 0 0 4px rgba(45,42,36,0.06)`)
  instead of swapping border color suddenly.
- **Animation durations > 300ms.** Most transitions sit at 120–180ms.
- **`vh` units on mobile.** Use `dvh` (with `vh` fallback) so the layout
  doesn't jump as Safari shows/hides its URL bar.

---

## 12. Quick checklist before merging UI changes

- [ ] Mirrored to `tend/project/`
- [ ] No new color tokens; existing ones used
- [ ] Mono labels in IBM Plex Mono with 0.06–0.14em letter-spacing
- [ ] Mobile composer textarea still 16px+
- [ ] Tested at 360px wide (iPhone SE), 768px (iPad), 1280px (laptop)
- [ ] No `vh` units; `dvh` instead
- [ ] No `touch-action: auto` on interactive elements
- [ ] Active nav state on the drawer link for the current page

---

_Questions, exceptions, or "is this a real rule or a vibe?" — read the
existing `app.html` / `dashboard.html` / `data-layer.html` first. The
source is the spec._
