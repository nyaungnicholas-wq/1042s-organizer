# IRS Form 1042-S — Field Map (research notes)

Source: IRS *Instructions for Form 1042-S* (2026) and *2024 Form 1042-S* PDF, pulled 2026-07-10.
Form title: **1042-S — Foreign Person's U.S. Source Income Subject to Withholding.**

## Why this matters for the organizer
The whole tool hinges on reliably reading **one field: Box 13a (Recipient's name)**.
The safest way to find it is by its *neighbors*, because the box layout is fixed:

```
 ... 12a–12m  Withholding agent's name / EIN / address ...
 ┌─────────────────────────────────────────┬───────────────────────────┐
 │ 13a Recipient's name                     │ 13b Recipient's country   │
 │        <<< THE NAME IS TYPED HERE >>>    │     code                  │
 ├──────────────────────────────────────────────────────────────────────┤
 │ 13c Address (number and street)                                       │
 │ 13d ...                                                                │
```

So the recipient's name is the text that sits:
- **below** the `13a` label,
- **left of** the `13b` label (which is on the same top row, to the right),
- **above** the `13c` label (the next row down).

That "box between three labels" rule is orientation-independent and survives font/scaling
differences, which is why the script locates the name by geometry rather than by fixed coordinates.

## Box 13 group (recipient block) — the anchors we rely on
| Box | Meaning | Role in script |
|-----|---------|----------------|
| **13a** | **Recipient's name** | value we extract + the segment key |
| **13b** | Recipient's country code | right boundary of the name box |
| **13c** | Address (number and street) | bottom boundary of the name box |
| 13d–13h | rest of address (apt, city, state, country, ZIP) | not used |
| 13i / 13l | Recipient's U.S. TIN / GIIN | not used |
| 13n | LOB code | not used |
| 13o | Recipient's account number | not used |
| 13p | Recipient's date of birth | not used |

(2024 form used 13a–13l; 2026 form uses 13a–13p. **13a/13b/13c are identical in both**, so the
anchor logic works on either version.)

## Valid Box 13a values that are NOT a normal person/company name
These are legitimate per the IRS instructions and must be treated as ordinary recipient names,
not as errors:
- `Unknown Recipient` (recipient code 21 / 29)
- `Withholding rate pool`
- A **QI / NQI / flow-through entity** name (an intermediary reported as the recipient)
- For **joint owners**, only **one** owner is listed in 13a.

## Distinguishing a FORM page from an INSTRUCTION page
A real 1042-S copy page has the boxed labels `13a`, `13b`, **and** `13c` present as standalone
tokens, in three different rows of the recipient block. The IRS "Instructions for Recipient" /
"Explanation of Codes" pages are prose — they may mention "boxes 13a through 13h" but they do not
lay out `13a`, `13b`, and `13c` as separate boxed labels on separate rows. The script uses that
(three anchors present, and 13a/13c on different rows) to tell form pages from instruction pages —
instruction pages carry no name and get attached to the form they follow.

## Copies
The official 1042-S is issued in copies (Copy B, C, D for the recipient; Copy A for the IRS), and
each copy is often followed by an instructions page. A single recipient's "packet" can therefore be
several pages, some of which repeat the name (the copies) and some of which have no name (the
instructions). The organizer treats a run of consecutive pages with the *same* name (plus the
no-name pages that follow) as **one packet** for that recipient.
