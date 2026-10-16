// Builds docs/API_ENDPOINTS.md from openapi.json (run `npm run openapi` first).
const d = require('../openapi.json');
const rows = [];
for (const [p, ops] of Object.entries(d.paths)) for (const [m, o] of Object.entries(ops)) rows.push([o.tags?.[0] || '-', m.toUpperCase(), p, (o.summary || o.description || '').split('\n')[0]]);
rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
const by = {};
for (const r of rows) (by[r[0]] ??= []).push(r);
let out = `# LifeSphere API — endpoint inventory\n\nGenerated from the OpenAPI document. ${rows.length} operations across ${Object.keys(d.paths).length} paths. All paths are under \`/v1\`; interactive docs at \`/docs\`, spec at \`/docs/openapi.json\`.\n\n`;
out += '| Area | Operations |\n|---|---|\n' + Object.entries(by).map(([t, r]) => `| ${t} | ${r.length} |`).join('\n') + '\n\n';
for (const [t, r] of Object.entries(by)) out += `## ${t}\n\n| Method | Path | Notes |\n|---|---|---|\n` + r.map((x) => `| ${x[1]} | \`${x[2]}\` | ${x[3].replace(/\|/g, '/')} |`).join('\n') + '\n\n';
require('fs').writeFileSync(require('path').join(__dirname, '../docs/API_ENDPOINTS.md'), out);
console.log(Object.entries(by).map(([t, r]) => `${t}:${r.length}`).join('  '));
