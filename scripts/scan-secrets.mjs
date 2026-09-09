// Reports locations and types only; never prints matched credential values.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';

const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','ignore']});
const patterns=[
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['OpenAI key',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}/g],
  ['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ['Supabase secret key',/\bsb_secret_[A-Za-z0-9_-]{16,}/g],
  ['AWS access key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['credential URL',/\b(?:postgres(?:ql)?|mysql|https?):\/\/[^\s/:"']+:[^\s@"']+@[^\s"']+/g],
  ['hardcoded credential',/(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{24,}["']/gi],
];
const findings=[];
function scan(text,location) {
  for(const [kind,regex] of patterns) {
    for(const match of text.matchAll(regex)) findings.push({location,line:text.slice(0,match.index).split('\n').length,kind});
  }
  for(const match of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {const jwt=JSON.parse(Buffer.from(match[0].split('.')[1],'base64url'));if(jwt.role!=='anon') findings.push({location,kind:'non-public JWT'});}catch{}
  }
}
const commits=git('rev-list','--all').trim().split('\n').filter(Boolean);
const seen=new Set();
for(const commit of commits) {
  for(const line of git('ls-tree','-r',commit).trim().split('\n')) {
    const match=/^\d+ blob ([a-f0-9]+)\t(.+)$/.exec(line);
    if(!match)continue;
    const [,blob,path]=match;
    if(/(?:^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith('.example')) findings.push({location:`${commit.slice(0,8)}:${path}`,kind:'tracked environment file'});
    if(seen.has(blob)||! /\.(?:[cm]?[jt]sx?|json|md|sql|ya?ml|toml|env|txt|local|example)$|(?:Dockerfile|gitignore)$/.test(path))continue;
    seen.add(blob);
    scan(git('cat-file','blob',blob),`${commit.slice(0,8)}:${path}`);
  }
}
const files=git('ls-files','--cached','--others','--exclude-standard').trim().split('\n').filter(Boolean);
for(const file of files) {
  if(!existsSync(file)||statSync(file).size>2*1024*1024||file.startsWith('artifacts/'))continue;
  scan(readFileSync(file,'utf8'),file);
}
const publicFiles=files.filter(file=>file.startsWith('public/'));
for(const file of publicFiles) if(/\.(?:env|sql|map|bak|key|pem|log|zip|dump)$|\/\./i.test(file)) findings.push({location:file,kind:'potentially exposed file'});
console.log(JSON.stringify({commitsScanned:commits.length,uniqueTextBlobsScanned:seen.size,workingFilesScanned:files.length,publicFiles,findings},null,2));
process.exitCode=findings.length?1:0;
