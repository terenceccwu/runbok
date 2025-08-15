const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const open = require('open');
const { VM } = require('vm2');
const fetch = require('node-fetch');
const NodeInspectorConnectionPool = require('./utils/node-inspector-connection-pool');
const compileTypeScript = require('./utils/tsc');
const exportCode = require('./utils/export-code');

const app = express();
const PORT = 3001;

// Get the working directory from environment variable
const workingDir = process.env.WORKING_DIR;

if (!workingDir) {
    console.error('Working directory not provided');
    process.exit(1);
}

console.log(`runbok CLI started with working directory: ${workingDir}`);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const nodeInspectorConnectionPool = new NodeInspectorConnectionPool();

// Helper function to get YAML files in working directory
const getYamlFiles = () => {
    return fs.readdirSync(workingDir)
        .filter(file => file.endsWith('.yaml'))
        .sort()
        .map(file => ({
            name: file,
            path: path.join(workingDir, file)
        }));
};

// API Routes

// GET /api/yaml_files - Get list of YAML files
app.get('/api/yaml_files', (req, res) => {
    try {
        const yamlFiles = getYamlFiles();
        res.json({
            working_dir: workingDir,
            files: yamlFiles.map(f => ({ name: f.name, path: path.relative(workingDir, f.path) }))
        });
    } catch (error) {
        console.error('Error getting YAML files:', error);
        res.status(500).json({ error: 'Failed to get YAML files', details: error.message });
    }
});

// GET /api/file_content/:filename - Read specific file content
app.get('/api/file_content/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePathAbs = path.join(workingDir, filename);

        // Security check - ensure file is within working directory
        if (!filePathAbs.startsWith(workingDir)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(filePathAbs)) {
            // If file doesn't exist, return empty structure
            const emptyContent = {
                config: {
                    code_executor: {
                        endpoint: "",
                        preprocessor: ""
                    },
                    language: "ts",
                    export: {
                        file_path: "./src/workflow.ts"
                    }
                },
                fields: [],
                values: []
            };
            return res.json({
                file_path: filename,
                content: emptyContent
            });
        }

        const fileContent = fs.readFileSync(filePathAbs, 'utf8');
        const parsedContent = yaml.load(fileContent);

        // Ensure config exists
        if (!parsedContent.config) {
            parsedContent.config = {
                code_executor: {
                    endpoint: "",
                    preprocessor: ""
                },
                language: "ts",
                export: {
                    file_path: "./src/workflow.ts"
                }
            };
        }

        // Ensure all config fields exist
        if (!parsedContent.config.code_executor) {
            parsedContent.config.code_executor = { endpoint: "", preprocessor: "" };
        }
        if (!parsedContent.config.code_executor.preprocessor) {
            parsedContent.config.code_executor.preprocessor = "";
        }
        if (!parsedContent.config.language) {
            parsedContent.config.language = "ts";
        }
        if (!parsedContent.config.export) {
            parsedContent.config.export = {
                file_path: "./src/workflow.ts"
            };
        }

        res.json({
            file_path: filename,
            content: parsedContent,
        });
    } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).json({ error: 'Failed to read file', details: error.message });
    }
});

// POST /api/file_content/:filename - Write specific file content
app.post('/api/file_content/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePathAbs = path.join(workingDir, filename);
        const content = req.body.content;

        // Security check - ensure file is within working directory
        if (!filePathAbs.startsWith(workingDir)) {
            return res.status(403).json({ error: 'Access denied' });
        }

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
        let { imports = "", mocks = "", mockDependencies = [], code = "", context = {}, endpoint, preprocessor, filename } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Code is required' });
        }

        const filePathAbs = filename ? path.join(workingDir, filename) : workingDir;

        const codeTemplate = `
            let { ${mockDependencies.join(',')} } = ${context ? JSON.stringify(context) : '{}'};
            ${imports}
            ${mocks}
            const func = ${code};
            return await func(${context ? JSON.stringify(context) : '{}'});
        `;

        let processedCode = codeTemplate || "";

        // Apply TypeScript preprocessing if configured
        if (preprocessor === 'typescript-compiler') {
            try {
                processedCode = compileTypeScript(codeTemplate, filePathAbs);
                console.log('TypeScript code compiled successfully');
            } catch (compileError) {
                console.error('TypeScript compilation error:', compileError);
                return res.status(400).json({
                    success: false,
                    error: 'TypeScript compilation failed',
                    details: compileError.message
                });
            }
        }

        const wrappedCode = `
            (async function() {
                var exports = {};
                ${processedCode}
            })();
        `

        if (endpoint && endpoint.trim()) {
            console.log(`Executing code on remote endpoint: ${endpoint}`);
            const inspector = await nodeInspectorConnectionPool.getConnection(endpoint.trim());
            const result = await inspector.eval(wrappedCode);
            return res.json({ success: true, result });
        }

        // Default local execution using VM2
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

// POST /api/export_code/:filename - Export code for specific file
app.post('/api/export_code/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const { content, config } = req.body;

        if (!content || !content.fields) {
            return res.status(400).json({ error: 'Invalid content provided' });
        }

        const fileDir = path.dirname(path.join(workingDir, filename));
        const exportPath = exportCode(content, config, fileDir);

        res.json({
            success: true,
            message: 'Code exported successfully',
            export_path: path.relative(fileDir, exportPath)
        });
    } catch (error) {
        console.error('Error exporting code:', error);
        res.status(500).json({
            success: false,
            error: 'Code export failed',
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
    console.log(`Server running on <http://localhost>:${PORT}`);

    // Open browser after a short delay
    setTimeout(() => {
        open(`http://localhost:${PORT}`);
    }, 1000);
});
