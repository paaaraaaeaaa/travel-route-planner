repo: dyryoo316/montage-web
branch: main

## Last sync
date: 2026-09-09T07:27:31Z

### Updated in this project
- Pulled Montage design tokens (color, spacing, radius, typography scale, button/segmented-control/alert/shadow styles) from wds-theme and wds packages
- Restyled the address-input route-planning wireframes with Pretendard font, blue #0066FF primary, coolNeutral grays, and Montage border-radius/shadow values
- Built a service-level Route Planner App screen (place cards, drag reorder, transport/criteria segmented controls, mock map + summary bar) reusing Montage tokens with a local green accent layer; WDS package itself untouched
- Imported a real South Korea SVG map (VictorCazanave/svg-maps, CC-BY-4.0, separate repo) as korea-map.svg for the Explore Destinations region picker

## Screen map
| Project screen | Repo source |
| --- | --- |
| Route Wireframes.dc.html (colors, radius, shadow) | packages/wds-theme/src/theme/{atomic,semantic,spacing,breakpoint}/*.ts |
| Route Wireframes.dc.html (typography scale) | packages/wds/src/components/typography/style.ts |
| Route Wireframes.dc.html (button visual style) | packages/wds/src/components/button/style.ts |
| Route Planner App.dc.html (colors incl. green accent, spacing, radius, shadow) | packages/wds-theme/src/theme/atomic/{coolNeutral,blue,green,red,orange}.ts, spacing/index.ts, semantic/index.ts |
| Route Planner App.dc.html (typography scale) | packages/wds/src/components/typography/style.ts |
| Route Planner App.dc.html (button/segmented-control/alert visual patterns) | packages/wds/src/components/{button,segmented-control,alert}/style.ts |
| Explore Destinations.dc.html (korea-map.svg) | VictorCazanave/svg-maps @ packages/south-korea/south-korea.svg (external CC-BY-4.0 repo, not the montage-web repo) |
