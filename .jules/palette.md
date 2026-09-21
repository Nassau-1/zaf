## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-09-21 - Added aria-label to Icon-Only Zoom Controls
**Learning:** Found icon-only zoom control buttons in the Org Builder view without accessible labels. Screen readers would read ambiguous characters instead of intended functions.
**Action:** Always add descriptive `aria-label`s to icon-only interactive elements to ensure clear screen reader announcements and general accessibility compliance.
