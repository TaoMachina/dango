import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Part } from '../shared/types.ts';
import { editedPaths, fileList, projectFolder } from '../server/chat-edits.ts';

const tool = (kind: string, paths: string[], diff = false): Part => ({
  type: 'tool', toolCallId: kind, title: kind, kind, status: 'completed',
  locations: diff ? [] : paths,
  content: diff ? paths.map(path => ({ type: 'diff' as const, path, oldText: null, newText: 'x' })) : [],
});

test('edited files come from diffs and write tools, never from reads or the scratch folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentry-edits-'));
  const scratch = join(root, 'chat');
  const parts: Part[] = [
    tool('read', [join(root, 'app', 'readme.md')]),
    tool('edit', [join(root, 'app', 'index.html')], true),
    tool('delete', [join(root, 'app', 'old.css')]),
    tool('edit', [join(scratch, 'note.txt')], true),
  ];
  assert.deepEqual(editedPaths(parts, [scratch]), [join(root, 'app', 'index.html'), join(root, 'app', 'old.css')]);
});

test('the project folder is the git repository, else the common folder, never a drive or the home folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentry-project-'));
  const repo = join(root, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'src', 'ui'), { recursive: true });
  assert.equal(projectFolder([join(repo, 'src', 'ui', 'a.ts'), join(repo, 'package.json')], root), repo);
  const plain = join(root, 'site');
  assert.equal(projectFolder([join(plain, 'index.html'), join(plain, 'css', 'a.css')], join(tmpdir(), 'elsewhere')), plain);
  // A file straight in the home folder, or files across the home folder, are not one project.
  assert.equal(projectFolder([join(root, 'notes.txt')], root), null);
  assert.equal(projectFolder([join(root, 'a', 'x.txt'), join(root, 'b', 'y.txt')], root), null);
});

test('the file list names up to five files', () => {
  assert.equal(fileList(['/a/1.ts', '/a/2.ts']), '1.ts, 2.ts');
  assert.equal(fileList(['/a/1', '/a/2', '/a/3', '/a/4', '/a/5', '/a/6', '/a/7']), '1, 2, 3, 4, 5 and 2 more');
});
