## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2026-07-08 - Zaf Button Focus Outline
**Learning:** Dynamically generated UI components in the dashboard bypass static HTML accessibility analysis, so we must map `:focus-visible` states in the CSS to maintain accessibility standards.
**Action:** Add `.zaf-btn:focus-visible` styles alongside normal `.zaf-btn` styles to ensure keyboard accessibility.
