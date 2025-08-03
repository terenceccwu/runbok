const path = require('path');
const ts = require('typescript');

// Replace the compileTypeScript function with this simpler version
const compileTypeScript = (code, filePath) => {
    if (!code) {
        return "";
    }

    try {
        const workingDir = path.dirname(filePath);
        const tsconfigPath = path.join(workingDir, 'tsconfig.json');

        let compilerOptions = {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
            skipLibCheck: true,
        };

        // // Load tsconfig.json if it exists
        // if (fs.existsSync(tsconfigPath)) {
        //     const tsconfigContent = fs.readFileSync(tsconfigPath, 'utf8');
        //     const parsedConfig = ts.parseConfigFileTextToJson(tsconfigPath, tsconfigContent);
        //     if (parsedConfig.config && parsedConfig.config.compilerOptions) {
        //         compilerOptions = { ...compilerOptions, ...parsedConfig.config.compilerOptions };
        //     }
        // }

        const result = ts.transpileModule(code, {
            compilerOptions: compilerOptions
        });

        if (result.diagnostics && result.diagnostics.length > 0) {
            const errors = result.diagnostics.map(d => d.messageText).join(', ');
            throw new Error(`TypeScript compilation errors: ${errors}`);
        }

        return result.outputText;
    } catch (error) {
        throw new Error(`TypeScript compilation failed: ${error.message}`);
    }
};

module.exports = compileTypeScript;
