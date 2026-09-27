# Speyside Way planner — redesign handoff

Restyle the existing app to match this spec. **Keep all current behaviour** (MapLibre map, draggable stop pins, click-trail-to-add-stop, marker popups, layer toggles, mi/ft toggle, Reset, per-day lodging/taxi/remove actions, URL hash state). This is a visual/layout change only — do not change routing, data or state logic unless needed to wire the new UI.

The reference mockup is `speyside-redesign-reference.html` (a design file — use it for exact values, not as code to paste in; ignore its `<x-dc>`, `{{…}}` and `DCLogic` template syntax).

## Design tokens

| Token | Value | Use |
|---|---|---|
| paper | `#F5F1E8` | app background, map label halos |
| panel | `#FBF9F4` | header, sidebar, floating map controls |
| card | `#FFFFFF` | day cards, popup |
| line | `#E2DCCD` (cards `#E7E1D3`, buttons `#D8D0BD`) | borders/dividers |
| ink | `#1F2A24` | primary text, pin outlines |
| muted | `#5B6660` (secondary text `#4A554F`) | labels, meta |
| forest | `#2E4B3C` | primary buttons, odd-day route |
| moss | `#7C9876` | even-day route |
| moss-tint | `#EAEFE6` | day badges, active layer chips |
| amber (accent) | `#C47F1E`; text-safe `#8F5A12` | selected day, "Pack a lunch", compass |
| amber tint | card bg `#FAF1E1`, border `#DDB57A`, tag bg `#F3E3C7` / text `#7A4C0F` | selected card, tags |
| heather | `#6E4A7E`; tint `#F4EFF5`/`#FBF7FC`, text `#5A3B69` | lodging markers & lodging buttons |
| food marker | amber `#C47F1E` rotated square | food layer |

**Fonts** (Google Fonts): `Newsreader` (400/500/600) for titles, place names, numbers; `Instrument Sans` (400/500/600) for UI. Use `font-variant-numeric: tabular-nums` on distances.
Radii: 10px buttons, 14px cards/floating panels, 16px popup, 999px pills. Shadow for floating items: `0 1px 2px rgba(31,42,36,.08), 0 8px 24px rgba(31,42,36,.10)`.

## Layout (desktop)

- **Header** 72px, panel bg, bottom border. Left: round forest logo mark + "Speyside Way" (Newsreader 23px) over "Inn-to-inn planner · Buckie to Newtonmore" (12.5px muted). Right: segmented units control (`mi · ft` / `km · m`, 34px tall, active segment white with shadow) and a "Reset route" outline button with a rotate-ccw icon.
- **Map** fills the left; **sidebar** 480px on the right with left border.

## Map

- Create a custom muted MapLibre style (or restyle OpenFreeMap's): land `#ECE7D8`, water `#C9D8D6`, rivers `#9DBAC0`, woodland `#DDE3CE`, roads `#DDD2B8`, place labels uppercase 12px `#7B7F72`, water labels italic Newsreader `#5F8583`. Hide most POI/road clutter.
- **Route:** draw each day as its own line, with a 10px `#FBF9F4` casing underneath. Odd days forest, even days moss, 4.5px. The **selected day** is amber, 7px.
- **Stop pins:** 26px circles, `#FFFDF8` fill, 2px ink border, number in 12.5px semibold. First and last stops filled ink with light text. The two pins bounding the selected day: amber fill, white number, white border, 30px.
- Stop names beside pins: 12px Instrument Sans ink with a 4px paper-coloured text halo.
- **Layer markers:** towns = 7px paper circles with `#4A564F` outline; lodging = 9px heather dots with paper outline; food = amber diamonds.
- **Floating controls:** top-left card "SHOW" + three toggle chips (Towns, Lodging, Food) with a matching marker swatch; active chip = forest 1px border + moss-tint bg; use `aria-pressed`. Top-right: stacked 44px zoom-in / zoom-out / reset-north (amber arrow) buttons in one rounded panel. Bottom-left: hint pill "Drag a numbered pin to move a stop · Click the trail to add one · Click any marker for details". Bottom-right: attribution 10.5px.
- **Stop popup** (replaces the default MapLibre popup look): 280px white card, 16px radius, big shadow. Eyebrow "STOP 7" (11px uppercase amber-text), name in Newsreader 22px, "End of day 6 · start of day 7" muted; heather-tint row with bed icon "No lodging chosen for this night yet" (or the chosen place); buttons "Choose lodging" (forest filled) and "Remove stop" (outline); close ✕.

## Sidebar

- **Summary:** eyebrow "YOUR ITINERARY", title "11 days, sea to hills" (Newsreader 30px), then a 3-cell stat strip in a white bordered box: Distance (total), Climbing (total gain), Nights booked ("0 of 11"). Totals are computed from the days and respect the units toggle.
- **Day cards** (scrolling list, 8px gap): white, 14px radius. Top part is one `<button>` that selects the day (highlight on map + open popup on its end stop):
  - 36px round badge with day number (moss-tint/forest; amber/white when selected)
  - "From → To" in Newsreader 18px (arrow muted), distance right-aligned Newsreader 20px + small unit
  - meta row 13px: mountain icon + gain; utensils icon + "1 lunch stop" / "3 lunch stops", or **"Pack a lunch"** in bold amber-text when 0; optional tag pill "Longest" / "Most climbing" (computed max values).
  - Bottom row (indented to align with title): dashed heather "Choose lodging" pill with bed icon (shows chosen lodging name once set), then 36px icon buttons: car (taxi/transfer), map-pin, ✕ remove — each with an `aria-label`.
- Selected card: amber tint bg + border + soft amber shadow.

## Mobile (<768px)

Header 60px (logo, title, compact `mi`/`km` toggle, reset icon button). Map fills the top ~340px and zooms to the selected day; layer chips float top-left as pills, "fit whole route" button top-right. Itinerary is a bottom sheet (22px top radius, grabber) with the summary line ("86.8 mi · 5,191 ft climbing" + "0 of 11 nights booked" pill), compact day rows, and the selected day expanded with full-width "Choose lodging in …" plus "Taxi & bags" and "Remove stop" buttons. All touch targets ≥44px.

## Accessibility

Real `<button>` elements everywhere, `aria-pressed` on toggles, `aria-label` on icon-only buttons, visible focus ring `2px solid #C47F1E`. Don't rely on colour alone (selected day also gets thicker line + larger pins).