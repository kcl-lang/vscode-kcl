# KCL Extension for Visual Studio Code

The [VS Code KCL extension](https://marketplace.visualstudio.com/items?itemName=kcl.kcl-vscode-extension) provides rich language support for the [KCL language](https://kcl-lang.io/).

## Quick Start

Welcome to KCL developing! We hope this extension enhances your development experience with KCL.

- **Step 1.** Install KCL on your system.
  - If you are a Kusion user, it is recommended to install the [VS Code Kusion extension](https://marketplace.visualstudio.com/items?itemName=KusionStack.kusion). It will provide more rich features and guide you to install Kusion.
  - If you just want to use KCL alone, you need to [install KCL](https://kcl-lang.io/docs/user_docs/getting-started/install)

  Please check that `kcl` and `kcl-language-server` are installed and have been added to Path
  ```bash
  which kcl
  which kcl-language-server
  ```

- **Step 2.** Install the KCL extension for Visual Studio Code. This extension requires the VS Code 1.50+
- **Step 3.** Open or create a KCL file and begin your KCL tour!

## Features

This extension provides some coding assistance, including the following features:

- Syntax Highlight
  <div style="text-align: center;"><img src="docs/images/highlight.jpg" alt="Goto Definition"  style="width: 75%"> </div>
- **Goto Definition:** Goto definition of schema, variable, schema attribute, and import pkg.
  <div style="text-align: center;"><img src="docs/images/GotoDef.gif" alt="Goto Definition"  style="width: 75%"> </div>
- **Completion:** Keywords completions and dot(`.`) completion.
  <div style="text-align: center;"><img src="docs/images/Completion.gif" alt="Completion"  style="width: 75%"> </div>
- **Outline:** Main definition(schema def) and variables in KCL file
  <div style="text-align: center;"><img src="docs/images/Outline.gif" alt="Outline"  style="width: 75%"> </div>
- **Hover:** Identifier information (type and schema documentation)
  <div style="text-align: center;"><img src="docs/images/hover.gif" alt="Hover"  style="width: 75%"> </div>
- **Diagnostics:** Warnings and errors in KCL file.
  <div style="text-align: center;"><img src="docs/images/Diagnostics.gif" alt="Diagnostics"  style="width: 75%"> </div>

Other useful features such as refactoring and testing are in development.

## Dependencies

We recommend that you use the latest version of KCLVM, but the minimum required version for this extension is 0.4.6. If you are using an earlier version, the extension may not work properly.

## Known Issues
+ Hover and GotoDefintion: The current hover and goto definitions are similar to global search, and there may be multiple results for some Identifiers with the same name.
+ Completion: Semantic completion is not yet supported.

## Ask for help

If the extension isn't working as you expect, please contact us through the following ways:

- GitHub Issue:
  - [KCLVM](https://github.com/KusionStack/KCLVM/issues)
  - [KCL VS Code Extension](https://github.com/KusionStack/vscode-kcl/issues)
- Slack: [KusionStack](https://join.slack.com/t/kusionstack/shared_invite/zt-1suog05ly-At_C4CqraI7VvSp20ODjOA)

## Contributing

We are working actively on improving the KCL development on VS Code. All kinds of contributions are welcomed. You can refer to our [contribution guide](docs/CONTRIBUTING.md). It introduces how to build and run the extension locally, and describes the process of sending a contribution.

## License

Apache License Version 2.0
