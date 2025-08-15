#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Get the path from command line arguments
const inputPath = process.argv[2];

if (!inputPath) {
    console.error('Usage: runbok <file_or_folder>');
    process.exit(1);
}

// Resolve the absolute path
const absolutePath = path.resolve(inputPath);

let targetFile;
let workingDir;

if (fs.existsSync(absolutePath)) {
    const stat = fs.statSync(absolutePath);

    if (stat.isFile() && absolutePath.endsWith('.yaml')) {
        // Single file mode
        targetFile = absolutePath;
        workingDir = path.dirname(absolutePath);
        console.log(`Opening YAML file: ${absolutePath}`);
    } else if (stat.isDirectory()) {
        // Folder mode - find first yaml file
        workingDir = absolutePath;
        const yamlFiles = fs.readdirSync(absolutePath)
            .filter(file => file.endsWith('.yaml'))
            .sort();

        if (yamlFiles.length === 0) {
            console.error('No YAML files found in directory:', absolutePath);
            process.exit(1);
        }

        targetFile = path.join(absolutePath, yamlFiles[0]);
        console.log(`Opening folder with ${yamlFiles.length} YAML file(s): ${absolutePath}`);
        console.log(`Starting with: ${yamlFiles[0]}`);
    } else {
        console.error('Path must be a .yaml file or a directory');
        process.exit(1);
    }
} else {
    console.error('Path does not exist:', absolutePath);
    process.exit(1);
}

// Start the server with the paths as environment variables
const serverPath = path.join(__dirname, '..', 'server.js');
const child = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: {
        ...process.env,
        FILE_PATH_ABSOLUTE: targetFile,
        FILE_PATH: path.relative(process.cwd(), targetFile),
        WORKING_DIR: workingDir
    }
});

child.on('close', (code) => {
    process.exit(code);
});
