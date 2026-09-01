## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-09-01 - Button Accessibility & Semantic Tab Close
**Learning:** Some custom buttons in the UI were missing `:focus-visible` styles and some interactive elements like tab-close were `<span>` tags without proper roles or ARIA labels.
**Action:** Always add `:focus-visible` styles to custom `.zaf-btn` buttons, use `<button>` tags instead of `<span>` for clickable actions, and provide aria-labels for icon-only buttons.
