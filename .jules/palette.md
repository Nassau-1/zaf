## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-09-29 - Missing Keyboard Focus on .zaf-btn Elements and ARIA labels on Zoom Controls
**Learning:** The ubiquitous `.zaf-btn` class lacked keyboard focus indicators, making large swaths of the application inaccessible to keyboard users, and icon-only zoom controls lacked ARIA labels for screen readers.
**Action:** Always ensure core button classes have `:focus-visible` styles mapped and icon-only buttons receive `aria-label` attributes, especially when refactoring or standardizing a UI kit.
