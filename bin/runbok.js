#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');

// Get the file path from command line arguments
const filePath = process.argv[2];

if (!filePath) {
    console.error('Usage: runbok <file.yaml>');
    process.exit(1);
}

// Resolve the absolute path
const absoluteFilePath = path.resolve(filePath);

// Start the server with the file path as an environment variable
const serverPath = path.join(__dirname, '..', 'server.js');
const child = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: { ...process.env, FILE_PATH_ABSOLUTE: absoluteFilePath, FILE_PATH: filePath }
});

child.on('close', (code) => {
    process.exit(code);
});
