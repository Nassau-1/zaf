## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-06-03 - Button Accessibility
**Learning:** `.zaf-btn` buttons in the dashboard were missing the `focus-visible` CSS pseudo-class, rendering them inaccessible for keyboard navigation.
**Action:** Always verify that interactive buttons include `:focus-visible` with a clear outline to indicate focus.
