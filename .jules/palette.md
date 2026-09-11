## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.
## 2024-09-11 - ARIA Labels for Icon/Title Buttons
**Learning:** Found multiple buttons across the dashboard (like zoom controls, console actions, and refresh buttons) that relied solely on `title` attributes for tooltips but lacked proper `aria-label`s. This makes them less accessible to screen readers that prioritize or require `aria-label` for semantic meaning.
**Action:** Always duplicate `title` attributes as `aria-label`s on icon-heavy or tooltip-reliant buttons to ensure full accessibility support.
