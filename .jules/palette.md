## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.
## 2024-06-03 - Focus Visible on Buttons
**Learning:** Buttons with class `.zaf-btn` lack visual feedback during keyboard navigation because they are missing `:focus-visible` styles.
**Action:** Always verify keyboard accessibility by ensuring interactive elements have a clear `:focus-visible` outline.
