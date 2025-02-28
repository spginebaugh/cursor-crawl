# Docstring Generator Tester

A simple tool for testing the docstring generator on local files using OpenAI's `zodResponseFormat` helper for structured output with Zod validation.

## Setup

1. Make sure you have an OpenAI API key
2. Create a `.env.local` file in the project root with:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```
3. Install dependencies:
   ```
   npm install zod openai dotenv
   ```

## Usage

```bash
# Using npm script
npm run docstring path/to/your/file.js

# Or directly
node test-docstring.js path/to/your/file.js
```

## What it does

This script:

1. Finds functions in your file that need docstrings (using simple regex)
2. Uses Zod to define a schema for the expected docstring response format
3. Sends the file to OpenAI using the official `zodResponseFormat` helper
4. Gets back a pre-validated structured response that matches your Zod schema
5. Saves the results to `.cursortest/filename-docstrings.json`
6. Displays the docstrings in the console

## Features

- **Type Safety**: Uses OpenAI's official `zodResponseFormat` helper to ensure responses match your Zod schema
- **Modern API Usage**: Uses the `openai.beta.chat.completions.parse` method for direct schema validation
- **Strong Typing**: Returns a properly typed response object without manual JSON parsing
- **Error Handling**: Provides detailed feedback when responses don't match the expected schema
- **Non-destructive**: Only examines files, never modifies them

## Example

```bash
npm run docstring src/utils/file-system.ts
```

This will generate docstrings for functions in the file and save them to `.cursortest/file-system-docstrings.json`

## Implementation Details

The script uses OpenAI's official structured output format:

```javascript
const completion = await openai.beta.chat.completions.parse({
  model: "gpt-4o-2024-05-13",
  messages: [/* your messages */],
  response_format: zodResponseFormat(DocstringSchema, "response"),
});

// Result is already validated and typed according to your schema
const validatedData = completion.choices[0].message.parsed;
``` 