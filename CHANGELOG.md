# pdf-cover-cards

## 1.2.1

### Patch Changes

- 2ebc204: Add storefront links for the free and Pro offers.

## 1.2.0

### Minor Changes

- 8c4430d: Browse pages on drawn PDF cards. Preserve literal percent signs in vault paths. Read Markdown PDF links with Unicode, spaces and parentheses. Reject nonfinite page sizes.

## 1.1.3

### Patch Changes

- b0b08cb: Recover corrupt saved covers from the PDF and wait for image decoding before marking cards drawn.

## 1.1.2

### Patch Changes

- 85e6f8b: Treat a GitHub sponsorship reply without an amount as a failed check, not a refusal, and stop the GitHub sign in when the settings close or the plugin unloads.

## 1.1.1

### Patch Changes

- adaf3db: A saved cover that cannot be read or written no longer shows an error on its card, and a large contact sheet export goes on more than one image instead of failing with no message.

## 1.1.0

### Minor Changes

- 3bca09d: Cards with a PDF get an Open at page button that opens the PDF at the page of the cover.

## 1.0.2

### Patch Changes

- efdff8f: Correct the GitHub Sponsors payment, check and token storage text in the README.

## 1.0.1

### Patch Changes

- b09257c: After a plugin update or reload with a base open, the view now runs the new plugin code. Before, Bases kept the old view, so Pro and the commands did not reach it until the tab was opened again.
