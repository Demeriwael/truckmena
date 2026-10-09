# Wayline accessibility

Wayline supports keyboard navigation, responsive layouts, light/dark themes, and a text alternative to daily log graphics. This guide describes the implemented behavior and the checks used to review it.

## Keyboard and focus behavior

| Area                            | Behavior                                                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page navigation                 | The first keyboard link skips to the focusable main landmark. Unknown paths show a titled 404 page with a link back to the planner.                                                                   |
| Address suggestions             | Arrow keys, Home/End, Enter, Escape, and Tab support suggestion selection. Home/End retain text-editing behavior until an option is active; modified arrow keys remain native editing keys.           |
| Address changes                 | Editing a selected address removes its old coordinates. Clearing returns focus to the input. Sample loading and location swaps are announced.                                                         |
| Validation                      | Invalid submission focuses a named error summary. Its buttons focus the relevant fields and open optional details before focusing hidden fields. Inline errors remain associated with their controls. |
| Result tabs                     | Left/Right arrows, Home, End, and Tab navigate Summary, Itinerary, and Log Sheets, with visible focus outlines.                                                                                       |
| Map markers                     | Names include the event, place, and arrival time. Enter and Space select the same event as a pointer click. The expandable stop list also opens popups.                                               |
| Request and download completion | Success notices and error banners receive focus when appropriate. If focus moves elsewhere while waiting, completion preserves that choice.                                                           |

Address suggestions wait 350 ms and require three characters. Cached suggestions remain fresh for five minutes. A complete address can still be submitted when autocomplete fails; see [provider behavior](PROVIDERS.md).

## Results and map synchronization

Selecting an itinerary row opens its map popup. Pointer selection also brings the map into view; keyboard selection keeps focus and the itinerary visible so the next row remains reachable. Map selection opens Itinerary and scrolls its internal list to the corresponding event.

Hovering or focusing a row highlights its marker; map hover highlights the row. Driving events get a temporary start marker while selected or hovered. A new successful plan clears selection and returns to Summary. Edited or updating results are labeled stale.

Itinerary rows split overnight events into portions on each occupied calendar date. Continued rows retain the original event ID and explicitly open the full event at its original start coordinate and time. They do not invent a new driving position at midnight. An exact midnight finish adds no empty day. All times retain the API's fixed trip offset.

## Responsive layout and presentation

- Below 1024 px, the form, map, and results use a single column. Phone controls have 44 px touch heights, address fields use 16 px text, and the cycle slider has a 28 px hit area.
- Form and itinerary scroll areas leave room for sticky controls and day headings. The original-width log sheet scrolls inside its preview; surrounding page content reflows.
- **View log details as text** exposes full headers, duty totals, exact-minute durations, and complete remarks at narrow widths. See [log previews and exports](LOG_SHEETS.md#preview-and-exports).
- Status labels include text alongside color. Light/dark themes include visible input borders and focus outlines; map popups follow the theme.
- Reduced-motion styles and the animation library's user preference handling are enabled. Dark theme persists locally; light theme is the default. Fonts are self-hosted.

## Automated checks

[Accessibility tests](../frontend/src/accessibility.test.tsx) run pinned axe-core checks on the form, open autocomplete, failed validation, all three result views, and the 404 page. Interaction tests cover focus restoration, hidden fields, native editing keys, and keeping keyboard itinerary selection in view. axe-core is a development dependency and is not included in the application bundle.

jsdom does not render contrast or reflow. Its color-contrast rule is disabled, so those checks require a real browser. Automated semantics checks and the recorded browser review are not a screen-reader certification. Manual NVDA/VoiceOver review remains useful before a wider production release.

Run the frontend checks through the root commands in [Contributing](CONTRIBUTING.md#quality-checks). Previously completed browser checks are preserved in the dated [deployment verification record](DEPLOYMENT.md#verification-record).

## Manual review procedure

Use viewport widths of 320, 390, 768, 1024 px, and a normal desktop width. Repeat the relevant checks in light and dark themes.

1. Tab to the skip link, enter the planner, and submit an empty form. Follow each error-summary button and confirm that its field receives focus.
2. Type an address, navigate suggestions, and check native text-editing keys. Clear the address, load the sample, and plan using Enter.
3. Navigate every result tab by keyboard. Select an itinerary event with Enter and a map marker with Space. Check that keyboard selection stays in view.
4. Navigate log dates, use **Enlarge** and **Fit to width**, and read the text-details disclosure. Check full remarks and long header values at narrow widths.
5. Change a planned trip and confirm that stale results are labeled and downloads are disabled. During a new request or download, move focus elsewhere and confirm completion preserves it.
6. Enable reduced motion and review transitions. Visit an unknown path and use its return link.

These are review instructions, not a claim that every viewport or assistive technology has been tested in the current environment.

Design references: [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), and the [ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

[Back to README](../README.md)
