# Questionnaire template

A questionnaire carries the client's decisions on one or more tickets in a single document that a person sends. The
agent drafts it and never sends it. File: `intake/<date>_<topic>-QUESTIONNAIRE.md` in the client folder. One
questionnaire can cover several tickets when they go to the same recipient.

## Before drafting

Settle the send with the engineer, which they can always answer, rather than the subject, which they may not:

1. **Who receives it:** their role, and what they know that the team does not. This sets the tone and how much
   context the document carries.
2. **What must come back:** the list of decisions the team needs from this person. Every item on the list gets a
   question, and nothing else does.

## Rules for questions

- **One decision per question.** Never compound ("and should we also..."), because a compound question gets half an
  answer.
- **A proposed answer on every question,** so the client can reply "yes". Under the explicit-yes rule, "yes" against
  a proposed answer is a decision and a blank line is open.
- **Bounded choices inside the ticket.** Under a fixed-price contract a question must never invite new scope:

  | Invites scope (never) | Bounded (use) |
  |---|---|
  | "What other fields would you like on this form?" | "Should 'Reason for withdrawal' be required or optional?" |
  | "How else could the dashboard help your team?" | "Should the grid show 25 or 50 rows per page?" |
  | "Anything else the letter should say?" | "Should the letter give the office phone number, the email address, or both?" |

- **The client's words.** Name screens and fields as users see them, never a table, procedure, setting or id.
- **"Why this matters" sparingly,** only where a question could be misread or invite a throwaway answer.
- **Most important first,** within each section and across sections, since an async questionnaire may get one pass.
- **Name the ticket** each question serves, so every answer routes back to its brief.
- **Ask; never offer.** No promised dates, builds or changes. A commitment in a questionnaire is a commitment the
  contract may not cover.

## Template

```markdown
# <The decisions needed on <topic>>

**Purpose:** <why this exists, and the decisions riding on it>
**From:** <sender's role>   **To:** <recipient's role>
**How your answers will be used:** each answer is recorded as your decision on the item it names, and the
configuration is built to match it.

## Context

<One short paragraph: what the items are, what we found, what needs deciding. Enough to answer well, not a page.>

## How to answer

Please answer by <date>; it should take about <n> minutes. Each question has a proposed answer: write "yes" to accept
it, or write what you would prefer. "I don't know" is a useful answer; if you can, say who might know. Partial answers
help, so please send what you have.

## <Theme, most important first>

### Q1. <one decision, as a question> (<ticket>)

Proposed answer: <answer>

_Why this matters: <one line, only where needed>_

Your answer:

>

### Q2. <one decision, as a question> (<ticket>)

Proposed answer: <answer>

Your answer:

>

## Anything else?

Is there anything else we should know about these items?

>
```

## Alternative: one comment per decision

When the engineer prefers the ticket thread, draft one comment per decision instead, in the `asana-comments` style if
installed. The same rules apply: one decision, a bounded choice, a proposed answer, four sentences or fewer.

```
<One sentence of context.> We propose <the proposed answer>. Could you confirm, or tell us what you would prefer?
```

## Recording the answers

When answers come back (pasted by the engineer, or read from the board), record each one:

| Answer | Record as |
|---|---|
| "Yes", or a stated choice | Decided, on the Open-Questions note, with who, when and where |
| Blank, "fine", "whatever you think" | Open; re-ask with two concrete options |
| "I don't know" | Open, with who might know; a follow-up for the engineer |
| An answer that adds something the ticket did not ask for | Not a decision on this item; flag it to the engineer for `scope-check` |

Open-Questions entry, drafted through the KB ingestion path:

```
- <question> (<ticket>): DECIDED <date>. <the decision>. By <who>, in <link to the answer>.
```

Then run intake on the ticket again, so its brief's "Client decision cited" links the note. When the ticket is built,
the decision becomes the reason recorded in a Why-This-Config note.
