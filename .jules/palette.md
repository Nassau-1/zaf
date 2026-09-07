## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-06-03 - Org Builder Zoom Controls Accessibility
**Learning:** Found that the zoom controls (-, +, ⟲) in the Org Builder lacked `aria-label` attributes and the `.zaf-btn` class lacked `focus-visible` styles, making them inaccessible for screen reader and keyboard users.
**Action:** Added `aria-label` to the icon-only zoom buttons and `focus-visible` outline styles to the `.zaf-btn` class to improve accessibility and keyboard navigation.
