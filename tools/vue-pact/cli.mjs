#!/usr/bin/env node
// cli.mjs — Vue Pact v0.1 (zero-dep)
// Usage: node cli.mjs scan <dir> [--out manifest.json] [--report report.md]
// Node >=18
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function* walk(dir) {
  for await (const d of await fs.opendir(dir)) {
    const entry = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(entry);
    else if (d.isFile() && d.name.endsWith('.vue')) yield entry;
  }
}

function matchBlock(src, tag, extra = '') {
  // Build a regex that captures the inner content of a tag. We use a
  // catch‑all character class `[^]` to span across newlines rather than
  // attempting to escape \s/\S sequences in a string passed to RegExp.
  // The optional `extra` argument lets callers constrain the opening tag
  // (e.g. match only <script setup> tags).
  // Use a character class `[\\s\\S]` to match any character including newlines. When
  // constructing the regex from a string, we must double escape backslashes so
  // the resulting pattern contains `\s` and `\S` for whitespace/non-whitespace.
  const re = new RegExp(
    `<${tag}${extra}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
    'i'
  );
  const m = src.match(re);
  return m ? m[1] : '';
}

function extractBlocks(src) {
  const template = matchBlock(src, 'template');
  // Use explicit regular expressions (with RegExp constructor) to capture
  // <script setup> and plain <script> blocks. We escape word boundary markers
  // (\\b) so that the resulting pattern matches the word "setup" rather than
  // containing a backspace character. The [^]*? character class matches any
  // character including newlines.
  const setupRe = new RegExp('<script[^>]*\\\\bsetup\\\\b[^>]*>([^]*?)<\\/script>', 'i');
  const setupMatch = src.match(setupRe);
  const scriptSetup = setupMatch ? setupMatch[1] : '';
  const scriptRe = new RegExp('<script(?![^>]*\\\\bsetup\\\\b)[^>]*>([^]*?)<\\/script>', 'i');
  const scriptMatch = src.match(scriptRe);
  const script = scriptMatch ? scriptMatch[1] : '';
  return { template, scriptSetup, script };
}

// -----------------------------------------------------------------------------
// A replacement for `extractBlocks` that uses regex literals with the `[\s\S]`
// character class to reliably match the contents of <script setup> and plain
// <script> tags across newlines. The original `extractBlocks` implementation
// builds its patterns via strings passed to `RegExp`, which can mishandle
// escape sequences and fail to capture multi-line scripts. Instead of
// modifying the original function directly (which could introduce context
// matching issues for patches), we define this new helper and use it in
// `analyzeSFC` below.
function extractBlocksFixed(src) {
  const template = matchBlock(src, 'template');
  // Match <script setup> blocks with a regex literal; use [\s\S] to match any
  // character including newlines.
  const setupMatch = src.match(/<script[^>]*\bsetup\b[^>]*>([\s\S]*?)<\/script>/i);
  const scriptSetup = setupMatch ? setupMatch[1] : '';
  // Match plain <script> blocks (those without the setup attribute).
  const scriptMatch = src.match(/<script(?![^>]*\bsetup\b)[^>]*>([\s\S]*?)<\/script>/i);
  const script = scriptMatch ? scriptMatch[1] : '';
  return { template, scriptSetup, script };
}


// --- Heuristic parsers (no AST) ---
function parseDefineProps(scriptSetup) {
  const results = [];
  // 1) defineProps<T>() — capture within angle brackets
  const generic = scriptSetup.match(/defineProps\s*<([\s\S]*?)>\s*\(\s*\)/m);
  if (generic) {
    // The content inside the angle brackets may be an inline type literal or a reference to
    // a named interface. We inspect the raw text to decide how to parse it.
    const bodyRaw = generic[1].trim();
    if (/[{}]/.test(bodyRaw)) {
      // Inline type literal (e.g. { title: string; count?: number }): remove curly braces
      // and parse each property definition.
      const body = bodyRaw.replace(/[{}]/g, '');
      const propLines = body.split(/\n|;/).map(s => s.trim()).filter(Boolean);
      for (const line of propLines) {
        const m = line.match(/^(\w+)(\??)\s*:\s*([^=]+)/);
        if (m) {
          const [, name, opt, type] = m;
          results.push({ name, required: opt !== '?', type: type.trim(), from: 'script-setup-generic' });
        }
      }
    } else {
      // Named interface reference (e.g. Props). Attempt to find a local `interface` definition
      // with the same name and extract its members.
      const ifaceName = bodyRaw;
      const ifaceRe = new RegExp(`interface\\s+${ifaceName}\\s*\\{([\\s\\S]*?)\\}`);
      const ifaceMatch = scriptSetup.match(ifaceRe);
      if (ifaceMatch) {
        const ifaceBody = ifaceMatch[1];
        const propLines = ifaceBody.split(/\n|;/).map(s => s.trim()).filter(Boolean);
        for (const line of propLines) {
          const m = line.match(/^(\w+)(\??)\s*:\s*([^=]+)/);
          if (m) {
            const [, name, opt, type] = m;
            results.push({ name, required: opt !== '?', type: type.trim(), from: 'script-setup-generic' });
          }
        }
      }
    }
  }
  // 2) defineProps({ ... }) — object literal form
  const obj = scriptSetup.match(/defineProps\s*\(\s*\{([\s\S]*?)\}\s*\)/m);
  if (obj) {
    const body = obj[1];
    // capture `foo: { type: String, required: true, default: 'x' }` or shorthand `bar: String`
    const propRegex = /(\w+)\s*:\s*(?:\{([\s\S]*?)\}|([A-Za-z]+))/g;
    let m;
    while ((m = propRegex.exec(body))) {
      const name = m[1];
      if (m[3]) {
        results.push({ name, type: m[3], required: false, from: 'script-setup-object' });
      } else {
        const objBody = m[2] || '';
        const type = (objBody.match(/type\s*:\s*([A-Za-z]+)/) || [])[1] || 'unknown';
        const required = /required\s*:\s*true/.test(objBody);
        const defM = objBody.match(/default\s*:\s*([^,}]+)/);
        const def = defM ? defM[1].trim() : undefined;
        results.push({ name, type, required, default: def, from: 'script-setup-object' });
      }
    }
  }
  return results;
}

function parseOptionsProps(script) {
  const results = [];
  // Look for an Options API props declaration: `props:` followed by an object literal.
  // We use a regex to find the literal `props` key followed by a colon and an opening brace.
  const match = script.match(/props\s*:\s*\{/m);
  if (!match) return results;
  const braceStart = match.index + match[0].lastIndexOf('{');
  // Walk through the script from the opening brace to find the matching closing brace.
  let level = 1;
  let i = braceStart + 1;
  while (i < script.length && level > 0) {
    const ch = script[i];
    if (ch === '{') level++;
    else if (ch === '}') level--;
    i++;
  }
  const body = script.slice(braceStart + 1, i - 1);
  // Regex to capture property definitions: name: type OR name: { ... }
  const propRegex = /(\w+)\s*:\s*(?:\{([^]*?)\}|([A-Za-z_$][\w$]*))/g;
  let m;
  while ((m = propRegex.exec(body))) {
    const name = m[1];
    if (m[3]) {
      results.push({ name, type: m[3], required: false, from: 'options' });
    } else {
      const objBody = m[2] || '';
      const typeMatch = objBody.match(/type\s*:\s*([A-Za-z_$][\w$]*)/);
      const type = typeMatch ? typeMatch[1] : 'unknown';
      const required = /required\s*:\s*true/.test(objBody);
      const defM = objBody.match(/default\s*:\s*([^,}]+)/);
      const def = defM ? defM[1].trim() : undefined;
      results.push({ name, type, required, default: def, from: 'options' });
    }
  }
  return results;
}

function parseDefineEmits(scriptSetup, script) {
  const events = new Set();
  // defineEmits([...])
  const em = scriptSetup.match(/defineEmits\s*\(\s*\[([\s\S]*?)\]\s*\)/m);
  if (em) {
    const list = em[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const item of list) {
      const m = item.match(/['"]([^'\"]+)['"]/);
      if (m) events.add(m[1]);
    }
  }
  // $emit('x') in script
  const emitRegex = /\$emit\s*\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = emitRegex.exec(scriptSetup + '\n' + script))) {
    events.add(m[1]);
  }
  return [...events];
}

function parseSlots(template) {
  const slots = new Set();
  // Named slot declarations (in a component): <slot name="foo">
  const decl = template.match(/<slot[^>]*>/g) || [];
  for (const s of decl) {
    const m = s.match(/name\s*=\s*"([^"]+)"/);
    slots.add(m ? m[1] : 'default');
  }
  // Consumers: v-slot:name or #name
  const useRe = /(v-slot:|#)([A-Za-z0-9_-]+)/g;
  let m;
  while ((m = useRe.exec(template))) slots.add(m[2]);
  return [...slots];
}

function a11yChecks(template) {
  const findings = [];
  // img without alt
  const imgRe = /<img\b[^>]*>/g;
  let m;
  while ((m = imgRe.exec(template))) {
    const tag = m[0];
    if (!/\balt\s*=/.test(tag)) findings.push({ rule: 'img-alt', message: '<img> missing alt attribute', sample: tag.slice(0, 80) + '…' });
  }
  // button without type
  const btnRe = /<button\b[^>]*>/g;
  while ((m = btnRe.exec(template))) {
    const tag = m[0];
    if (!/\btype\s*=/.test(tag)) findings.push({ rule: 'button-type', message: '<button> missing type attribute', sample: tag.slice(0, 80) + '…' });
  }
  // a with href="#" (anti-pattern without role)
  const aRe = /<a\b[^>]*>/g;
  while ((m = aRe.exec(template))) {
    const tag = m[0];
    const hasHrefHash = /href\s*=\s*"#"/.test(tag);
    const hasRole = /role\s*=/.test(tag);
    if (hasHrefHash && !hasRole) findings.push({ rule: 'link-hash', message: '<a href="#"> without role is an anti-pattern', sample: tag.slice(0, 80) + '…' });
  }
  // input without label/aria-label (very heuristic)
  const inputRe = /<input\b[^>]*>/g;
  while ((m = inputRe.exec(template))) {
    const tag = m[0];
    const hasAria = /aria-label\s*=/.test(tag) || /aria-labelledby\s*=/.test(tag);
    // quick check for nearby label with for=… is hard without DOM, so only flag if neither aria attr
    if (!hasAria) findings.push({ rule: 'input-label', message: '<input> missing aria-label/label association (heuristic)', sample: tag.slice(0, 80) + '…' });
  }
  return findings;
}

function propUsage(template, props) {
  const used = new Set();
  for (const p of props) {
    const re = new RegExp(`[^A-Za-z0-9_]${p.name}[^A-Za-z0-9_]`);
    if (re.test(template)) used.add(p.name);
  }
  return { used: [...used], unused: props.map(p => p.name).filter(n => !used.has(n)) };
}

function analyzeSFC(src, file) {
  // Use the fixed block extractor which handles multi-line <script setup> blocks.
  const { template, scriptSetup, script } = extractBlocksFixed(src);
  const props = [
    ...parseDefineProps(scriptSetup),
    ...parseOptionsProps(script)
  ];
  // de-dupe props by name, prefer script-setup over options
  const seen = new Map();
  for (const p of props) if (!seen.has(p.name) || p.from === 'script-setup-object' || p.from === 'script-setup-generic') seen.set(p.name, p);
  const propsUniq = [...seen.values()];
  const emits = parseDefineEmits(scriptSetup, script);
  const slots = parseSlots(template);
  const a11y = a11yChecks(template);
  const usage = propUsage(template, propsUniq);

  const metrics = {
    templateLines: template ? template.split('\n').length : 0,
    scriptLines: (scriptSetup + '\n' + script).split('\n').length,
    branches: (template.match(/v-if|v-else-if|v-for/g) || []).length,
    propsDeclared: propsUniq.length,
    propsUsed: usage.used.length,
    cohesion: propsUniq.length ? +(usage.used.length / propsUniq.length).toFixed(2) : 1
  };

  return {
    file,
    name: path.basename(file).replace(/\.vue$/, ''),
    props: propsUniq,
    emits,
    slots,
    metrics,
    warnings: [
      ...a11y,
      ...usage.unused.map(n => ({ rule: 'prop-unused', message: `Prop declared but not referenced in template: ${n}` }))
    ]
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const cmd = args[0];
  const res = { cmd, dir: args[1], out: 'vuepact.manifest.json', report: null };
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--out') res.out = args[++i];
    else if (args[i] === '--report') res.report = args[++i];
  }
  return res;
}

function asMarkdown(manifest) {
  let md = '# Vue Pact — Report\n\n';
  for (const c of manifest.components) {
    md += `## ${c.name} (\`${c.file}\`)\n`;
    md += `**Props (${c.props.length})** | **Emits (${c.emits.length})** | **Slots (${c.slots.length})** | **Cohesion ${c.metrics.cohesion}**\\n\n`;
    if (c.props.length) {
      md += `| name | type | required | default |\n|---|---|---|---|\n`;
      for (const p of c.props) md += `| ${p.name} | ${p.type || ''} | ${p.required ? 'yes' : 'no'} | ${p.default || ''} |\n`;
      md += '\n';
    }
    if (c.emits.length) md += `**Emits:** ${c.emits.join(', ')}\n\n`;
    if (c.slots.length) md += `**Slots:** ${c.slots.join(', ')}\n\n`;
    if (c.warnings.length) {
      md += `**Warnings (${c.warnings.length})**\n`;
      for (const w of c.warnings) md += `- [${w.rule}] ${w.message}\n`;
      md += '\n';
    }
  }
  return md;
}

async function main() {
  const { cmd, dir, out, report } = parseArgs(process.argv);
  if (cmd !== 'scan' || !dir) {
    console.error('Usage: node cli.mjs scan <dir> [--out manifest.json] [--report report.md]');
    process.exit(1);
  }
  const components = [];
  for await (const file of walk(dir)) {
    try {
      const src = await fs.readFile(file, 'utf8');
      const analyzed = analyzeSFC(src, path.relative(process.cwd(), file));
      components.push(analyzed);
    } catch (e) {
      console.error('Failed to analyze', file, e.message);
    }
  }
  const manifest = { version: '0.1.0', scannedAt: new Date().toISOString(), components };
  await fs.writeFile(out, JSON.stringify(manifest, null, 2));
  console.log('Wrote manifest:', out);
  if (report) {
    await fs.writeFile(report, asMarkdown(manifest));
    console.log('Wrote report:', report);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
