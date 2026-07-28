# Knowledge package

The runtime knowledge layer is deliberately local and inspectable.

- `owner-manual.txt` is page-preserving text extracted from the 48-page owner manual. Form-feed characters delimit PDF pages.
- `quick-start-guide.txt` is the corresponding extraction from the quick-start guide.
- `facts.json` contains manually verified values and relations for duty cycles, cable polarity, process selection, troubleshooting, and visual assets.

The application combines lexical page retrieval with deterministic fact tools. Numeric values and cable mappings do not depend on embedding similarity or model memory.

The visual assets under `manual-images/` were rendered from the supplied PDFs and stored as portable base64 text. The server decodes them for the `/manual-pages/` route, and the `inspect_manual_visual` agent tool returns the same image bytes to Claude when a question depends on a diagram or table.

To regenerate the text and page images, run:

```bash
npm run preprocess
```

This regeneration step requires Poppler (`pdftotext` and `pdftoppm`) and Python 3. It is not required to run the application because all derived artifacts are committed.
