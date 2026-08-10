## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.
## 2024-06-12 - Interactive Spans Without Button Semantics
**Learning:** Found interactive elements (console tab close and filter clear) using `<span>` tags without keyboard accessibility or ARIA labels.
**Action:** Always use `<button>` elements for interactive UI actions to natively support keyboard navigation and screen readers. Ensure icon-only buttons have an `aria-label` and interactive elements have a `:focus-visible` state.
