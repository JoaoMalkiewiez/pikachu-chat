const fs = require('node:fs');
const YAML = require('yaml');
const Ajv = require('ajv/dist/2020');
(async () => {
  const { execFileSync } = require('node:child_process');
  const schema = JSON.parse(execFileSync('curl', ['--fail', '--silent', '--show-error', '--max-time', '20', 'https://render.com/schema/render.yaml.json'], { encoding: 'utf8' }));
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  const validate = ajv.compile(schema);
  if (!validate(YAML.parse(fs.readFileSync('render.yaml', 'utf8')))) throw new Error(JSON.stringify(validate.errors));
  console.log('Render Blueprint: valid against current public JSON Schema (no deploy or service validation).');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
