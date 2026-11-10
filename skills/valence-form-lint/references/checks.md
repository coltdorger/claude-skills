# The checks

Every check in `scripts/form-lint.cjs`, in the order it runs. For each: the fields it needs (absent means
`not_checked`), what it flags, the shapes it must not flag (each is a test case), its severity, the rubric area and
criterion it informs, its source, and the reason. **Kind** is `defect` (the form is wrong) unless marked `gap` (the
pack cannot show it), which the merge sends to `verify`.

Unless a check says otherwise, hidden widgets (`visible: false`) are skipped, because the user never sees them, and
read-only widgets are skipped where the rule is about a choice or an action the user cannot take.

## staging

- **Needs:** target.md, its Capture line, every screenshot it names, the pack file list.
- **Flags:** target.md missing; no Capture line, an unrecognised mode or two lines that disagree; a named screenshot
  missing or outside the pack; an earlier report in the pack (critical, and the summary says STOP). Capture REPLICA
  ONLY (major: the auditor scores a replica, but the gate cannot pass).
- **Does not flag:** a bold Capture line with a note after the mode; a `Capture width:` line; an image URL; prose
  about ".png files"; a scanner file named `wave-report.json`; the lint's own `mechanical.json`; a backtick-quoted
  screenshot name with spaces.
- **Severity** critical, kind gap. **Area** proof gate; never owned and never merged. **Source** V.
- **Why:** the ux-auditor returns "not staged" on an earlier report and cannot score a screenshot that is not there,
  so a staging fault caught here saves a run. It cannot be waived.

## unlabelled-field

- **Needs:** `type`, `visible`, `label`; uses `labelVisible`, `placeholder`, `ariaLabel`.
- **Flags:** a visible input whose label, without required markers and a trailing colon, holds no letter or digit, or
  whose label is set but `labelVisible` is false. The title says which: placeholder only, aria-label only, label not
  shown, or no label.
- **Does not flag:** a hidden input; static text, headings, grids and buttons; a placeholder beside a visible label.
- **Severity** major. **Area** words: field labels. **Source** U: impeccable's field-label rule (a label counts only
  where a reader sees it, and aria-label never counts) and open-design's accessibility baseline (placeholder-only
  labelling fails WCAG 1.3.1 and 3.3.2).

## duplicate-label

- **Needs:** `type`, `visible`, `label`; uses `section`.
- **Flags:** two or more visible inputs whose labels read the same once case, colon and required marker are set aside.
  Major when two share a section or a section is not recorded; minor when each sits in a different section.
- **Does not flag:** "Address line 1" and "Address line 2"; a hidden input with the same label; a heading whose text
  matches an input label.
- **Area** words: field labels. **Source** U: impeccable's clarify flags "vague labels" and "inconsistent
  terminology"; two fields under one name is the sharpest case. A screen reader announces both by the same name even
  when a section heading separates them on screen.

## repeated-text

- **Needs:** `visible`, `label`, `section`; uses `help`.
- **Flags:** the same text as the label or help text of three or more visible widgets in one section, unless every
  occurrence is an input label (that is `duplicate-label`'s finding, so it is not reported twice).
- **Does not flag:** the same help text in different sections; two occurrences; a hidden widget.
- **Severity** minor. **Area** words: repeated text. **Source** U: impeccable's `repeated-container-text` rule ("the
  same literal text rendered three or more times ... inside a single card or panel").

## generic-button

- **Needs:** `census.footer[].label`.
- **Flags:** a visible footer button whose label is exactly OK, Yes, No or Submit, ignoring case and a trailing full
  stop, colon or exclamation mark.
- **Does not flag:** "Submit renewal"; a hidden OK; an OK button in the form body.
- **Severity** minor. **Area** actions: button wording. **Source** U: impeccable's clarify ("name the action on both
  the message and button instead of using Yes, No, OK, or Submit").

## footer-count

- **Needs:** `census.footer`.
- **Flags:** more than three visible footer buttons.
- **Does not flag:** three buttons; four with one hidden.
- **Severity** minor. **Area** actions: footer actions. **Source** U: impeccable's working-memory rule ("action buttons:
  1 primary, 1-2 secondary, group the rest").

## footer-exit

- **Needs:** `census.footer[].label`; uses `census.closeControl` and visible body buttons and links.
- **Flags:** no visible footer or body button whose label starts with Cancel, Close, Back, Exit, Discard, Go back or
  Previous, and `closeControl` is not true.
- **Does not flag:** "Close window"; "Discard changes"; a body link "Back to search"; a dialog with its own close
  control. "Return to applicant" and "Send back" are workflow actions, not exits, and do not count.
- **Severity** major. **Area** actions: a way out. **Source** U: impeccable's heuristic 3, user control and freedom
  ("cancel buttons on forms and modals"). If a body widget could not be read, the check is not checked rather than
  reporting a missing exit that may be there.

## choice-overload

- **Needs:** `type`, `visible`, `options`; uses `readOnly`.
- **Flags:** an editable radio group or checkbox list of 5 to 7 options (advisory) or 8 or more (major).
- **Does not flag:** a dropdown of any length; four radios; a read-only or hidden group.
- **Area** widget fit: choice size. **Source** U: impeccable's working-memory rule ("5-7 items: pushing the boundary
  ... 8+ items: overloaded"). The advisory never costs points by itself.

## dropdown-options

- **Needs:** `type`, `visible`, `options`; uses `readOnly`, `dependsOn`.
- **Flags:** an editable dropdown, radio group or checkbox list with 0 options (critical); a dropdown with 1 option
  (minor); a dependent list with 0 options (advisory: confirm it fills in the populated capture).
- **Does not flag:** two options; a read-only dropdown, which shows a value, not a choice; one option filtered by a
  parent; a hidden empty list.
- **Area** widget fit: lookup lists. **Source** V: an empty list is usually an inactive or empty lookup failing
  silently, the platform's commonest silent failure on a form. Radio groups and checkbox lists bound to a lookup fail
  the same way, so the 0-option rule covers them too.

## required-blocked

- **Needs:** `type`, `required`, `visible`, `readOnly`; uses `hasValue`, or `value` tested for emptiness only.
- **Flags:** a required input that is hidden or read-only and empty (critical); the same with no fill state recorded
  (major, kind gap).
- **Does not flag:** a read-only required field the platform filled; a hidden required field that holds a value; a
  field that is not required.
- **Area** task flow: required fields reachable. **Source** V: the user cannot fill the field, so the save is refused
  or fails silently, and the task is blocked.

## required-markers

- **Needs:** `type`, `visible`, `required`, and `requiredMarker` or `label`.
- **Flags:** a required editable field with no marker while other required fields show one (major); an optional field
  that shows a marker (minor). When `requiredMarker` is not recorded the marker is read from the label text: a leading
  or trailing `*`, or `(required)`.
- **Does not flag:** every required field marked; no marker in any label text (the platform may draw markers with
  styling the census cannot see); "Rate * hours"; "Required documents"; a read-only required field.
- **Area** words: required markers. **Source** U: impeccable's clarify ("required and optional treatment should be
  consistent").

## theme-approved

- **Needs:** `client-block.md` with a `lint-themes:` line; `visible`, `theme`.
- **Flags:** one finding per theme outside the approved list, naming the widgets that use it.
- **Does not flag:** an approved theme in another case; a hidden widget.
- **Severity** major. **Area** visual restraint: approved themes. **Source** V: the client signed off a fixed set of
  themes.

## theme-mixed

- **Needs:** `visible`, `theme`.
- **Flags:** two or more themes on one form; the finding names the widgets outside the most used theme.
- **Does not flag:** one theme written in two cases; a hidden widget in another theme.
- **Severity** minor. **Area** visual restraint: one theme per form. **Source** V.

## small-target

- **Needs:** `type`, `visible`, `box`; uses `readOnly`.
- **Flags:** an editable interactive widget whose box is under 24 px in either dimension and fails the spacing test: a
  24 px circle on its centre touches another target, or another small target's circle.
- **Does not flag:** a small target with room around it; exactly 24x24; a zero box (not rendered at that width); a
  read-only control; a heading.
- **Severity** minor. **Area** responsive and accessible: target size. **Source** U: open-design's accessibility
  baseline. This is a quality finding, **not a WCAG 2.1 AA failure**: the 24x24 minimum (SC 2.5.8) arrived in WCAG
  2.2, and 44x44 (SC 2.5.5) is AAA. Footer buttons carry no box in the contract and are not checked here.

## all-caps-text

- **Needs:** `visible`, `label`; uses `help`.
- **Flags:** a label or help text of 80 or more characters, with at least 20 letters, none of them lowercase.
- **Does not flag:** short labels in capitals ("APPLICANT NAME", "SSN"); a long help text in sentence case; a long run
  of codes with few letters; a hidden widget.
- **Severity** minor. **Area** words: readable text. **Source** U: impeccable's `all-caps-body` rule ("only a run that
  reads as a sentence counts: 80 characters or more"; short labels in caps are a convention).

## internal-name

- **Needs:** `visible`, `label`; uses footer labels.
- **Flags:** a label token with an underscore between letters or digits, or a CamelCase token of three or more parts,
  or of two parts whose last is a field word (Id, Code, Date, Name, Type, No, Number, Status and the like):
  `Applicant_FirstName`, `LicenseTypeId`, `ZipCode`, `IDNumber`, `btnSaveRecord`.
- **Does not flag:** place names (DeKalb, McHenry, LaSalle); product and degree names (PayPal, LinkedIn, PhD, iPhone);
  a fill-in line `________`; an acronym such as SSN.
- **Severity** major. **Area** words: internal names. **Source** U+V: impeccable's clarify ("internal jargon",
  "do not expose internal codes"), and the Valence habit of a field name shipping as its own label.

## keyboard-coverage

- **Needs:** `keyboard.md` in the structured table; `type`, `visible`; uses `readOnly` and footer ids.
- **Flags:** a visible, editable interactive widget, or a footer button with an id, that no walk row names.
- **Does not flag:** a hidden or read-only widget; static text, headings and grids; ids written in backticks.
- **Severity** major. **Area** responsive and accessible: keyboard reach. **Source** U: open-design's accessibility
  baseline (WCAG 2.1 SC 2.1.1, Level A).

## keyboard-order

- **Needs:** `keyboard.md` in the structured table; `box` on the widgets the walk visits.
- **Flags:** a Tab step to a widget first visited that sits left of the last one in the same row, or above it other
  than in the next column to the right.
- **Does not flag:** down the left column and then up into the right column; focus wrapping round to the first field,
  as a dialog does; Shift+Tab rows. With fewer than two comparable Tab steps, it is not checked.
- **Severity** major. **Area** responsive and accessible: focus order. **Source** U: open-design's accessibility
  baseline (WCAG 2.1 SC 2.4.3, Level A).

## keyboard-trap

- **Needs:** `keyboard.md` in the structured table.
- **Flags:** a walk row whose result starts with "trapped" or "trap".
- **Does not flag:** "focused (no trap)"; "Escape closes the dialog". A dialog holding focus until Escape or Close is
  the design, not a trap.
- **Severity** critical. **Area** responsive and accessible: keyboard trap. **Source** U: open-design's accessibility
  baseline (WCAG 2.1 SC 2.1.2, Level A).

## state-captures

- **Needs:** target.md; `type`, `visible` to find the grids.
- **Flags:** one finding per surface (the form, and each visible grid) that lacks a captured populated, empty, error
  or edge state in the states table. Major when populated or error is missing, minor otherwise. With no states table,
  every surface lacks all four.
- **Does not flag:** a hidden grid; the table's columns in another order; surface names in another case.
- **Severity** major, kind gap. **Area** task flow: state evidence. **Source** U: open-design's state coverage ("the
  single most reliable AI-design failure is shipping only the populated state"). Populated and error weigh most:
  populated is where the task runs, and error is where this platform fails silently.

## error-as-empty

- **Needs:** the states table in target.md.
- **Flags:** an error row whose `shows` says `as-empty`, "shown as empty" or "same as empty", or that cites the same
  screenshot as the empty row of the same surface.
- **Does not flag:** "red border on the blank required field"; `as-empty` on an empty row.
- **Severity** critical. **Area** task flow: error states. **Source** U: open-design's state coverage, which says
  error-as-empty is "never" acceptable. On this platform an empty grid is the usual face of a failed procedure, and
  the user reads it as "no records".

## text-overflow

- **Needs:** `type`, `visible`, `text`; for a button or link without `text`, an estimate from `box`, `fontSize` and
  the label.
- **Flags:** measured text that needs more than 2 px beyond its box (major, defect); a button whose label, estimated
  at half the font size per character (0.62 in capitals) plus 16 px padding, exceeds its width by 10% (minor, gap).
- **Does not flag:** text within 2 px; an estimate that fits; a hidden widget; grids and images.
- **Area** widget fit: text fits. **Source** U: impeccable's `text-overflow` rule ("content renders wider than its
  container and the spill does harm"). The estimate is a measurement substitute, so it goes to verify, never to
  points.

## clipped-dropdown

- **Needs:** `type`, `visible`, `box`, `optionW`.
- **Flags:** a dropdown whose widest option needs more than 2 px beyond its width.
- **Does not flag:** within 2 px; a hidden dropdown; a radio group.
- **Severity** minor. **Area** widget fit: text fits. **Source** V: squeezed lookup controls cut the chosen option off.

## narrow-overflow

- **Needs:** `visible`, and `box375` per widget or `narrowScrollWidth`; uses `type` to exempt grids.
- **Flags:** a visible widget whose 375 px box runs past the viewport; or, with no widget to blame, a page scroll width
  over 376 px.
- **Does not flag:** a data grid (WCAG 1.4.10 exempts content that needs two dimensions); a right edge inside the
  viewport; a hidden widget. A recorded page width of 375 px answers the question for every widget.
- **Severity** major. **Area** responsive and accessible: 375px reflow. **Source** U: impeccable's audit ("horizontal
  scroll: content overflow on narrow viewports") and WCAG 2.1 SC 1.4.10, Level AA.
