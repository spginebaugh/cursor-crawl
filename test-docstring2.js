#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dotenv = require('dotenv');
const { OpenAI } = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

// Load environment variables
dotenv.config();
dotenv.config({ path: '.env.local' });

// Define Zod schema for the docstring response
const DocstringSchema = z.object({
  name: z.string().describe('The name of the function/method'),
  type: z.string().describe('The type of the node (function, class, etc.)'),
  line: z.number().describe('The line number where the node starts'),
  docstring: z.string().describe('The generated JSDoc comment block')
});

// Make sure we have an API key
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('Error: OPENAI_API_KEY environment variable is not set');
  console.error('Please set it in your environment or create a .env.local file');
  process.exit(1);
}

// Create OpenAI client
const openai = new OpenAI({
  apiKey: apiKey
});

// Get the file to process
const filePath = process.argv[2];
if (!filePath) {
  console.error('Please provide a file path');
  console.error('Usage: node test-docstring.js <file-path>');
  process.exit(1);
}

// Check if file exists
const absolutePath = path.resolve(process.cwd(), filePath);
if (!fs.existsSync(absolutePath)) {
  console.error(`File not found: ${absolutePath}`);
  process.exit(1);
}

console.log(`Processing file: ${absolutePath}`);


// Main function
async function generateDocstrings() {
  try {
    // Read the file
    const code = fs.readFileSync(absolutePath, 'utf-8');
    
    // Send to OpenAI using the proper structured output approach
    console.log('Generating docstrings with OpenAI...');
    
    // Use the parse method with zodResponseFormat
    const completion = await openai.beta.chat.completions.parse({
      model: "gpt-4o-2024-08-06",
      messages: [
        { 
          role: "system", 
          content: "You are a helpful assistant that generates high-quality TypeScript docstrings."
        },
        { 
          role: "user", 
          content: `Generate JSDoc style docstrings for these declarations in this file:

File: ${path.basename(absolutePath)}
Code:
\`\`\`
${code}
\`\`\`

Each docstring should follow JSDoc format with descriptions for parameters, return values, and possible exceptions.`
        }
      ],
      response_format: zodResponseFormat(DocstringSchema, "response"),
    });
    
    // Extract the parsed result
    const validatedData = completion.choices[0].message.parsed;
    console.log('Response successfully validated against schema.');
    
    // Create output directory
    const outputDir = path.join(process.cwd(), '.cursortest');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Save to file
    const outputFile = path.join(outputDir, `${path.basename(absolutePath, path.extname(absolutePath))}-docstrings.json`);
    fs.writeFileSync(outputFile, JSON.stringify(validatedData, null, 2));
    
    
    console.log(`\nDocstrings saved to: ${outputFile}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    
    // Handle OpenAI API errors more gracefully
    if (error.response) {
      console.error('OpenAI API Error:', error.response.data);
    } else if (error.name === 'ZodError') {
      console.error('Schema validation error:', error.errors);
      
      // Additional debugging for Zod errors
      console.error('The response did not match the expected schema structure.');
    }
    
    process.exit(1);
  }
}

// Run the generator
generateDocstrings(); 