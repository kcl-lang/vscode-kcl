# KCL Extension for Visual Studio Code

## Quick Start

- **Step 1.** [Install KCL](https://kcl-lang.io/docs/user_docs/getting-started/install) on your system. Please check that `kcl` and `kcl-language-server` are installed and have been added to Path
  ```bash
  which kcl
  which kcl-language-server
  ```

- **Step 2.** Install the [KCL extension](https://marketplace.visualstudio.com/items?itemName=kcl.kcl-vscode-extension) for Visual Studio Code. This extension requires the VS Code 1.50+
- **Step 3.** Open or create a KCL file and begin your KCL tour!

## Features

This extension provides some coding assistance, including the following features:

- **Syntax Highlight:**
  ![Highlight](https://kcl-lang.io/assets/images/Highlight-eb0516cd26555785169222292bede364.png)
- **Goto Definition:** Goto definition of schema, variable, schema attribute, and import pkg.
  ![Goto Definition](https://kcl-lang.io/assets/images/GotoDef-0875243eacd6b76e49b7a5b95cb9ce55.gif)
- **Completion:** Keywords completions and dot(`.`) completion.
  ![Completion](https://kcl-lang.io/assets/images/Completion-584771cd4bed237e74d3da3decaa9757.gif)
- **Outline:** Main definition(schema def) and variables in KCL file
  ![Outline](https://kcl-lang.io/assets/images/Outline-c443b2ee1e35746795e7b09c11f3f4da.gif)
- **Hover:** Identifier information (type and schema documentation)
  ![Hover](https://kcl-lang.io/assets/images/Hover-339697d17ca0d4f167b1b1a904c9f1aa.gif)
- **Diagnostics:** Warnings and errors in KCL file.
  ![Diagnostics](https://kcl-lang.io/assets/images/Diagnostics-716fc3b938a94e4db2cbafaad4f4174d.gif)

Other useful features such as refactoring and testing are in development.

## Dependencies

We recommend that you use the latest version of KCLVM, but the minimum required version for this extension is 0.4.6. If you are using an earlier version, the extension may not work properly.

## Known Issues

- **Hover and GotoDefintion:** The current hover and goto definitions are similar to global search, and there may be multiple results for some Identifiers with the same name.
- **Completion:** Currently, we only support keyword completion and dot-triggered completion (e.g., `schema.attr`, `pkg.schema` and `str.methods` ). Full semantic completion is in development.

## Ask for help

If the extension isn't working as you expect, please contact us with [community](https://kcl-lang.io/docs/community/intro/support) for help

## Contributing

We are working actively on improving the KCL development on VS Code. All kinds of contributions are welcomed. You can refer to our [contribution guide](https://kcl-lang.io/docs/community/contribute). It introduces how to build and run the extension locally, and describes the process of sending a contribution.

## License

Apache License Version 2.0
