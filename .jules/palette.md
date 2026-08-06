## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.
## 2024-08-06 - Missing button focus indicators
**Learning:** Found that `.zaf-btn` buttons in the `style-paperclip.css` file lacked focus indicators. Without them, keyboard navigation is unclear.
**Action:** Always verify keyboard accessibility explicitly and ensure solid-colored buttons utilize positive `outline-offset` values to draw the focus ring outside the element's border.
