const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const open = require('open');
const { VM } = require('vm2');
const fetch = require('node-fetch');
const NodeInspectorConnectionPool = require('./utils/node-inspector-connection-pool');

const app = express();
const PORT = 3001;

// Get the file path from environment variable
const filePathAbs = process.env.FILE_PATH_ABSOLUTE;
const filePath = process.env.FILE_PATH;

if (!filePathAbs) {
    console.error('File path not provided');
    process.exit(1);
}

console.log(`runbok CLI started with file: ${filePathAbs}`);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const nodeInspectorConnectionPool = new NodeInspectorConnectionPool();

// API Routes

// GET /api/file_content - Read file content
app.get('/api/file_content', (req, res) => {
    try {
        if (!fs.existsSync(filePathAbs)) {
            // If file doesn't exist, return empty structure
            const emptyContent = {
                config: {
                    code_executor: {
                        endpoint: ""
                    }
                },
                fields: [],
                values: []
            };
            return res.json(emptyContent);
        }

        const fileContent = fs.readFileSync(filePathAbs, 'utf8');
        const parsedContent = yaml.load(fileContent);

        // Ensure config exists
        if (!parsedContent.config) {
            parsedContent.config = {
                code_executor: {
                    endpoint: ""
                }
            };
        }

        res.json({
            file_path: filePath,
            content: parsedContent,
        });
    } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).json({ error: 'Failed to read file', details: error.message });
    }
});

// POST /api/file_content - Write file content
app.post('/api/file_content', (req, res) => {
    try {
        const content = req.body.content;

        // Ensure config exists in the content being saved
        if (!content.config) {
            content.config = {
                code_executor: {
                    endpoint: ""
                }
            };
        }

        const yamlContent = yaml.dump(content, { indent: 2 });

        // Ensure directory exists
        const dir = path.dirname(filePathAbs);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePathAbs, yamlContent, 'utf8');
        res.json({ success: true, message: 'File saved successfully' });
    } catch (error) {
        console.error('Error writing file:', error);
        res.status(500).json({ error: 'Failed to write file', details: error.message });
    }
});

// POST /api/execute_code - Execute code safely (local execution)
app.post('/api/execute_code', async (req, res) => {
    try {
        const { code, context = {}, endpoint } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Code is required' });
        }

        const wrappedCode = `
            (async function() {
                const func = ${code};
                return await func(${context ? JSON.stringify(context) : '{}'});
            })()
        `;

        if (endpoint && endpoint.trim()) {
            console.log(`Executing code on remote endpoint: ${endpoint}`);
            const inspector = await nodeInspectorConnectionPool.getConnection(endpoint.trim());
            const result = await inspector.eval(wrappedCode);
            return res.json({ success: true, result });
        }

        // Default local execution using VM2
        console.log('Executing code locally');
        const vm = new VM();
        vm.freeze(fetch, 'fetch');

        console.log('Executing wrapped code in VM');
        const result = await vm.run(wrappedCode);

        return res.json({ success: true, result });
    } catch (error) {
        console.error('Error executing code:', error);
        res.status(500).json({
            success: false,
            error: 'Code execution failed',
            details: error.message
        });
    }
});

// Serve the React app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // Open browser after a short delay
    setTimeout(() => {
        open(`http://localhost:${PORT}`);
    }, 1000);
});
