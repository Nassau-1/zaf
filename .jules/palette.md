## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-11-10 - Replace Interactive Spans with Accessible Buttons
**Learning:** Found pattern of using `<span>` for interactive dashboard controls (e.g. `.filter-clear`, `.tab-close`), which breaks keyboard accessibility.
**Action:** Always use `<button>` elements for interactive UI controls with semantic button resets, ARIA labels, and `:focus-visible` styles to ensure full accessibility for keyboard and screen reader users.
