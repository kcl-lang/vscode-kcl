# Change Log

All notable changes to the "kcl-vscode-extension" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Highlight KCL embedded in YAML block scalars, and provide completion, hover, definition, and diagnostics when the KCL language server is installed. Crossplane `KCLInput` `source` blocks are detected automatically. Other blocks opt in with a `# kcl` header comment.
- Initial release