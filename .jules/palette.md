## 2024-05-14 - Keyboard Accessibility for ZAF Buttons
**Learning:** Found that primary buttons with solid backgrounds `.zaf-btn` lack proper `:focus-visible` styles which hurts keyboard navigation accessibility.
**Action:** Always include a `:focus-visible` outline to ensure buttons have a visual indicator when focused by keyboard users. Since the button uses a solid background, use a positive outline-offset so the focus ring is visible against the application background.

## 2024-07-28 - Appending Journal Entries Correctly
**Learning:** Found that I overwrote the entire `.jules/palette.md` file using `>` instead of appending to it with `>>` when first exploring the codebase and drafting the journal entry. This destroys historical agent memory context.
**Action:** Always use the append operator `>>` (or a programmatic append operation) when writing to journal files like `.jules/palette.md` so that previous insights are not lost.
