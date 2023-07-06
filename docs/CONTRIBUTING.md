# Contributing

All kinds of contributions for improving the KCL development on VS Code are welcomed.

This guide will explain the process to set up your development environment to work on the VS Code KCL extension.

## Developing

## Set Up

1. Install [node](https://nodejs.org/en/).

2. Install [VS Code](https://code.visualstudio.com/download) 1.50+

2. Clone the repository and run npm install:

```
git clone https://github.com/kcl-lang/vscode-kcl.git
cd vscode-kcl
npm install
code .
```

## Run

To run the extension, open the project with VS Code and open the Run view (Command+Shift+D), select Run Extension, and press F5. This will compile and run the extension in a new Extension Development Host window, in which you can create a KCL project and add some .k files to play with.

## Reference

- [VS Code Extension Development](https://code.visualstudio.com/api/extension-guides/overview)
- [VS Code Language Extension Development](https://code.visualstudio.com/api/language-extensions/overview)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
