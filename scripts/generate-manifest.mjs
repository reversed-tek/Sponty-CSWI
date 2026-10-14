import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const domain = process.argv[2];
if (!domain) {console.error('Usage: npm run manifest -- https://your-project.vercel.app'); process.exit(1);}
const u = new URL(domain);
if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash) throw new Error('Use a bare HTTPS origin, with a trailing slash.');
const template = readFileSync(resolve('outlook/manifest.template.xml'),'utf8');
mkdirSync(resolve('dist-manifest'),{recursive:true});
writeFileSync(resolve('dist-manifest/manifest.xml'),template.replaceAll('https://YOUR-DEPLOYED-ORIGIN.invalid',u.origin));
console.log('Created dist-manifest/manifest.xml for '+u.origin+'. Upload it through Microsoft 365 Integrated Apps.');
