# Pack contract

What `scripts/form-lint.cjs` reads from an evidence pack. The capture tool's census schema is private and differs by
platform version, so this file names only the fields the lint reads. Map your census to it in the capture tool or
with a small adapter in the client folder. A field the census does not carry is simply absent, and every check that
needs it reports `not_checked` with the field's name; a field in the wrong shape (a string where a number belongs)
counts as absent.

## The pack folder

| File | Required | Read for |
|---|---|---|
| `census.json` | yes; without it, or unreadable, the lint exits 2 | every widget check |
| `target.md` | yes; without it `staging` raises a critical finding | capture mode, screenshots, states table, fixed-constraint waivers |
| `keyboard.md` | no; without it the three keyboard checks are not checked | the keyboard walk |
| `client-block.md` | no; without it `theme-approved` is not checked and no platform-limit waiver applies | approved themes, proven platform limits |
| screenshots | the ones target.md names | existence only |
| accessibility scans, side-effect counts | as the auditor needs them | not parsed; scanned only for the shape of an earlier report |
| `mechanical.json` | written by the lint | overwritten each run |

Name accessibility scans after the scanner and the theme (`a11y-default.json`), and keep earlier reports out of the
pack (see the last section). Screenshot names are relative to the pack folder; put a name that holds spaces in
backticks.

## census.json

Top level:

| Field | Type | Meaning | Used by |
|---|---|---|---|
| `widgets` | array | Every widget as rendered, hidden ones included. Required. | every widget check |
| `footer` | array of `{label, id?, visible?}` | The footer buttons in order. `visible` defaults to true, because the footer is listed as rendered. Give an `id` to have the keyboard walk checked for it. | generic-button, footer-count, footer-exit, keyboard-coverage, internal-name |
| `captureWidth` | number | The desktop viewport width the boxes were measured at, in CSS px. | reported |
| `narrowScrollWidth` | number | The document's scroll width at a 375 px viewport. | narrow-overflow |
| `closeControl` | boolean | The dialog draws its own close control, so the user has a way out without a footer button. | footer-exit |

Per widget, the minimal fields:

| Field | Type | Meaning |
|---|---|---|
| `id` | string or number | Unique in the census. Required: without it, or on a repeat, the lint exits 2, because every finding cites it. |
| `type` | string | The platform's type name, mapped to a kind below. A `kind` field, if present, wins over `type`. |
| `label` | string or null | The visible label as rendered: for a button its text, for static text or a heading the text itself. `""` or null when none shows. |
| `visible` | boolean | Rendered at capture. |
| `required` | boolean | The platform enforces a value. |
| `readOnly` | boolean | Shown but not editable. |
| `options` | integer, or array | Selectable options at capture, not counting a blank or "Select..." entry. For an array only its length is used; its contents are never read. |
| `theme` | string | The theme or style the widget renders with. |
| `section` | string | The heading of the section the widget sits in. |
| `box` | `{x, y, w, h}` | Border box at `captureWidth`, CSS px. For an input, the control without its label. |
| `fontSize` | number | Font size of the widget's text, px. |

Optional fields that sharpen a check:

| Field | Type | Meaning | Used by |
|---|---|---|---|
| `kind` | string | A contract kind, when the platform type name is not in the table below. | every typed check |
| `field` | string | The data field the widget binds to; cited in findings as the field name. | where |
| `help` | string | Help text as rendered. | repeated-text, all-caps-text |
| `placeholder`, `ariaLabel` | string | Placeholder text and the aria-label, to say which kind of missing label it is. | unlabelled-field |
| `labelVisible` | boolean | False when a configured label is not rendered (display none, screen-reader-only text). | unlabelled-field |
| `requiredMarker` | boolean | A required indicator renders by the label. When absent, the lint reads `*` or `(required)` in the label text. | required-markers |
| `hasValue` | boolean | The widget holds a value at capture. When absent, `value` is tested for emptiness. | required-blocked |
| `dependsOn` | string | The widget id a cascading list fills from. | dropdown-options |
| `box375` | `{x, y, w, h}` | Border box at a 375 px viewport. | narrow-overflow |
| `text` | `{need, have}` | `scrollWidth` and `clientWidth` of the element holding the widget's text (the label element for an input, the button itself for a button). | text-overflow |
| `optionW` | number | The width the widest option needs inside the closed dropdown, arrow and padding included. | clipped-dropdown |

A widget may also carry `value`, which may be record data. The lint reads it only to test whether a hidden or
read-only required field is empty, and never writes it anywhere.

### Kinds

Type names match without case, spaces or punctuation (`Drop Down`, `drop-down` and `dropdown` are the same).

| Kind | Platform names that map to it |
|---|---|
| text | text, textbox, input, string, singleline |
| textarea | textarea, multiline, memo, longtext |
| richtext | richtext, rte, editor, htmleditor |
| number, money | number, numeric, integer, decimal; money, currency |
| date, datetime, time | date, datepicker; datetime, datetimepicker; time, timepicker |
| email, phone | email; phone, tel, telephone |
| dropdown | dropdown, dropdownlist, select, combobox, combo, ddl, lookup, picklist |
| typeahead | typeahead, autocomplete, searchlookup, lookupsearch (options load as the user types, so its count is never checked) |
| radio | radio, radiogroup, radiolist, radiobuttonlist, radiobuttons |
| checkbox, checkboxlist | checkbox; checkboxlist, checkboxgroup, checkboxes |
| file | file, fileupload, upload, attachment |
| button, link | button; link, hyperlink, anchor |
| grid | grid, datagrid, gridview, table |
| static, heading | static, statictext, literal, label, textblock, html, note, instructions; heading, header, title, sectionheader |
| image, layout | image, img, logo; section, panel, group, spacer, divider, container |

Inputs (need a label, can be required) are every kind from text to file. Choice lists are dropdown, radio and
checkboxlist. Interactive widgets (keyboard walk, target size) are the inputs plus button and link. Each visible grid
needs its own state captures. Any other type name leaves that widget unchecked for every typed check, reported as
`widget.type (not in the contract vocabulary)`: add a `kind`.

### A minimal census

```json
{
  "captureWidth": 1280,
  "narrowScrollWidth": 375,
  "widgets": [
    { "id": "txt-first", "type": "TextBox", "field": "FirstName", "label": "First name", "visible": true,
      "required": true, "readOnly": false, "requiredMarker": true, "theme": "Default", "section": "Applicant",
      "box": { "x": 32, "y": 150, "w": 280, "h": 36 }, "box375": { "x": 16, "y": 150, "w": 343, "h": 36 },
      "fontSize": 14, "text": { "need": 70, "have": 280 } },
    { "id": "ddl-type", "type": "DropDownList", "label": "License type", "visible": true, "required": true,
      "readOnly": false, "requiredMarker": true, "options": 6, "optionW": 240, "theme": "Default", "section": "Applicant",
      "box": { "x": 32, "y": 230, "w": 280, "h": 36 }, "fontSize": 14 }
  ],
  "footer": [ { "id": "btn-save", "label": "Save application" }, { "id": "btn-cancel", "label": "Cancel" } ]
}
```

## target.md

The auditor reads target.md as prose; the lint reads four kinds of line in it.

**Capture line.** One line, `Capture: LIVE WALK` or `Capture: REPLICA ONLY`, as plain text, a list item, bold or a
heading. Text after the mode is allowed (`Capture: LIVE WALK (STAGE, walked by the engineer)`). Two Capture lines
that disagree, or none, is a critical staging finding. A line such as `Capture width: 1280` is not a Capture line.

**Screenshots.** Every image file name anywhere in target.md (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`) must
exist in the pack. URLs are ignored. A path that starts at a drive or the root, or holds `..`, leaves the pack and is a
critical finding, because the pack must be complete on its own.

**States table.** A markdown table with `surface`, `state` and `screenshot` columns, plus an optional `shows` column,
in any order:

```
| surface | state | screenshot | shows |
|---|---|---|---|
| form | populated | 01-populated.png | every field filled |
| form | empty | 02-empty.png | new record |
| form | error | 03-error.png | banner names the failed save and keeps the input |
| form | edge | 04-edge.png | longest values in every text field |
| grid:grd-history | populated | 01-populated.png | three rows |
| grid:grd-history | empty | 05-grid-empty.png | message: no history yet |
| grid:grd-history | error | 06-grid-error.png | as-empty |
| grid:grd-history | edge | 04-edge.png | sixty rows, paged |
```

Surfaces are `form` and `grid:<widget id>` for each visible grid. States are populated, empty, error and edge. A
screenshot cell of `-`, `none` or no file name means not captured. In `shows`, write `as-empty` (or "shown as empty")
when the error capture looks like the empty state; the same screenshot cited for error and empty means the same.

**Fixed constraints and waivers.** A heading whose text contains "Fixed constraints" starts the section; the next
heading ends it. A waiver line inside it reads `lint-waive <check> [<widget id>]: <reason>`, as plain text, a list
item or in backticks. A `lint-waive` line anywhere else in target.md waives nothing and is listed as a waiver error.

## keyboard.md

The auditor reads the walk however it is written; the lint reads it only from a table with `step`, `key`, `widget`
and `result` columns, in any order:

```
| step | key | widget | result |
|---|---|---|---|
| 1 | Tab | txt-first | focused |
| 2 | Tab | ddl-type | focused |
| 3 | Shift+Tab | txt-first | focused |
| 4 | Tab | txt-notes | trapped |
```

`widget` is the census widget id or the footer button id, in backticks or not; `-` for a row with no widget. `key`
`Tab` rows drive the order check; other keys are read for coverage and traps only. A `result` whose first word is
`trapped` (or `trap`) marks a keyboard trap; anything else means focus arrived. A walk in prose leaves the three
keyboard checks not checked.

## client-block.md

A copy of the client block, placed in the pack when it is staged. The lint reads two kinds of line:

```
lint-themes: Default, High contrast
lint-waive footer-exit: proven: the platform dialog always draws its own Close control
```

`lint-themes:` lists the approved themes, compared without case. A `lint-waive` line here is a platform limit and
waives only when its reason starts with `proven:`, because an unproven limit is a guess.

## What counts as an earlier report

The auditor is never shown an earlier score. The lint treats a file in the pack, at any depth up to four folders, as
an earlier report when its path contains `auditor`, `ux-audit`, `ux-report`, `verdict` or `merged`, or when it is JSON
with a top-level `verdict` or `gates` key, the shape of the auditor's output. A file named only `report` (a scanner's
`wave-report.json`) is not flagged by name. The lint's own `mechanical.json` is judged by its content only. Links are
skipped, because a link could point outside the pack.
