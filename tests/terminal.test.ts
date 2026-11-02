import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseOptions } from '../src/config.ts';
import { buildPlan } from '../src/plan.ts';

const root = fileURLToPath(new URL('../',import.meta.url));
const local = {MAC_SETUP_GIT_NAME:'', MAC_SETUP_GIT_EMAIL:''};

test('terminal selection defaults to Warp and rejects unsupported choices or wrong modules', () => {
  assert.equal(parseOptions([]).selection.terminal,'warp');
  assert.equal(parseOptions(['--terminal','ghostty']).selection.terminal,'ghostty');
  assert.equal(parseOptions(['--terminal=warp']).selection.terminal,'warp');
  assert.throws(()=>parseOptions(['--terminal','gosty']));
  assert.throws(()=>parseOptions(['--terminal','ghostty','--only','apps']));
});

test('each terminal plan installs only the chosen app and retains Fish + Starship', () => {
  for(const terminal of ['warp','ghostty'] as const){
    const options=parseOptions(['--only','terminal','--terminal',terminal]);
    const plan=buildPlan(options.selection,local,root,'/tmp/example');
    const packages=plan.filter(action=>action.kind==='package');
    assert.ok(packages.some(action=>action.name===terminal));
    assert.ok(!packages.some(action=>action.name===(terminal==='warp'?'ghostty':'warp')));
    for(const tool of ['fish','starship','fzf','fd','forgit']) assert.ok(packages.some(action=>action.name===tool));
    const config=plan.find(action=>action.kind==='file'&&action.target.endsWith('/ghostty/config.ghostty'));
    if(terminal==='ghostty'){
      assert.ok(config?.kind==='file');
      assert.match(config.content,/command = \/(?:opt\/homebrew|usr\/local)\/bin\/fish/);
      assert.match(config.content,/font-family = JetBrainsMono Nerd Font Mono/);
      assert.match(config.content,/shell-integration = fish/);
      assert.ok(!config.content.includes('{{FISH_PATH}}'));
    }else assert.equal(config,undefined);
  }
});

test('bootstrap accepts Ghostty in dry-run and rejects invalid terminal flags',()=>{
  const preview=spawnSync('/bin/bash',['install.sh','--dry-run','--only','terminal','--terminal','ghostty'],{cwd:root,encoding:'utf8'});
  assert.equal(preview.status,0,preview.stderr);
  assert.match(preview.stdout,/Install ghostty/);
  assert.match(preview.stdout,/Configure Ghostty/);
  assert.ok(!preview.stdout.includes('Install warp'));
  for(const args of [['--terminal','typo'],['--terminal'],['--only','apps','--terminal=ghostty']]){
    const result=spawnSync('/bin/bash',['install.sh',...args],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,1);
  }
});
