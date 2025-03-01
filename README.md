# CursorCrawl

CursorCrawl is a VSCode extension built to;
1. Solve some of the most common problems caused by AI code editors like Cursor
2. Create AI-readable documentation for AI code editors
3. Experiment with novel approaches to performing static code analysis with AI

This entire app was built in 24 hours during the GauntletAI Hackathon (8AM 2025-02-28 through 8AM 2025-03-01)

I am writing this README at ~2am, so expect spelling errors.

## Motivation
Current coding tools are made for humans. However, with the advent and continuous improvement of LLMs, and the development of tools like Cursor, Windsurf, Cline, and many others, code will be primarily written -- and read -- by AI. 

Eventually, the goal is that AI tools will be able to sense their own inputs, outputs, and code (through something like MCP) -- in which case the code itself is the documentation. However, we are still far from that point -- and openAIs recent underwhelming release of gpt-4.5 doesn't create a lot of confidence that this future is right arround the corner. 

In addition, the use of AI-assisted programming tools should change the way we approach documentation. The gold standard of well-documented code for humans may actually be bad form for writing with AI. For example, if we look at this code below:

```
export class Statistics {
  /**
   * Returns the average of two numbers.
   *
   * @remarks
   * This method is part of the {@link core-library#Statistics | Statistics subsystem}.
   *
   * @param x - The first input number
   * @param y - The second input number
   * @returns The arithmetic mean of `x` and `y`
   *
   * @beta
   */
  public static getAverage(x: number, y: number): number {
    return (x + y) / 2.0;
  }
}
```
It has 119 tokens with the documentation, but only 35 tokens without. 

![35 tokens](https://raw.githubusercontent.com/gauntletai/cursorcrawl/main/docs/tokens_35.png)
![119 tokens](https://raw.githubusercontent.com/gauntletai/cursorcrawl/main/docs/tokens_119.png)

From a human perspective, the documentation makes it easier to understand, but from the LLMs perspective it is 3.4 times more work to read.

On the other hand, tools like Cursor are still in their infancy, and are very prone to making mistakes that can be extremely frustrating to fix. The main one I am focusing on here is code duplication.

Therefore, I think it is worth exploring methods to rethink our approach to documentation in a way that will make it easier for both the human and the AI. 

The overarching idea to my approach is that we can use LLMs to generate detailed documentation about the code in English. These documents should be separate from the code itself, as to reduce the number of tokens, but should also be easily searchable by both AI and humans if they need to be referenced. These docs include comprehensive, AI generated summaries about what constructs (functions/classes/variables/etc.) do and how they interact.  **These summaries themselves can then be analyzed by LLMs to check for errors in the codebase.**

As a proof of concept, this extension enables users to create detailed LLM-generated docstrings for all constructs in their code. These are held in a single JSON file (should probably move to SQLite in the future...), which is then parsed down and used as an input to an LLM, which then interprets the English descriptions of the constructs to identify repeated code.

## Features Overview

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## To do:
- visualizations
- improve user interface and config
- intellegent.cursor/rules generation
- add linter-like functionality
- use SQlite or some other database instead of json for storage of symbol index
- add gemini support for codebases with codebase-context.json of >200K tokens
- file and directory level summaries for full tree
- bi-directional context writing
- cyclomatic complexity
- smart binning for docstring creation so docstrings can contain more context about function use
- Improve handling of updating code
- code smell detection

**Enjoy!**
