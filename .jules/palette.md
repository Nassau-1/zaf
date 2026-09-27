## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-10-27 - Button and Tab Focus Visibility
**Learning:** Dynamic and custom-styled elements (like .zaf-btn and .zaf-control-tab) often miss native focus states when custom classes are applied without pseudo-classes.
**Action:** Always ensure that every custom interactive element explicitly includes a :focus-visible style for keyboard accessibility.
