## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.
## 2024-06-04 - Missing Focus Styles on Component Variants
**Learning:** The `.zaf-btn` class in `style-paperclip.css` didn't inherit the standard `.btn` focus states from the core design system, creating an accessibility gap for keyboard navigation.
**Action:** When adding new interactive component classes, explicitly implement `:focus-visible` styles (with a positive `outline-offset` for solid backgrounds) to match core components.
