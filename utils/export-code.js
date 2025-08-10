const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const getFunctionDependencies = (code) => {
    const match = code.match(/\(\{([^)\}]+)\}.*\)/);
    if (match) {
        return match[1].split(",").map((arg) => arg.trim());
    }
    return [];
};

const exportCode = (fileContent, config, workingDir) => {
    const { fields } = fileContent;
    const language = config.language || 'ts';
    const exportConfig = config.export || {};
    
    if (!exportConfig.file_path) {
        throw new Error('Export file path not configured');
    }
    
    // Get template
    const templatePath = path.join(__dirname, '..', 'templates', `${language === 'ts' ? 'typescript' : 'javascript'}.ejs`);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template not found for language: ${language}`);
    }
    
    // Collect unique imports
    const importsSet = new Set();
    fields.forEach(field => {
        if (field.imports && field.imports.trim()) {
            importsSet.add(field.imports.trim());
        }
    });
    
    // Prepare template data
    const inputFields = fields.filter(f => !f.code);
    const computedFields = fields.filter(f => f.code);
    
    const functions = computedFields.map(field => ({
        name: `compute_${field.name}`,
        code: field.code,
        dependencies: getFunctionDependencies(field.code)
    }));
    
    // Add dependencies to computed fields
    const computedFieldsWithDeps = computedFields.map(field => ({
        ...field,
        dependencies: getFunctionDependencies(field.code)
    }));
    
    const templateData = {
        imports: Array.from(importsSet),
        functions,
        inputFields,
        computedFields: computedFieldsWithDeps,
        fields
    };
    
    // Render template
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const generatedCode = ejs.render(templateContent, templateData);
    
    // Write to file
    const exportPath = path.resolve(workingDir, exportConfig.file_path);
    const exportDir = path.dirname(exportPath);
    
    // Ensure directory exists
    if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
    }
    
    fs.writeFileSync(exportPath, generatedCode, 'utf8');
    
    return exportPath;
};

module.exports = exportCode;
