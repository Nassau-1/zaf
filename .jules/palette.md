## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-10-18 - Semantic Buttons for Interactive Controls
**Learning:** Interactive controls like tab close buttons were implemented as `<span>` elements, breaking keyboard accessibility, and icon-only zoom buttons lacked ARIA labels.
**Action:** Always use semantic `<button>` elements (with necessary CSS resets to preserve design) for interactive actions, and ensure all icon-only buttons include descriptive `aria-label` attributes.
