import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  getLanguageFromFile,
  MAX_DIFF_LINES,
} from './diffUtils';

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes less than', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes greater than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#039;s');
  });

  it('escapes all special characters together', () => {
    expect(escapeHtml('<a href="test.html?foo=1&bar=2">')).toBe(
      '&lt;a href=&quot;test.html?foo=1&amp;bar=2&quot;&gt;'
    );
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns unchanged string when no special characters', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});

describe('getLanguageFromFile', () => {
  it('returns typescript for .ts files', () => {
    expect(getLanguageFromFile('file.ts')).toBe('typescript');
  });

  it('returns typescript for .tsx files', () => {
    expect(getLanguageFromFile('components/Button.tsx')).toBe('typescript');
  });

  it('returns javascript for .js files', () => {
    expect(getLanguageFromFile('script.js')).toBe('javascript');
  });

  it('returns javascript for .jsx files', () => {
    expect(getLanguageFromFile('App.jsx')).toBe('javascript');
  });

  it('returns javascript for .mjs files', () => {
    expect(getLanguageFromFile('module.mjs')).toBe('javascript');
  });

  it('returns json for .json files', () => {
    expect(getLanguageFromFile('package.json')).toBe('json');
  });

  it('returns python for .py files', () => {
    expect(getLanguageFromFile('main.py')).toBe('python');
  });

  it('returns rust for .rs files', () => {
    expect(getLanguageFromFile('lib.rs')).toBe('rust');
  });

  it('returns go for .go files', () => {
    expect(getLanguageFromFile('main.go')).toBe('go');
  });

  it('returns css for .css files', () => {
    expect(getLanguageFromFile('styles.css')).toBe('css');
  });

  it('returns css for .scss files', () => {
    expect(getLanguageFromFile('styles.scss')).toBe('css');
  });

  it('returns yaml for .yml files', () => {
    expect(getLanguageFromFile('config.yml')).toBe('yaml');
  });

  it('returns dockerfile for Dockerfile', () => {
    expect(getLanguageFromFile('Dockerfile')).toBe('dockerfile');
  });

  it('returns makefile for Makefile', () => {
    expect(getLanguageFromFile('Makefile')).toBe('makefile');
  });

  it('returns plaintext for unknown extensions', () => {
    expect(getLanguageFromFile('file.xyz')).toBe('plaintext');
  });

  it('returns plaintext for files without extension', () => {
    expect(getLanguageFromFile('LICENSE')).toBe('plaintext');
  });

  it('handles paths with directories', () => {
    expect(getLanguageFromFile('src/components/Button.tsx')).toBe('typescript');
  });
});

describe('MAX_DIFF_LINES', () => {
  it('is set to 1000', () => {
    expect(MAX_DIFF_LINES).toBe(1000);
  });
});
