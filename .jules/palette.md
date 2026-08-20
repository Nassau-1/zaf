## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.
## 2024-06-04 - Accessible Utilities
**Learning:** Utility buttons (zoom, refresh, console controls) without text labels rely entirely on tooltips, which are often inaccessible to screen reader and keyboard-only users.
**Action:** Always provide explicit aria-label attributes on icon-only and symbol-only utility buttons to ensure full accessibility.
