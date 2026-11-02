import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { diagnose } from '../src/doctor.ts';
import { parseOptions } from '../src/config.ts';
const root = fileURLToPath(new URL('../',import.meta.url));
const selection = parseOptions(['--only','terminal','--terminal','ghostty']).selection;

test('doctor cannot apply changes and rejects conflicting modes',()=>{
  assert.equal(parseOptions(['--doctor']).doctor,true);
  assert.throws(()=>parseOptions(['--doctor','--apply']));
  assert.throws(()=>parseOptions(['--doctor','--dry-run']));
  const r=spawnSync('/bin/bash',['install.sh','--doctor','--apply','--yes'],{cwd:root,encoding:'utf8'});
  assert.equal(r.status,1);
  assert.match(r.stderr,/cannot be combined/);
});

test('terminal doctor finds missing tools/plugins and config drift without starting any commands or writing files',async()=>{
  const home=await mkdtemp(join(tmpdir(),'doctor-test-'));
  try{
    const path=join(home,'.config/fish/config.fish');
    await mkdir(dirname(path),{recursive:true});
    await writeFile(path,'custom config');
    const before=await readdir(home,{recursive:true});
    const results=await diagnose(selection,{root,home,platform:'darwin',arch:'arm64',applications:join(home,'apps')},async()=>undefined,async()=>{throw new Error('Unexpected command');});
    assert.ok(results.some(r=>r.label==='brew'&&r.status==='missing'));
    assert.ok(results.some(r=>r.label==='Ghostty.app'&&r.status==='missing'));
    assert.ok(results.some(r=>r.label==='patrickf1/fzf.fish'&&r.status==='missing'));
    assert.ok(results.some(r=>r.label==='Config: ~/.config/fish/config.fish'&&r.status==='warning'));
    assert.ok(!results.some(r=>r.label.includes('Cursor')||r.label==='Warp.app'));
    assert.deepEqual(await readdir(home,{recursive:true}),before);
    assert.equal(await readFile(path,'utf8'),'custom config');
  }finally{await rm(home,{recursive:true,force:true});}
});

test('a recorded plugin without its files is not reported as installed',async()=>{
  const home=await mkdtemp(join(tmpdir(),'doctor-test-'));
  try{
    await mkdir(join(home,'.config/fish'),{recursive:true});
    await writeFile(join(home,'.config/fish/fish_plugins'),'patrickf1/fzf.fish\n');
    const results=await diagnose(selection,{root,home,platform:'linux',arch:'x64',applications:join(home,'apps')},async()=>'/fake/tool');
    assert.equal(results.find(r=>r.label==='patrickf1/fzf.fish')?.status,'missing');
  }finally{await rm(home,{recursive:true,force:true});}
});

test('preference checks only read defaults; an inspection error does not stop remaining checks',async()=>{
  const calls:string[][]=[];
  const results=await diagnose({modules:['macos'],apps:[]},{root,home:'/tmp/doctor-test',platform:'darwin',arch:'arm64'},async()=>{throw new Error('lookup failure');},async(command,args)=>{
    assert.equal(command,'/usr/bin/defaults');
    assert.equal(args[0],'read');
    calls.push(args);
    return {code:0,stdout:args[2]==='tilesize'?'41\n':'not matching'};
  });
  assert.equal(calls.length,8);
  assert.equal(results.find(r=>r.label==='brew')?.status,'warning');
  assert.equal(results.find(r=>r.label.includes('tilesize'))?.status,'ok');
  const dark = results.find(r=>r.label.includes('AppleInterfaceStyle'));
  assert.match(dark?.detail ?? '',/Current value: not matching; setup value: Dark/);
});

test('CLI doctor and bootstrap with missing dependencies do not write or bootstrap',async()=>{
  const home=await mkdtemp(join(tmpdir(),'doctor-test-'));
  try{
    const before=await readdir(root);
    const result=spawnSync(process.execPath,['--import','tsx','src/cli.ts','--doctor','--only','terminal','--terminal','ghostty'],{cwd:root,encoding:'utf8',env:{...process.env,HOME:home,MAC_SETUP_GIT_EMAIL:'invalid-private-value'}});
    assert.equal(result.status,1);
    assert.match(result.stdout,/No changes made/);
    assert.ok(!result.stdout.includes('invalid-private-value'));
    assert.deepEqual(await readdir(home),[]);
    assert.deepEqual(await readdir(root),before);
    await writeFile(join(home,'install.sh'),await readFile(join(root,'install.sh')));
    const bootstrap=spawnSync('/bin/bash',[join(home,'install.sh'),'--doctor'],{encoding:'utf8'});
    assert.equal(bootstrap.status,1);
    assert.match(bootstrap.stderr,/No dependencies were installed/);
    assert.deepEqual(await readdir(home),['install.sh']);
  }finally{await rm(home,{recursive:true,force:true});}
});
