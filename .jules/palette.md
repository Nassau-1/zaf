## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-08-07 - Button Focus Styles
**Learning:** Solid-colored buttons like `.zaf-btn` were missing `:focus-visible` styles, rendering them inaccessible for keyboard users, and negative outline offsets hide the focus ring.
**Action:** Always add `:focus-visible` styles with a positive `outline-offset` (e.g., `2px`) for solid-colored buttons to ensure proper visual contrast against the app background.
